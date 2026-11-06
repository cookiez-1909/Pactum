//! PactumController: a council of guardians reads and approves an offer on NEAR, then Chain Signatures signs exactly
//! the hash of those terms to open the case on the Pactum contract on any declared EVM chain.
//! One council and one reward limit apply to every chain, and the signing address is the same on every chain.
//!
//! The contract has no owner, no upgrade function and no function that signs arbitrary payloads.
//! Testnet prototype, not audited.

use near_sdk::json_types::U64;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{
    env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault,
    PromiseOrValue,
};

mod eip712;
#[cfg(test)]
mod tests;
pub mod types;

use types::{
    evm_signature, parse_hex_fixed, to_hex, CaseTerms, Config, Deployment, ParsedTerms, Proposal,
    ProposalStatus, SignPayload, SignRequest, SignResponse,
};

const BPS: u16 = 10_000;
const MAX_TIERS: usize = 8;
// Offer text lives in contract state, so it is capped to keep storage fees from draining the balance.
const MAX_EVIDENCE_BYTES: usize = 4096;
const MAX_LIST_LIMIT: u32 = 50;
const NANOS_PER_SECOND: u64 = 1_000_000_000;
// Domain 0 of the MPC contract is secp256k1 (read from the `state` view).
const SECP256K1_DOMAIN_ID: u64 = 0;
// The MPC contract requires at least 15 Tgas and 1 yoctoNEAR (read from the `config` view).
const SIGN_GAS: Gas = Gas::from_tgas(50);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);
const SIGN_DEPOSIT: NearToken = NearToken::from_yoctonear(1);
// A valid response is about 200 bytes. Capped so an oversized response cannot use up the callback's gas.
const MAX_SIGN_RESPONSE_BYTES: usize = 1024;

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Proposals,
    UsedCaseIds,
    UsedNonces,
}

#[ext_contract(ext_signer)]
#[allow(dead_code)]
trait MpcSigner {
    fn sign(&mut self, request: SignRequest);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PactumController {
    guardians: Vec<AccountId>,
    threshold: u32,
    // A short list that never changes, so a Vec keeps reading the whole list cheap.
    deployments: Vec<(u64, [u8; 20])>,
    derivation_path: String,
    signer_contract: AccountId,
    max_reward_bps: u16,
    next_proposal_id: u64,
    proposals: LookupMap<u64, Proposal>,
    // Case ids and nonces are per chain, because each chain has its own Pactum contract.
    used_case_ids: LookupSet<(u64, [u8; 32])>,
    used_nonces: LookupSet<(u64, u64)>,
}

#[near]
impl PactumController {
    /// Initialized once. No function changes these values later.
    #[init]
    pub fn new(
        guardians: Vec<AccountId>,
        threshold: u32,
        deployments: Vec<Deployment>,
        derivation_path: String,
        signer_contract: AccountId,
        max_reward_bps: u16,
    ) -> Self {
        require!(!guardians.is_empty(), "guardians must not be empty");
        require!(
            threshold >= 1 && threshold as usize <= guardians.len(),
            "threshold must be between 1 and the number of guardians"
        );
        for (index, guardian) in guardians.iter().enumerate() {
            require!(!guardians[..index].contains(guardian), "duplicate guardian");
        }
        require!(max_reward_bps <= BPS, "max_reward_bps must not exceed 10000");
        require!(!derivation_path.is_empty(), "derivation_path must not be empty");
        require!(!deployments.is_empty(), "deployments must not be empty");
        let mut parsed_deployments: Vec<(u64, [u8; 20])> = Vec::with_capacity(deployments.len());
        for deployment in &deployments {
            let chain_id = deployment.chain_id.0;
            require!(parsed_deployments.iter().all(|(known, _)| *known != chain_id), "duplicate chain_id");
            let pactum = parse_hex_fixed(&deployment.pactum)
                .unwrap_or_else(|| env::panic_str("pactum must be 20-byte hex"));
            parsed_deployments.push((chain_id, pactum));
        }

        Self {
            guardians,
            threshold,
            deployments: parsed_deployments,
            derivation_path,
            signer_contract,
            max_reward_bps,
            next_proposal_id: 0,
            proposals: LookupMap::new(StorageKey::Proposals),
            used_case_ids: LookupSet::new(StorageKey::UsedCaseIds),
            used_nonces: LookupSet::new(StorageKey::UsedNonces),
        }
    }

