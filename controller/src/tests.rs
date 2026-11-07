//! Unit tests from section 13: below threshold, duplicate approval, stranger approval, bad terms, hash checks.

use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{env, test_vm_config, testing_env, AccountId, NearToken, PromiseResult, RuntimeFeesConfig};

use crate::types::{
    evm_signature, parse_hex_fixed, parse_uint256, to_hex, BigR, CaseStatus, CaseTerms, ChainProposalStatus,
    Deployment, GuardianProposalStatus, ProposalStatus, RewardTier, Scalar, SignResponse,
};
use crate::PactumController;

const SEPOLIA: u64 = 11_155_111;
const BASE_SEPOLIA: u64 = 84_532;
const DESK: &str = "0x1111111111111111111111111111111111111111";
const BASE_DESK: &str = "0x5555555555555555555555555555555555555555";
const EVIDENCE: &str = "Keep 10% within 72 hours, 5% within 7 days.";
const NOW_SECONDS: u64 = 1_800_000_000;
const VECTORS: &str = include_str!("../../contracts/test/vectors/case_terms.json");

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn set_caller(name: &str) {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(account("controller.testnet"))
        .predecessor_account_id(account(name))
        .attached_deposit(NearToken::from_near(1))
        .block_timestamp(NOW_SECONDS * 1_000_000_000)
        .prepaid_gas(near_sdk::Gas::from_tgas(300));
    testing_env!(context.build());
}

fn set_caller_with_deposit(name: &str, deposit: NearToken) {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(account("controller.testnet"))
        .predecessor_account_id(account(name))
        .attached_deposit(deposit)
        .block_timestamp(NOW_SECONDS * 1_000_000_000)
        .prepaid_gas(near_sdk::Gas::from_tgas(300));
    testing_env!(context.build());
}

// Calls on_signed the way the contract calls itself back, with a given result from the MPC contract.
fn deliver(c: &mut PactumController, id: U64, result: PromiseResult) -> Option<String> {
    deliver_case(c, id, 0, result)
}

fn deliver_case(c: &mut PactumController, id: U64, index: u32, result: PromiseResult) -> Option<String> {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(account("controller.testnet"))
        .predecessor_account_id(account("controller.testnet"))
        .block_timestamp(NOW_SECONDS * 1_000_000_000)
        .prepaid_gas(near_sdk::Gas::from_tgas(300));
    testing_env!(
        context.build(),
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
    c.on_signed(id, index)
}

fn response_bytes() -> Vec<u8> {
    serde_json::to_vec(&signature_response()).unwrap()
}

fn deployment(chain_id: u64, pactum: &str) -> Deployment {
    Deployment { chain_id: U64(chain_id), pactum: pactum.to_string() }
}

fn evidence_hash(text: &str) -> String {
    to_hex(&env::keccak256_array(text.as_bytes()))
}

fn contract(threshold: u32) -> PactumController {
    set_caller("deployer.testnet");
    PactumController::new(
        vec![account("alice.testnet"), account("bob.testnet"), account("carol.testnet")],
        threshold,
        vec![deployment(SEPOLIA, DESK), deployment(BASE_SEPOLIA, BASE_DESK)],
        "pactum-1".to_string(),
        account("v1.signer-prod.testnet"),
        2000,
    )
}

fn terms() -> CaseTerms {
    CaseTerms {
        case_id: format!("0x{}", "01".repeat(32)),
        token: format!("0x{}", "22".repeat(20)),
        total_loss: "1000000000000000000000000".to_string(),
        max_return: "1000000000000000000000000".to_string(),
        reward_cap: "150000000000000000000000".to_string(),
        refund_root: format!("0x{}", "33".repeat(32)),
        evidence_hash: evidence_hash(EVIDENCE),
        tiers: vec![
            RewardTier { until: U64(NOW_SECONDS + 259_200), reward_bps: 1000 },
            RewardTier { until: U64(NOW_SECONDS + 604_800), reward_bps: 500 },
        ],
        nonce: U64(1),
        chain_id: U64(SEPOLIA),
    }
}

fn propose(c: &mut PactumController) -> U64 {
    set_caller("alice.testnet");
    c.propose_offer(vec![terms()], EVIDENCE.to_string())
}

fn status(c: &PactumController, id: U64) -> ProposalStatus {
    c.get_proposal(id).unwrap().status
}

fn signature_response() -> SignResponse {
    SignResponse {
        big_r: BigR {
            affine_point: "034e3cb210ca4197413b2066175a8a81a78e497e499f44116407e9371ce8a8dd99".to_string(),
        },
        s: Scalar {
            scalar: "7cf8899358fe262a83ce4b1e4a98d157450203adab4a212847e48ef0c20c34f7".to_string(),
        },
        recovery_id: 0,
    }
}

fn sign_receipts() -> Vec<near_sdk::mock::Receipt> {
    get_created_receipts().into_iter().filter(|receipt| receipt.receiver_id == account("v1.signer-prod.testnet")).collect()
}

// Moves the proposal into signing with a threshold of 2.
fn approved_and_signing(c: &mut PactumController) -> U64 {
    let id = propose(c);
    set_caller("alice.testnet");
    c.approve_offer(id);
    set_caller("bob.testnet");
    c.approve_offer(id);
    id
}

#[test]
#[should_panic(expected = "threshold must be between")]
fn init_rejects_threshold_above_guardian_count() {
    set_caller("deployer.testnet");
    PactumController::new(
        vec![account("alice.testnet")],
        2,
        vec![deployment(SEPOLIA, DESK)],
        "p".to_string(),
        account("v1.signer-prod.testnet"),
        2000,
    );
}

#[test]
#[should_panic(expected = "threshold must be between")]
fn init_rejects_zero_threshold() {
    contract(0);
}

#[test]
#[should_panic(expected = "duplicate guardian")]
fn init_rejects_duplicate_guardians() {
    set_caller("deployer.testnet");
    PactumController::new(
        vec![account("alice.testnet"), account("alice.testnet")],
        1,
        vec![deployment(SEPOLIA, DESK)],
        "p".to_string(),
        account("v1.signer-prod.testnet"),
        2000,
    );
}

#[test]
#[should_panic(expected = "caller is not a guardian")]
fn stranger_cannot_propose() {
    let mut c = contract(2);
    set_caller("mallory.testnet");
    c.propose_offer(vec![terms()], EVIDENCE.to_string());
}

#[test]
#[should_panic(expected = "caller is not a guardian")]
fn stranger_cannot_approve() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("mallory.testnet");
    c.approve_offer(id);
}

