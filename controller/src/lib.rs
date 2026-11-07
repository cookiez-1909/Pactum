//! PactumController: a council of guardians reads and approves an offer on NEAR, then Chain Signatures signs
//! the terms hash of every case in that offer, on every EVM chain the offer names.
//! One approval covers the whole offer. One council and one reward limit apply to every chain,
//! the signing address is the same on every chain, and the council can vote in a new chain without changing that address.
//!
//! The contract has no owner, no upgrade function and no function that signs arbitrary payloads.
//! Testnet prototype, not audited.

use near_sdk::json_types::U64;
use near_sdk::store::{LookupMap, LookupSet};
use near_sdk::{env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault};

mod eip712;
#[cfg(test)]
mod tests;
pub mod types;

use types::{
    evm_signature, parse_hex_fixed, to_hex, CaseStatus, CaseTerms, ChainProposal, ChainProposalStatus,
    Config, Deployment, ParsedTerms, Proposal, ProposalCase, ProposalStatus, SignPayload, SignRequest,
    SignResponse,
};

const BPS: u16 = 10_000;
const MAX_TIERS: usize = 8;
// Offer text lives in contract state, so it is capped to keep storage fees from draining the balance.
const MAX_EVIDENCE_BYTES: usize = 4096;
const MAX_LIST_LIMIT: u32 = 50;
// One hack can take several assets on several chains, and each asset is a case on Pactum.
const MAX_CASES_PER_OFFER: usize = 12;
// A NEAR transaction has at most 300 Tgas. Each signature needs SIGN_GAS + CALLBACK_GAS = 60 Tgas, plus about
// 10 Tgas to create two receipts. Offers with more cases keep signing through `retry_signature`.
const SIGNATURES_PER_CALL: usize = 3;
// The chain list is read on every proposal, so it stays small.
const MAX_CHAINS: usize = 32;
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
    ChainProposals,
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
    next_chain_proposal_id: u64,
    chain_proposals: LookupMap<u64, ChainProposal>,
    // Case ids and nonces are per chain, because each chain has its own Pactum contract.
    used_case_ids: LookupSet<(u64, [u8; 32])>,
    used_nonces: LookupSet<(u64, u64)>,
}