    /// A guardian creates a proposal. The terms are checked and hashed at once, and cannot change afterwards.
    /// `evidence` is the offer text and public record. Its hash must equal `evidence_hash` in the terms,
    /// so guardians read exactly what they approve right on NEAR, instead of only seeing a hash.
    pub fn propose_case(&mut self, terms: CaseTerms, evidence: String) -> U64 {
        self.require_guardian();
        let parsed = self.validate_terms(&terms);
        require!(evidence.len() <= MAX_EVIDENCE_BYTES, "evidence is too long");
        require!(
            env::keccak256_array(evidence.as_bytes()) == parsed.evidence_hash,
            "evidence does not match evidence_hash"
        );
        require!(self.used_case_ids.insert((parsed.chain_id, parsed.case_id)), "case_id already proposed");
        require!(self.used_nonces.insert((parsed.chain_id, parsed.nonce)), "nonce already used");

        let id = self.next_proposal_id;
        self.next_proposal_id += 1;
        let digest = to_hex(&eip712::case_digest(&parsed, &self.pactum_on(parsed.chain_id)));
        self.proposals.insert(
            id,
            Proposal {
                id: U64(id),
                terms,
                evidence,
                digest,
                proposer: env::predecessor_account_id(),
                approvals: Vec::new(),
                status: ProposalStatus::Pending,
                signature: None,
            },
        );
        U64(id)
    }

    /// A guardian approves. At the threshold, the contract requests the MPC signature in the same transaction.
    pub fn approve_case(&mut self, proposal_id: U64) -> PromiseOrValue<()> {
        self.require_guardian();
        let caller = env::predecessor_account_id();
        let threshold = self.threshold as usize;
        let proposal = self.proposal_mut(proposal_id.0);
        require!(proposal.status == ProposalStatus::Pending, "proposal is not pending");
        require!(!proposal.approvals.contains(&caller), "already approved");
        proposal.approvals.push(caller);

        if proposal.approvals.len() < threshold {
            return PromiseOrValue::Value(());
        }
        proposal.status = ProposalStatus::Approved;
        self.start_signing(proposal_id.0)
    }

    /// Retries signing after an earlier failure, for example an MPC network timeout. Anyone can call it
    /// because the hash is already approved, and only that hash is signed.
    pub fn retry_signature(&mut self, proposal_id: U64) -> PromiseOrValue<()> {
        require!(
            self.proposal_mut(proposal_id.0).status == ProposalStatus::Approved,
            "proposal is not awaiting a signature"
        );
        self.start_signing(proposal_id.0)
    }

    /// Receives the MPC contract's result and stores the signature so anyone can read it and submit it to an EVM chain.
    /// Reads the result directly instead of using `#[callback_result]`: a malformed response would make that macro panic,
    /// the proposal would be stuck in `Signing` forever and could not be signed again. Here every error goes back to `Approved`.
    #[private]
    pub fn on_signed(&mut self, proposal_id: U64) -> Option<String> {
        let signature = env::promise_result_checked(0, MAX_SIGN_RESPONSE_BYTES)
            .ok()
            .and_then(|bytes| near_sdk::serde_json::from_slice::<SignResponse>(&bytes).ok())
            .and_then(|response| evm_signature(&response));
        let proposal = self.proposal_mut(proposal_id.0);
        match &signature {
            Some(_) => proposal.status = ProposalStatus::Signed,
            None => proposal.status = ProposalStatus::Approved,
        }
        proposal.signature = signature.clone();
        signature
    }

    pub fn get_config(&self) -> Config {
        Config {
            guardians: self.guardians.clone(),
            threshold: self.threshold,
            deployments: self
                .deployments
                .iter()
                .map(|(chain_id, pactum)| Deployment { chain_id: U64(*chain_id), pactum: to_hex(pactum) })
                .collect(),
            derivation_path: self.derivation_path.clone(),
            signer_contract: self.signer_contract.clone(),
            max_reward_bps: self.max_reward_bps,
        }
    }

    pub fn get_proposal(&self, proposal_id: U64) -> Option<Proposal> {
        self.proposals.get(&proposal_id.0).cloned()
    }