#[test]
fn below_threshold_does_not_request_a_signature() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("alice.testnet");
    c.approve_offer(id);
    assert_eq!(status(&c, id), ProposalStatus::Pending);
    assert!(get_created_receipts().is_empty());
}

#[test]
#[should_panic(expected = "already approved")]
fn same_guardian_cannot_approve_twice() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("alice.testnet");
    c.approve_offer(id);
    set_caller("alice.testnet");
    c.approve_offer(id);
}

#[test]
fn threshold_requests_a_signature_for_the_exact_digest() {
    let mut c = contract(2);
    let id = approved_and_signing(&mut c);
    let proposal = c.get_proposal(id).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Approved);
    assert_eq!(proposal.cases[0].status, CaseStatus::Signing);
    assert_eq!(proposal.cases[0].digest, c.case_digest(terms()));

    let receipts = sign_receipts();
    assert_eq!(receipts.len(), 1);
    let payload = proposal.cases[0].digest.trim_start_matches("0x");
    let args = sign_args(&receipts[0]);
    assert_eq!(args["request"]["payload_v2"]["Ecdsa"], Value::String(payload.to_string()));
    assert_eq!(args["request"]["path"], "pactum-1");
    assert_eq!(args["request"]["domain_id"], 0);
}

fn sign_args(receipt: &near_sdk::mock::Receipt) -> Value {
    for action in &receipt.actions {
        if let near_sdk::mock::MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } = action {
            assert_eq!(String::from_utf8_lossy(method_name), "sign");
            assert_eq!(attached_deposit.as_yoctonear(), 1);
            return serde_json::from_slice(args).unwrap();
        }
    }
    panic!("receipt has no function call");
}

#[test]
#[should_panic(expected = "proposal is not pending")]
fn cannot_approve_after_threshold() {
    let mut c = contract(2);
    let id = approved_and_signing(&mut c);
    set_caller("carol.testnet");
    c.approve_offer(id);
}

#[test]
fn stores_signature_for_anyone_to_read() {
    let mut c = contract(2);
    let id = approved_and_signing(&mut c);
    let signature = deliver(&mut c, id, PromiseResult::Successful(response_bytes()));
    let proposal = c.get_proposal(id).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Signed);
    assert_eq!(proposal.cases[0].status, CaseStatus::Signed);
    assert_eq!(proposal.cases[0].signature, signature);
    let expected = "0x4e3cb210ca4197413b2066175a8a81a78e497e499f44116407e9371ce8a8dd997cf8899358fe262a83ce4b1e4a98d157450203adab4a212847e48ef0c20c34f71b";
    assert_eq!(proposal.cases[0].signature.as_deref(), Some(expected));
}

#[test]
fn failed_signature_can_be_retried_by_anyone() {
    let mut c = contract(2);
    let id = approved_and_signing(&mut c);
    assert_eq!(deliver(&mut c, id, PromiseResult::Failed), None);
    assert_eq!(status(&c, id), ProposalStatus::Approved);
    assert_eq!(c.get_proposal(id).unwrap().cases[0].status, CaseStatus::Unsigned);

    set_caller("mallory.testnet");
    c.retry_signature(id);
    let proposal = c.get_proposal(id).unwrap();
    assert_eq!(proposal.cases[0].status, CaseStatus::Signing);
    assert_eq!(proposal.cases[0].digest, c.case_digest(terms()));
}

// A bad response must not leave the proposal stuck: it must return to Approved so it can be signed again.
#[test]
fn malformed_responses_return_to_approved() {
    let bad_results: Vec<Vec<u8>> = vec![
        b"not json".to_vec(),
        b"{}".to_vec(),
        br#"{"big_r":{"affine_point":"abcd"},"s":{"scalar":"00"},"recovery_id":0}"#.to_vec(),
        br#"{"signature":"ed25519:xyz"}"#.to_vec(),
        vec![b'x'; 5000],
    ];
    let mut c = contract(2);
    for (index, bytes) in bad_results.into_iter().enumerate() {
        let mut distinct = terms();
        distinct.case_id = format!("0x{:064x}", index + 100);
        distinct.nonce = U64(index as u64 + 100);
        set_caller("alice.testnet");
        let id = c.propose_offer(vec![distinct], EVIDENCE.to_string());
        c.approve_offer(id);
        set_caller("bob.testnet");
        c.approve_offer(id);
        assert_eq!(deliver(&mut c, id, PromiseResult::Successful(bytes)), None);
        let proposal = c.get_proposal(id).unwrap();
        assert_eq!(proposal.status, ProposalStatus::Approved);
        assert_eq!(proposal.cases[0].status, CaseStatus::Unsigned);
        assert_eq!(proposal.cases[0].signature, None);
    }
}

#[test]
#[should_panic(expected = "proposal is not awaiting a signature")]
fn cannot_retry_before_approval() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("mallory.testnet");
    c.retry_signature(id);
}

#[test]
#[should_panic(expected = "proposal is not awaiting a signature")]
fn cannot_sign_again_once_signed() {
    let mut c = contract(2);
    let id = approved_and_signing(&mut c);
    deliver(&mut c, id, PromiseResult::Successful(response_bytes()));
    set_caller("mallory.testnet");
    c.retry_signature(id);
}