#[near]
impl PactumController {
    /// Initialized once. No function changes these values later, except adding a new chain
    /// by vote (`propose_chain`). An existing chain cannot be edited or removed.
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
        require!(deployments.len() <= MAX_CHAINS, "too many chains");
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
            next_chain_proposal_id: 0,
            chain_proposals: LookupMap::new(StorageKey::ChainProposals),
            used_case_ids: LookupSet::new(StorageKey::UsedCaseIds),
            used_nonces: LookupSet::new(StorageKey::UsedNonces),
        }
    }

    /// A guardian proposes an offer: one text and the cases it applies to, possibly on several chains.
    /// Every term is checked and hashed at once and cannot change afterwards. `evidence` is the offer text and
    /// the public record. Its hash must equal the `evidence_hash` of every case, so guardians read exactly
    /// what they approve on NEAR, and one text cannot carry two different contents on two chains.
    pub fn propose_offer(&mut self, cases: Vec<CaseTerms>, evidence: String) -> U64 {
        self.require_guardian();
        require!(!cases.is_empty() && cases.len() <= MAX_CASES_PER_OFFER, "case count must be between 1 and 12");
        require!(evidence.len() <= MAX_EVIDENCE_BYTES, "evidence is too long");
        let evidence_hash = env::keccak256_array(evidence.as_bytes());

        let mut proposal_cases = Vec::with_capacity(cases.len());
        for terms in cases {
            let parsed = self.validate_terms(&terms);
            require!(parsed.evidence_hash == evidence_hash, "evidence does not match evidence_hash");
            require!(self.used_case_ids.insert((parsed.chain_id, parsed.case_id)), "case_id already proposed");
            require!(self.used_nonces.insert((parsed.chain_id, parsed.nonce)), "nonce already used");
            let digest = to_hex(&eip712::case_digest(&parsed, &self.pactum_on(parsed.chain_id)));
            proposal_cases.push(ProposalCase { terms, digest, status: CaseStatus::Unsigned, signature: None });
        }

        let id = self.next_proposal_id;
        self.next_proposal_id += 1;
        self.proposals.insert(
            id,
            Proposal {
                id: U64(id),
                cases: proposal_cases,
                evidence,
                proposer: env::predecessor_account_id(),
                approvals: Vec::new(),
                status: ProposalStatus::Pending,
            },
        );
        U64(id)
    }

    /// A guardian approves. At the threshold, the contract requests MPC signatures in the same transaction
    /// for at most `SIGNATURES_PER_CALL` cases. Attach enough gas, or the transaction rolls back, approval included.
    pub fn approve_offer(&mut self, proposal_id: U64) {
        self.require_guardian();
        let caller = env::predecessor_account_id();
        let threshold = self.threshold as usize;
        let proposal = self.proposal_mut(proposal_id.0);
        require!(proposal.status == ProposalStatus::Pending, "proposal is not pending");
        require!(!proposal.approvals.contains(&caller), "already approved");
        proposal.approvals.push(caller);

        if proposal.approvals.len() >= threshold {
            proposal.status = ProposalStatus::Approved;
            self.start_signing(proposal_id.0);
        }
    }

    /// Signs the remaining cases, or signs again after a failure, for example an MPC timeout.
    /// Anyone can call it, because the hashes are already approved and only those hashes get signed.
    pub fn retry_signature(&mut self, proposal_id: U64) {
        let proposal = self.proposal_mut(proposal_id.0);
        require!(
            proposal.status == ProposalStatus::Approved
                && proposal.cases.iter().any(|item| item.status == CaseStatus::Unsigned),
            "proposal is not awaiting a signature"
        );
        self.start_signing(proposal_id.0);
    }

    /// Receives the MPC contract's result and stores the signature so anyone can read it and submit it to an EVM chain.
    /// Reads the result directly instead of using `#[callback_result]`: a malformed response would make that macro panic,
    /// leaving the case stuck in `Signing` forever with no way to sign again. Here every failure returns to `Unsigned`.
    #[private]
    pub fn on_signed(&mut self, proposal_id: U64, index: u32) -> Option<String> {
        let signature = env::promise_result_checked(0, MAX_SIGN_RESPONSE_BYTES)
            .ok()
            .and_then(|bytes| near_sdk::serde_json::from_slice::<SignResponse>(&bytes).ok())
            .and_then(|response| evm_signature(&response));
        let proposal = self.proposal_mut(proposal_id.0);
        let item = &mut proposal.cases[index as usize];
        item.status = if signature.is_some() { CaseStatus::Signed } else { CaseStatus::Unsigned };
        item.signature = signature.clone();
        if proposal.cases.iter().all(|item| item.status == CaseStatus::Signed) {
            proposal.status = ProposalStatus::Signed;
        }
        signature
    }

    /// A guardian proposes adding a chain, for example when funds move to a chain that is not served yet.
    /// This cannot affect cases on other chains: each signature is bound to one chain id and one
    /// contract address, so even if a new chain names a fake contract, signatures for it are useless elsewhere.
    pub fn propose_chain(&mut self, chain_id: U64, pactum: String) -> U64 {
        self.require_guardian();
        require!(!self.serves(chain_id.0), "chain_id is already served");
        require!(parse_hex_fixed::<20>(&pactum).is_some(), "pactum must be 20-byte hex");
        let id = self.next_chain_proposal_id;
        self.next_chain_proposal_id += 1;
        self.chain_proposals.insert(
            id,
            ChainProposal {
                id: U64(id),
                chain_id,
                pactum,
                proposer: env::predecessor_account_id(),
                approvals: Vec::new(),
                status: ChainProposalStatus::Pending,
            },
        );
        U64(id)
    }

    /// A guardian approves a new chain. At the threshold it is added at once, with the same signing address as the others.
    pub fn approve_chain(&mut self, proposal_id: U64) {
        self.require_guardian();
        let caller = env::predecessor_account_id();
        let threshold = self.threshold as usize;
        let proposal = self
            .chain_proposals
            .get_mut(&proposal_id.0)
            .unwrap_or_else(|| env::panic_str("chain proposal not found"));
        require!(proposal.status == ChainProposalStatus::Pending, "chain proposal is not pending");
        require!(!proposal.approvals.contains(&caller), "already approved");
        proposal.approvals.push(caller);
        if proposal.approvals.len() < threshold {
            return;
        }
        proposal.status = ChainProposalStatus::Added;
        let chain_id = proposal.chain_id.0;
        let pactum = parse_hex_fixed(&proposal.pactum).unwrap_or_else(|| env::panic_str("pactum must be 20-byte hex"));
        // Check again: another proposal for the same chain may have reached the threshold first. An existing chain is never overwritten.
        require!(!self.serves(chain_id), "chain_id is already served");
        require!(self.deployments.len() < MAX_CHAINS, "too many chains");
        self.deployments.push((chain_id, pactum));
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

    pub fn list_chain_proposals(&self, from: U64, limit: u32) -> Vec<ChainProposal> {
        let end = from.0.saturating_add(u64::from(limit.min(MAX_LIST_LIMIT))).min(self.next_chain_proposal_id);
        (from.0..end).filter_map(|id| self.chain_proposals.get(&id).cloned()).collect()
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

    fn serves(&self, chain_id: u64) -> bool {
        self.deployments.iter().any(|(known, _)| *known == chain_id)
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
        require!(self.serves(parsed.chain_id), "chain_id is not served by this controller");
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
    // Each case is an independent request, so one failed signature does not drag the others down.
    fn start_signing(&mut self, id: u64) {
        let path = self.derivation_path.clone();
        let signer = self.signer_contract.clone();
        let proposal = self.proposal_mut(id);
        for (index, item) in proposal
            .cases
            .iter_mut()
            .enumerate()
            .filter(|(_, item)| item.status == CaseStatus::Unsigned)
            .take(SIGNATURES_PER_CALL)
        {
            item.status = CaseStatus::Signing;
            let payload = item.digest.trim_start_matches("0x").to_string();
            let request = SignRequest {
                path: path.clone(),
                payload_v2: SignPayload::Ecdsa(payload),
                domain_id: SECP256K1_DOMAIN_ID,
            };
            ext_signer::ext(signer.clone())
                .with_attached_deposit(SIGN_DEPOSIT)
                .with_static_gas(SIGN_GAS)
                .sign(request)
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(CALLBACK_GAS)
                        .on_signed(U64(id), index as u32),
                )
                .detach();
        }
    }
}