    pub fn proposal_count(&self) -> U64 {
        U64(self.next_proposal_id)
    }

    /// Reads proposals in creation order, so an interface can show them without an indexing server.
    pub fn list_proposals(&self, from: U64, limit: u32) -> Vec<Proposal> {
        let end = from.0.saturating_add(u64::from(limit.min(MAX_LIST_LIMIT))).min(self.next_proposal_id);
        (from.0..end).filter_map(|id| self.proposals.get(&id).cloned()).collect()
    }

    /// The hash the contract would sign for these terms. Writes no state; used to compare with the EVM.
    pub fn case_digest(&self, terms: CaseTerms) -> String {
        let parsed = ParsedTerms::parse(&terms).unwrap_or_else(|err| env::panic_str(err));
        to_hex(&eip712::case_digest(&parsed, &self.pactum_on(parsed.chain_id)))
    }
}

impl PactumController {
    fn require_guardian(&self) {
        require!(
            self.guardians.contains(&env::predecessor_account_id()),
            "caller is not a guardian"
        );
    }

    fn pactum_on(&self, chain_id: u64) -> [u8; 20] {
        self.deployments
            .iter()
            .find(|(known, _)| *known == chain_id)
            .map(|(_, pactum)| *pactum)
            .unwrap_or_else(|| env::panic_str("chain_id is not served by this controller"))
    }

    fn proposal_mut(&mut self, id: u64) -> &mut Proposal {
        self.proposals.get_mut(&id).unwrap_or_else(|| env::panic_str("proposal not found"))
    }

    // Section 7 of the spec: reward within the maximum, increasing deadlines, decreasing rewards.
    // The other checks match `Pactum._validateTerms`, so bad terms are rejected on NEAR already.
    fn validate_terms(&self, terms: &CaseTerms) -> ParsedTerms {
        let parsed = ParsedTerms::parse(terms).unwrap_or_else(|err| env::panic_str(err));
        const ZERO: [u8; 32] = [0u8; 32];
        require!(
            self.deployments.iter().any(|(known, _)| *known == parsed.chain_id),
            "chain_id is not served by this controller"
        );
        require!(parsed.case_id != ZERO, "case_id must not be zero");
        require!(parsed.token != [0u8; 20], "token must not be zero");
        require!(parsed.total_loss != ZERO, "total_loss must not be zero");
        require!(parsed.max_return != ZERO, "max_return must not be zero");
        // Comparing big-endian arrays lexicographically is the same as comparing the numbers.
        require!(parsed.max_return <= parsed.total_loss, "max_return exceeds total_loss");
        require!(parsed.refund_root != ZERO, "refund_root must not be zero");
        require!(
            !parsed.tiers.is_empty() && parsed.tiers.len() <= MAX_TIERS,
            "tier count must be between 1 and 8"
        );
        require!(parsed.tiers[0].1 <= self.max_reward_bps, "reward exceeds the global maximum");
        for pair in parsed.tiers.windows(2) {
            require!(pair[1].0 > pair[0].0, "tier deadlines must increase");
            require!(pair[1].1 < pair[0].1, "tier rewards must decrease");
        }
        let now = env::block_timestamp() / NANOS_PER_SECOND;
        require!(parsed.tiers[parsed.tiers.len() - 1].0 >= now, "last tier already passed");
        parsed
    }

    // The payload can only be the hash stored in a proposal that has enough approvals.
    fn start_signing(&mut self, id: u64) -> PromiseOrValue<()> {
        let path = self.derivation_path.clone();
        let signer = self.signer_contract.clone();
        let proposal = self.proposal_mut(id);
        proposal.status = ProposalStatus::Signing;
        let payload = proposal.digest.trim_start_matches("0x").to_string();

        let request =
            SignRequest { path, payload_v2: SignPayload::Ecdsa(payload), domain_id: SECP256K1_DOMAIN_ID };
        let promise = ext_signer::ext(signer)
            .with_attached_deposit(SIGN_DEPOSIT)
            .with_static_gas(SIGN_GAS)
            .sign(request)
            .then(Self::ext(env::current_account_id()).with_static_gas(CALLBACK_GAS).on_signed(U64(id)));
        PromiseOrValue::Promise(promise)
    }
}