// `#[private]` on on_signed only applies in wasm, so it is checked on testnet in scripts/demo.ts.

#[test]
#[should_panic(expected = "proposal not found")]
fn cannot_approve_unknown_proposal() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    c.approve_offer(U64(9));
}

#[test]
#[should_panic(expected = "case_id already proposed")]
fn rejects_duplicate_case_id() {
    let mut c = contract(2);
    propose(&mut c);
    let mut again = terms();
    again.nonce = U64(2);
    c.propose_offer(vec![again], EVIDENCE.to_string());
}

#[test]
#[should_panic(expected = "nonce already used")]
fn rejects_duplicate_nonce() {
    let mut c = contract(2);
    propose(&mut c);
    let mut again = terms();
    again.case_id = format!("0x{}", "02".repeat(32));
    c.propose_offer(vec![again], EVIDENCE.to_string());
}

// Checks that bad terms are rejected with exactly the expected message.
fn assert_rejected(change: impl Fn(&mut CaseTerms), expected: &str) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut c = contract(2);
        let mut bad = terms();
        change(&mut bad);
        set_caller("alice.testnet");
        c.propose_offer(vec![bad], EVIDENCE.to_string());
    }));
    let message = result.expect_err("terms should be rejected");
    let text = message
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| message.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default();
    assert!(text.contains(expected), "expected {expected:?}, got {text:?}");
}

#[test]
fn rejects_invalid_terms() {
    assert_rejected(|t| t.tiers[0].reward_bps = 2001, "reward exceeds the global maximum");
    assert_rejected(|t| t.tiers[1].reward_bps = 1000, "tier rewards must decrease");
    assert_rejected(|t| t.tiers[1].reward_bps = 1500, "tier rewards must decrease");
    assert_rejected(|t| t.tiers[1].until = t.tiers[0].until, "tier deadlines must increase");
    assert_rejected(|t| t.tiers.clear(), "tier count");
    assert_rejected(
        |t| t.tiers = vec![RewardTier { until: U64(NOW_SECONDS + 1), reward_bps: 1 }; 9],
        "tier count",
    );
    assert_rejected(
        |t| {
            t.tiers = vec![RewardTier { until: U64(NOW_SECONDS - 1), reward_bps: 100 }];
        },
        "last tier already passed",
    );
    assert_rejected(|t| t.chain_id = U64(1), "chain_id is not served by this controller");
    assert_rejected(|t| t.total_loss = "0".to_string(), "total_loss must not be zero");
    assert_rejected(|t| t.max_return = "0".to_string(), "max_return must not be zero");
    assert_rejected(
        |t| t.max_return = "1000000000000000000000001".to_string(),
        "max_return exceeds total_loss",
    );
    assert_rejected(|t| t.case_id = format!("0x{}", "00".repeat(32)), "case_id must not be zero");
    assert_rejected(|t| t.token = format!("0x{}", "00".repeat(20)), "token must not be zero");
    assert_rejected(|t| t.refund_root = format!("0x{}", "00".repeat(32)), "refund_root must not be zero");
    assert_rejected(|t| t.case_id = "0x01".to_string(), "case_id must be 32-byte hex");
    assert_rejected(|t| t.token = "22".repeat(20), "token must be 20-byte hex");
    assert_rejected(|t| t.total_loss = "abc".to_string(), "total_loss must be a uint256");
    assert_rejected(|t| t.total_loss = "01".to_string(), "total_loss must be a uint256");
}

#[test]
fn parses_uint256_boundaries() {
    let max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    assert_eq!(parse_uint256(max), Some([0xff; 32]));
    let overflow = "115792089237316195423570985008687907853269984665640564039457584007913129639936";
    assert_eq!(parse_uint256(overflow), None);
    assert_eq!(parse_uint256(""), None);
    let mut one = [0u8; 32];
    one[31] = 1;
    assert_eq!(parse_uint256("1"), Some(one));
    let mut thousand = [0u8; 32];
    thousand[30] = 0x03;
    thousand[31] = 0xe8;
    assert_eq!(parse_uint256("1000"), Some(thousand));
}

#[test]
fn signature_conversion_rejects_bad_input() {
    let mut response = signature_response();
    response.recovery_id = 2;
    assert_eq!(evm_signature(&response), None);
    let mut response = signature_response();
    response.big_r.affine_point = "abcd".to_string();
    assert_eq!(evm_signature(&response), None);
    assert_eq!(to_hex(&[0xab, 0x01]), "0xab01");
    assert_eq!(parse_hex_fixed::<2>("0xAB01"), Some([0xab, 0x01]));
}

// Hash check: Foundry checks the same vector file against the real Solidity contract.
#[test]
fn digest_matches_shared_vectors() {
    let vectors: Value = serde_json::from_str(VECTORS).unwrap();
    let list = vectors["vectors"].as_array().unwrap();
    assert!(list.len() >= 4);
    for vector in list {
        set_caller("deployer.testnet");
        let terms_json = &vector["terms"];
        let terms = CaseTerms {
            case_id: terms_json["caseId"].as_str().unwrap().to_string(),
            token: terms_json["token"].as_str().unwrap().to_string(),
            total_loss: terms_json["totalLoss"].as_str().unwrap().to_string(),
            max_return: terms_json["maxReturn"].as_str().unwrap().to_string(),
            reward_cap: terms_json["rewardCap"].as_str().unwrap().to_string(),
            refund_root: terms_json["refundRoot"].as_str().unwrap().to_string(),
            evidence_hash: terms_json["evidenceHash"].as_str().unwrap().to_string(),
            tiers: terms_json["tiers"]
                .as_array()
                .unwrap()
                .iter()
                .map(|tier| RewardTier {
                    until: U64(tier["until"].as_str().unwrap().parse().unwrap()),
                    reward_bps: tier["rewardBps"].as_u64().unwrap() as u16,
                })
                .collect(),
            nonce: U64(terms_json["nonce"].as_str().unwrap().parse().unwrap()),
            chain_id: U64(terms_json["chainId"].as_str().unwrap().parse().unwrap()),
        };
        let c = PactumController::new(
            vec![account("alice.testnet")],
            1,
            vec![deployment(terms.chain_id.0, vector["verifyingContract"].as_str().unwrap())],
            "p".to_string(),
            account("v1.signer-prod.testnet"),
            10_000,
        );
        assert_eq!(c.case_digest(terms), vector["digest"].as_str().unwrap());
    }
}

// This must match the EVM's keccak256, or no proposal would ever be valid for the Solidity contract.
#[test]
fn evidence_hash_matches_evm_keccak() {
    set_caller("alice.testnet");
    assert_eq!(
        evidence_hash("Test offer: keep 10 percent"),
        "0x4a73c11c58a2d50f2ace0ba9406cfde1c2331fc5f50e7fbe1c41fa6e354a7420"
    );
}

#[test]
#[should_panic(expected = "deployments must not be empty")]
fn init_rejects_no_deployments() {
    set_caller("deployer.testnet");
    PactumController::new(vec![account("alice.testnet")], 1, vec![], "p".to_string(), account("v1.signer-prod.testnet"), 2000);
}

#[test]
#[should_panic(expected = "duplicate chain_id")]
fn init_rejects_the_same_chain_twice() {
    set_caller("deployer.testnet");
    PactumController::new(
        vec![account("alice.testnet")],
        1,
        vec![deployment(SEPOLIA, DESK), deployment(SEPOLIA, BASE_DESK)],
        "p".to_string(),
        account("v1.signer-prod.testnet"),
        2000,
    );
}

#[test]
#[should_panic(expected = "pactum must be 20-byte hex")]
fn init_rejects_a_bad_pactum_address() {
    set_caller("deployer.testnet");
    PactumController::new(
        vec![account("alice.testnet")],
        1,
        vec![deployment(SEPOLIA, "0x1234")],
        "p".to_string(),
        account("v1.signer-prod.testnet"),
        2000,
    );
}

#[test]
fn config_lists_every_chain() {
    let c = contract(2);
    let chains = c.get_config().deployments;
    assert_eq!(chains, vec![deployment(SEPOLIA, DESK), deployment(BASE_SEPOLIA, BASE_DESK)]);
}

fn on_base() -> CaseTerms {
    let mut base = terms();
    base.chain_id = U64(BASE_SEPOLIA);
    base
}

// The same terms on two chains must hash differently, or a signature for one chain would work on the other.
#[test]
fn each_chain_has_its_own_digest() {
    let c = contract(2);
    let sepolia = c.case_digest(terms());
    let base = c.case_digest(on_base());
    assert_ne!(sepolia, base);

    // The same chain id with a different contract address must also hash differently.
    let mut other_address = contract(2);
    other_address.deployments = vec![(BASE_SEPOLIA, [0x77; 20])];
    assert_ne!(other_address.case_digest(on_base()), base);
}

#[test]
fn separate_offers_can_reuse_a_case_id_on_another_chain() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    let first = c.propose_offer(vec![terms()], EVIDENCE.to_string());
    let second = c.propose_offer(vec![on_base()], EVIDENCE.to_string());
    assert_ne!(first, second);
}

// The main upgrade: one text, one approval round, and a separate signature for each chain.
#[test]
fn one_approval_round_signs_every_chain() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    let id = c.propose_offer(vec![terms(), on_base()], EVIDENCE.to_string());
    c.approve_offer(id);
    assert!(sign_receipts().is_empty(), "signed below threshold");
    set_caller("bob.testnet");
    c.approve_offer(id);

    let proposal = c.get_proposal(id).unwrap();
    assert_eq!(proposal.approvals.len(), 2);
    assert_eq!(proposal.status, ProposalStatus::Approved);
    let receipts = sign_receipts();
    assert_eq!(receipts.len(), 2);
    for (receipt, item) in receipts.iter().zip(&proposal.cases) {
        assert_eq!(item.status, CaseStatus::Signing);
        let args = sign_args(receipt);
        assert_eq!(args["request"]["payload_v2"]["Ecdsa"], Value::String(item.digest.trim_start_matches("0x").to_string()));
        // The same derivation path means the same signing address on every chain.
        assert_eq!(args["request"]["path"], "pactum-1");
    }
    assert_ne!(proposal.cases[0].digest, proposal.cases[1].digest);
}

#[test]
fn offer_is_signed_only_when_every_case_is_signed() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    let id = c.propose_offer(vec![terms(), on_base()], EVIDENCE.to_string());
    c.approve_offer(id);
    set_caller("bob.testnet");
    c.approve_offer(id);

    deliver_case(&mut c, id, 1, PromiseResult::Successful(response_bytes()));
    let proposal = c.get_proposal(id).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Approved);
    assert_eq!(proposal.cases[0].status, CaseStatus::Signing);
    assert_eq!(proposal.cases[1].status, CaseStatus::Signed);

    deliver_case(&mut c, id, 0, PromiseResult::Successful(response_bytes()));
    assert_eq!(status(&c, id), ProposalStatus::Signed);
}

// One chain failing to sign must not lose another chain's signature, and signing again only signs what is missing.
#[test]
fn a_failed_case_retries_alone() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    let id = c.propose_offer(vec![terms(), on_base()], EVIDENCE.to_string());
    c.approve_offer(id);
    set_caller("bob.testnet");
    c.approve_offer(id);
    let signed = deliver_case(&mut c, id, 0, PromiseResult::Successful(response_bytes()));
    assert!(signed.is_some());
    assert_eq!(deliver_case(&mut c, id, 1, PromiseResult::Failed), None);

    set_caller("mallory.testnet");
    c.retry_signature(id);
    let receipts = sign_receipts();
    assert_eq!(receipts.len(), 1);
    let proposal = c.get_proposal(id).unwrap();
    assert_eq!(sign_args(&receipts[0])["request"]["payload_v2"]["Ecdsa"], Value::String(proposal.cases[1].digest.trim_start_matches("0x").to_string()));
    assert_eq!(proposal.cases[0].signature, signed);
}

fn numbered(index: u64) -> CaseTerms {
    let mut item = terms();
    item.case_id = format!("0x{:064x}", index + 1);
    item.nonce = U64(index);
    item
}

// One transaction only has gas for 3 signatures, so larger offers keep signing through retry_signature.
#[test]
fn large_offer_signs_in_batches() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    let id = c.propose_offer((0..5).map(numbered).collect(), EVIDENCE.to_string());
    c.approve_offer(id);
    set_caller("bob.testnet");
    c.approve_offer(id);
    assert_eq!(sign_receipts().len(), 3);

    set_caller("mallory.testnet");
    c.retry_signature(id);
    assert_eq!(sign_receipts().len(), 2);
    let proposal = c.get_proposal(id).unwrap();
    assert!(proposal.cases.iter().all(|item| item.status == CaseStatus::Signing));
}

#[test]
#[should_panic(expected = "proposal is not awaiting a signature")]
fn cannot_retry_while_every_case_is_signing() {
    let mut c = contract(2);
    let id = approved_and_signing(&mut c);
    set_caller("mallory.testnet");
    c.retry_signature(id);
}

#[test]
#[should_panic(expected = "case count must be between 1 and 12")]
fn rejects_an_empty_offer() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    c.propose_offer(vec![], EVIDENCE.to_string());
}

#[test]
#[should_panic(expected = "case count must be between 1 and 12")]
fn rejects_too_many_cases() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    c.propose_offer((0..13).map(numbered).collect(), EVIDENCE.to_string());
}

#[test]
#[should_panic(expected = "evidence does not match evidence_hash")]
fn every_case_must_carry_the_same_text() {
    let mut c = contract(2);
    let mut other = on_base();
    other.evidence_hash = evidence_hash("A softer offer on another chain");
    set_caller("alice.testnet");
    c.propose_offer(vec![terms(), other], EVIDENCE.to_string());
}

#[test]
#[should_panic(expected = "reward exceeds the global maximum")]
fn one_bad_case_rejects_the_whole_offer() {
    let mut c = contract(2);
    let mut high = on_base();
    high.tiers[0].reward_bps = 2001;
    set_caller("alice.testnet");
    c.propose_offer(vec![terms(), high], EVIDENCE.to_string());
}

#[test]
#[should_panic(expected = "case_id already proposed")]
fn rejects_the_same_case_twice_in_one_offer() {
    let mut c = contract(2);
    let mut again = terms();
    again.nonce = U64(2);
    set_caller("alice.testnet");
    c.propose_offer(vec![terms(), again], EVIDENCE.to_string());
}

const NEW_CHAIN: u64 = 46_630;
const NEW_DESK: &str = "0x6666666666666666666666666666666666666666";

fn vote_chain(c: &mut PactumController) -> U64 {
    set_caller("alice.testnet");
    c.propose_chain(U64(NEW_CHAIN), NEW_DESK.to_string())
}

#[test]
fn guardians_can_vote_in_a_new_chain() {
    let mut c = contract(2);
    let id = vote_chain(&mut c);
    let mut new_terms = terms();
    new_terms.chain_id = U64(NEW_CHAIN);

    c.approve_chain(id);
    assert_eq!(c.get_config().deployments.len(), 2, "added below threshold");
    assert_eq!(c.list_chain_proposals(U64(0), 10)[0].status, ChainProposalStatus::Pending);

    set_caller("bob.testnet");
    c.approve_chain(id);
    assert_eq!(c.get_config().deployments.last(), Some(&deployment(NEW_CHAIN, NEW_DESK)));
    assert_eq!(c.list_chain_proposals(U64(0), 10)[0].status, ChainProposalStatus::Added);

    // A new chain works at once, and the hash is bound to the right contract on that chain.
    let id = c.propose_offer(vec![new_terms.clone()], EVIDENCE.to_string());
    assert_eq!(c.get_proposal(id).unwrap().cases[0].digest, c.case_digest(new_terms));
}

// Adding a chain must not change the derivation path, because the path decides the signing address on every chain.
#[test]
fn adding_a_chain_keeps_the_signing_path() {
    let mut c = contract(2);
    let before = c.get_config().derivation_path;
    let id = vote_chain(&mut c);
    c.approve_chain(id);
    set_caller("bob.testnet");
    c.approve_chain(id);
    assert_eq!(c.get_config().derivation_path, before);
}

#[test]
#[should_panic(expected = "caller is not a guardian")]
fn stranger_cannot_propose_a_chain() {
    let mut c = contract(2);
    set_caller("mallory.testnet");
    c.propose_chain(U64(NEW_CHAIN), NEW_DESK.to_string());
}

#[test]
#[should_panic(expected = "caller is not a guardian")]
fn stranger_cannot_approve_a_chain() {
    let mut c = contract(2);
    let id = vote_chain(&mut c);
    set_caller("mallory.testnet");
    c.approve_chain(id);
}

#[test]
#[should_panic(expected = "already approved")]
fn same_guardian_cannot_add_a_chain_alone() {
    let mut c = contract(2);
    let id = vote_chain(&mut c);
    c.approve_chain(id);
    c.approve_chain(id);
}

// Most important: a vote must not replace the contract of a chain already in use.
#[test]
#[should_panic(expected = "chain_id is already served")]
fn cannot_replace_a_served_chain() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    c.propose_chain(U64(SEPOLIA), NEW_DESK.to_string());
}

#[test]
#[should_panic(expected = "chain_id is already served")]
fn second_proposal_for_a_chain_cannot_overwrite_the_first() {
    let mut c = contract(2);
    let first = vote_chain(&mut c);
    let second = c.propose_chain(U64(NEW_CHAIN), "0x7777777777777777777777777777777777777777".to_string());
    c.approve_chain(first);
    c.approve_chain(second);
    set_caller("bob.testnet");
    c.approve_chain(first);
    c.approve_chain(second);
}

#[test]
#[should_panic(expected = "chain proposal is not pending")]
fn cannot_approve_an_added_chain_again() {
    let mut c = contract(2);
    let id = vote_chain(&mut c);
    c.approve_chain(id);
    set_caller("bob.testnet");
    c.approve_chain(id);
    set_caller("carol.testnet");
    c.approve_chain(id);
}

#[test]
#[should_panic(expected = "pactum must be 20-byte hex")]
fn rejects_a_bad_address_for_a_new_chain() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    c.propose_chain(U64(NEW_CHAIN), "0x1234".to_string());
}

#[test]
#[should_panic(expected = "chain proposal not found")]
fn cannot_approve_an_unknown_chain_proposal() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    c.approve_chain(U64(9));
}

#[test]
#[should_panic(expected = "reward exceeds the global maximum")]
fn the_reward_limit_applies_on_every_chain() {
    let mut c = contract(2);
    let mut high = on_base();
    high.tiers[0].reward_bps = 2001;
    set_caller("alice.testnet");
    c.propose_offer(vec![high], EVIDENCE.to_string());
}

#[test]
#[should_panic(expected = "case_id already proposed")]
fn duplicate_case_id_is_still_rejected_on_the_second_chain() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    c.propose_offer(vec![on_base()], EVIDENCE.to_string());
    let mut again = on_base();
    again.nonce = U64(2);
    c.propose_offer(vec![again], EVIDENCE.to_string());
}

#[test]
#[should_panic(expected = "nonce already used")]
fn duplicate_nonce_is_still_rejected_on_the_second_chain() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    c.propose_offer(vec![on_base()], EVIDENCE.to_string());
    let mut again = on_base();
    again.case_id = format!("0x{}", "02".repeat(32));
    c.propose_offer(vec![again], EVIDENCE.to_string());
}

#[test]
#[should_panic(expected = "chain_id is not served by this controller")]
fn digest_view_rejects_an_unknown_chain() {
    let c = contract(2);
    let mut unknown = terms();
    unknown.chain_id = U64(1);
    c.case_digest(unknown);
}

#[test]
fn proposal_stores_the_exact_offer_text() {
    let mut c = contract(2);
    let id = propose(&mut c);
    assert_eq!(c.get_proposal(id).unwrap().evidence, EVIDENCE);
}

#[test]
#[should_panic(expected = "evidence does not match evidence_hash")]
fn guardians_cannot_propose_text_that_differs_from_the_hash() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    c.propose_offer(vec![terms()], format!("{EVIDENCE} Actually keep nothing."));
}

#[test]
#[should_panic(expected = "evidence is too long")]
fn rejects_evidence_over_the_limit() {
    let mut c = contract(2);
    let long = "x".repeat(4097);
    let mut bad = terms();
    bad.evidence_hash = evidence_hash(&long);
    set_caller("alice.testnet");
    c.propose_offer(vec![bad], long);
}

#[test]
fn accepts_evidence_at_the_limit() {
    let mut c = contract(2);
    let long = "x".repeat(4096);
    let mut ok = terms();
    ok.evidence_hash = evidence_hash(&long);
    set_caller("alice.testnet");
    let id = c.propose_offer(vec![ok], long.clone());
    assert_eq!(c.get_proposal(id).unwrap().evidence, long);
}

#[test]
fn lists_proposals_in_order_with_paging() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    for index in 0..3u8 {
        let mut item = terms();
        item.case_id = format!("0x{:064x}", index + 1);
        item.nonce = U64(u64::from(index));
        c.propose_offer(vec![item], EVIDENCE.to_string());
    }
    let ids = |list: Vec<crate::types::Proposal>| list.iter().map(|p| p.id.0).collect::<Vec<_>>();
    assert_eq!(ids(c.list_proposals(U64(0), 10)), vec![0, 1, 2]);
    assert_eq!(ids(c.list_proposals(U64(1), 1)), vec![1]);
    assert_eq!(ids(c.list_proposals(U64(2), 10)), vec![2]);
    assert!(c.list_proposals(U64(3), 10).is_empty());
    assert!(c.list_proposals(U64(u64::MAX), 10).is_empty());
    assert!(c.list_proposals(U64(0), 0).is_empty());
}

#[test]
fn list_limit_is_capped() {
    let mut c = contract(1);
    set_caller("alice.testnet");
    for index in 0..60u64 {
        let mut item = terms();
        item.case_id = format!("0x{:064x}", index + 1);
        item.nonce = U64(index);
        c.propose_offer(vec![item], EVIDENCE.to_string());
    }
    assert_eq!(c.list_proposals(U64(0), 1000).len(), 50);
    assert_eq!(c.list_proposals(U64(50), 1000).len(), 10);
}

// The revocation hash must match viem and Solidity, through the same vector file.
#[test]
fn revoke_digest_matches_shared_vectors() {
    let vectors: Value = serde_json::from_str(VECTORS).unwrap();
    let list = vectors["revocations"].as_array().unwrap();
    assert!(list.len() >= 4);
    for vector in list {
        set_caller("deployer.testnet");
        let chain_id: u64 = vector["chainId"].as_str().unwrap().parse().unwrap();
        let nonce: u64 = vector["nonce"].as_str().unwrap().parse().unwrap();
        let contract: [u8; 20] = parse_hex_fixed(vector["verifyingContract"].as_str().unwrap()).unwrap();
        let digest = to_hex(&crate::eip712::revoke_digest(nonce, chain_id, &contract));
        assert_eq!(digest, vector["digest"].as_str().unwrap(), "{}", vector["name"]);
    }
}

#[test]
#[should_panic(expected = "for storage")]
fn offer_needs_a_deposit_for_storage() {
    let mut c = contract(2);
    set_caller_with_deposit("alice.testnet", NearToken::from_yoctonear(0));
    c.propose_offer(vec![terms()], EVIDENCE.to_string());
}

#[test]
#[should_panic(expected = "for storage")]
fn chain_vote_needs_a_deposit_for_storage() {
    let mut c = contract(2);
    set_caller_with_deposit("alice.testnet", NearToken::from_yoctonear(0));
    c.propose_chain(U64(46_630), DESK.to_string());
}

#[test]
#[should_panic(expected = "for storage")]
fn guardian_vote_needs_a_deposit_for_storage() {
    let mut c = contract(2);
    set_caller_with_deposit("alice.testnet", NearToken::from_yoctonear(0));
    c.propose_guardians(vec![account("alice.testnet")], 1);
}

// The excess deposit goes back to the proposer and does not stay in the contract.
#[test]
fn storage_deposit_refunds_the_excess() {
    let mut c = contract(2);
    set_caller_with_deposit("alice.testnet", NearToken::from_near(1));
    c.propose_offer(vec![terms()], EVIDENCE.to_string());
    let refunds: Vec<_> = get_created_receipts().into_iter().filter(|receipt| receipt.receiver_id == account("alice.testnet")).collect();
    assert_eq!(refunds.len(), 1);
}

#[test]
fn guardians_can_replace_a_member() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    let id = c.propose_guardians(vec![account("alice.testnet"), account("bob.testnet"), account("dave.testnet")], 2);
    c.approve_guardians(id);
    assert!(c.get_config().guardians.contains(&account("carol.testnet")), "changed below threshold");
    set_caller("bob.testnet");
    c.approve_guardians(id);
    let config = c.get_config();
    assert!(!config.guardians.contains(&account("carol.testnet")));
    assert!(config.guardians.contains(&account("dave.testnet")));
    assert_eq!(c.list_guardian_proposals(U64(0), 10)[0].status, GuardianProposalStatus::Applied);
}

#[test]
#[should_panic(expected = "caller is not a guardian")]
fn a_removed_guardian_cannot_act() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    let id = c.propose_guardians(vec![account("alice.testnet"), account("bob.testnet")], 2);
    c.approve_guardians(id);
    set_caller("bob.testnet");
    c.approve_guardians(id);
    set_caller("carol.testnet");
    c.propose_offer(vec![terms()], EVIDENCE.to_string());
}

#[test]
#[should_panic(expected = "caller is not a guardian")]
fn a_stranger_cannot_propose_guardians() {
    let mut c = contract(2);
    set_caller("mallory.testnet");
    c.propose_guardians(vec![account("mallory.testnet")], 1);
}

#[test]
#[should_panic(expected = "threshold must be between")]
fn a_guardian_vote_cannot_set_an_impossible_threshold() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    c.propose_guardians(vec![account("alice.testnet")], 2);
}

#[test]
#[should_panic(expected = "duplicate guardian")]
fn a_guardian_vote_cannot_repeat_a_member() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    c.propose_guardians(vec![account("alice.testnet"), account("alice.testnet")], 2);
}

#[test]
#[should_panic(expected = "too many guardians")]
fn a_guardian_vote_has_a_size_limit() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    let many = (0..17).map(|index| account(&format!("g{index}.testnet"))).collect();
    c.propose_guardians(many, 2);
}

#[test]
#[should_panic(expected = "guardian proposal is not pending")]
fn a_guardian_vote_applies_only_once() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    let id = c.propose_guardians(vec![account("alice.testnet"), account("bob.testnet"), account("carol.testnet")], 2);
    c.approve_guardians(id);
    set_caller("bob.testnet");
    c.approve_guardians(id);
    set_caller("carol.testnet");
    c.approve_guardians(id);
}

// Votes from members who left the council do not count toward a pending proposal.
#[test]
fn a_removed_guardians_vote_stops_counting() {
    let mut c = contract(2);
    let offer = propose(&mut c);
    set_caller("carol.testnet");
    c.approve_offer(offer);
    set_caller("alice.testnet");
    let id = c.propose_guardians(vec![account("alice.testnet"), account("bob.testnet")], 2);
    c.approve_guardians(id);
    set_caller("bob.testnet");
    c.approve_guardians(id);
    set_caller("alice.testnet");
    c.approve_offer(offer);
    assert_eq!(status(&c, offer), ProposalStatus::Pending, "carol's old vote must not count");
    assert_eq!(c.get_proposal(offer).unwrap().approvals, vec![account("alice.testnet")]);
    set_caller("bob.testnet");
    c.approve_offer(offer);
    assert_eq!(status(&c, offer), ProposalStatus::Approved);
}

#[test]
fn rotating_guardians_keeps_the_limit_and_the_signing_path() {
    let mut c = contract(2);
    let before = c.get_config();
    set_caller("alice.testnet");
    let id = c.propose_guardians(vec![account("bob.testnet"), account("dave.testnet")], 1);
    c.approve_guardians(id);
    set_caller("bob.testnet");
    c.approve_guardians(id);
    let after = c.get_config();
    assert_eq!(after.threshold, 1);
    assert_eq!(after.max_reward_bps, before.max_reward_bps);
    assert_eq!(after.derivation_path, before.derivation_path);
    assert_eq!(after.signer_contract, before.signer_contract);
    assert_eq!(after.deployments, before.deployments);
}

#[test]
fn cancelling_a_pending_offer_frees_its_ids() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("alice.testnet");
    c.vote_cancel(id);
    assert_eq!(status(&c, id), ProposalStatus::Pending, "cancelled below threshold");
    set_caller("bob.testnet");
    c.vote_cancel(id);
    let proposal = c.get_proposal(id).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Cancelled);
    assert_eq!(proposal.cases[0].status, CaseStatus::Cancelled);
    assert!(sign_receipts().is_empty(), "nothing was signed, so nothing needs revoking");
    // The same case id and nonce can be reused, because they were never signed.
    let again = propose(&mut c);
    assert_eq!(status(&c, again), ProposalStatus::Pending);
}

#[test]
#[should_panic(expected = "proposal is not pending")]
fn a_cancelled_offer_cannot_be_approved() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("alice.testnet");
    c.vote_cancel(id);
    set_caller("bob.testnet");
    c.vote_cancel(id);
    set_caller("carol.testnet");
    c.approve_offer(id);
}

#[test]
#[should_panic(expected = "caller is not a guardian")]
fn a_stranger_cannot_vote_to_cancel() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("mallory.testnet");
    c.vote_cancel(id);
}

#[test]
#[should_panic(expected = "already voted to cancel")]
fn a_cancel_vote_counts_once() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("alice.testnet");
    c.vote_cancel(id);
    c.vote_cancel(id);
}

#[test]
#[should_panic(expected = "proposal is already cancelled")]
fn an_offer_cancels_once() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("alice.testnet");
    c.vote_cancel(id);
    set_caller("bob.testnet");
    c.vote_cancel(id);
    set_caller("carol.testnet");
    c.vote_cancel(id);
}

#[test]
#[should_panic(expected = "a signature is in flight")]
fn cancel_waits_for_a_signature_in_flight() {
    let mut c = contract(2);
    let id = approved_and_signing(&mut c);
    set_caller("alice.testnet");
    c.vote_cancel(id);
    set_caller("bob.testnet");
    c.vote_cancel(id);
}

fn signed_offer(c: &mut PactumController) -> U64 {
    let id = approved_and_signing(c);
    deliver(c, id, PromiseResult::Successful(response_bytes()));
    assert_eq!(status(c, id), ProposalStatus::Signed);
    id
}

// A signed offer: cancelling creates one revocation signature for the right nonce, chain and contract.
#[test]
fn cancelling_a_signed_offer_requests_a_revocation() {
    let mut c = contract(2);
    let id = signed_offer(&mut c);
    set_caller("alice.testnet");
    c.vote_cancel(id);
    set_caller("bob.testnet");
    c.vote_cancel(id);
    let proposal = c.get_proposal(id).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Cancelled);
    assert_eq!(proposal.cases[0].status, CaseStatus::RevokeSigning);
    let desk: [u8; 20] = parse_hex_fixed(DESK).unwrap();
    let expected = to_hex(&crate::eip712::revoke_digest(1, SEPOLIA, &desk));
    assert_eq!(proposal.cases[0].revoke_digest.as_deref(), Some(expected.as_str()));
    assert_ne!(proposal.cases[0].digest, expected);
    assert_eq!(sign_receipts().len(), 1);

    deliver(&mut c, id, PromiseResult::Successful(response_bytes()));
    let revoked = c.get_proposal(id).unwrap();
    assert_eq!(revoked.status, ProposalStatus::Cancelled, "a revocation must not mark the offer as signed");
    assert_eq!(revoked.cases[0].status, CaseStatus::Revoked);
    assert!(revoked.cases[0].revocation.is_some());
    assert!(revoked.cases[0].signature.is_some(), "the original signature stays on record");
}

// A signed case id and nonce are not freed, because the old signature still exists out there.
#[test]
#[should_panic(expected = "case_id already proposed")]
fn a_revoked_case_keeps_its_ids() {
    let mut c = contract(2);
    let id = signed_offer(&mut c);
    set_caller("alice.testnet");
    c.vote_cancel(id);
    set_caller("bob.testnet");
    c.vote_cancel(id);
    propose(&mut c);
}

#[test]
fn a_failed_revocation_can_be_retried_by_anyone() {
    let mut c = contract(2);
    let id = signed_offer(&mut c);
    set_caller("alice.testnet");
    c.vote_cancel(id);
    set_caller("bob.testnet");
    c.vote_cancel(id);
    deliver(&mut c, id, PromiseResult::Failed);
    let failed = c.get_proposal(id).unwrap();
    assert_eq!(failed.cases[0].status, CaseStatus::RevokePending);
    assert!(failed.cases[0].revocation.is_none());
    set_caller("mallory.testnet");
    c.retry_signature(id);
    assert_eq!(c.get_proposal(id).unwrap().cases[0].status, CaseStatus::RevokeSigning);
    assert_eq!(sign_receipts().len(), 1);
}

#[test]
#[should_panic(expected = "proposal is not awaiting a signature")]
fn a_finished_cancellation_has_nothing_to_retry() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("alice.testnet");
    c.vote_cancel(id);
    set_caller("bob.testnet");
    c.vote_cancel(id);
    c.retry_signature(id);
}

// Cancel votes from members who left the council no longer count either.
#[test]
fn a_removed_guardians_cancel_vote_stops_counting() {
    let mut c = contract(2);
    let offer = propose(&mut c);
    set_caller("carol.testnet");
    c.vote_cancel(offer);
    set_caller("alice.testnet");
    let id = c.propose_guardians(vec![account("alice.testnet"), account("bob.testnet")], 2);
    c.approve_guardians(id);
    set_caller("bob.testnet");
    c.approve_guardians(id);
    set_caller("alice.testnet");
    c.vote_cancel(offer);
    assert_eq!(status(&c, offer), ProposalStatus::Pending);
}
