//! Unit tests from section 13: below threshold, duplicate approval, stranger approval, bad terms, hash checks.

use near_sdk::json_types::U64;
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{testing_env, AccountId, PromiseError};

use crate::types::{
    evm_signature, parse_hex_fixed, parse_uint256, to_hex, BigR, CaseTerms, ProposalStatus,
    RewardTier, Scalar, SignResponse,
};
use crate::ReturnDeskController;

const SEPOLIA: u64 = 11_155_111;
const DESK: &str = "0x1111111111111111111111111111111111111111";
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
        .block_timestamp(NOW_SECONDS * 1_000_000_000)
        .prepaid_gas(near_sdk::Gas::from_tgas(300));
    testing_env!(context.build());
}

fn contract(threshold: u32) -> ReturnDeskController {
    set_caller("deployer.testnet");
    ReturnDeskController::new(
        vec![account("alice.testnet"), account("bob.testnet"), account("carol.testnet")],
        threshold,
        DESK.to_string(),
        U64(SEPOLIA),
        "return-desk-1".to_string(),
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
        evidence_hash: format!("0x{}", "44".repeat(32)),
        tiers: vec![
            RewardTier { until: U64(NOW_SECONDS + 259_200), reward_bps: 1000 },
            RewardTier { until: U64(NOW_SECONDS + 604_800), reward_bps: 500 },
        ],
        nonce: U64(1),
        chain_id: U64(SEPOLIA),
    }
}

fn propose(c: &mut ReturnDeskController) -> U64 {
    set_caller("alice.testnet");
    c.propose_case(terms())
}

fn status(c: &ReturnDeskController, id: U64) -> ProposalStatus {
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

// Moves the proposal into signing with a threshold of 2.
fn approved_and_signing(c: &mut ReturnDeskController) -> U64 {
    let id = propose(c);
    set_caller("alice.testnet");
    let _ = c.approve_case(id);
    set_caller("bob.testnet");
    let _ = c.approve_case(id);
    id
}

#[test]
#[should_panic(expected = "threshold must be between")]
fn init_rejects_threshold_above_guardian_count() {
    set_caller("deployer.testnet");
    ReturnDeskController::new(
        vec![account("alice.testnet")],
        2,
        DESK.to_string(),
        U64(SEPOLIA),
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
    ReturnDeskController::new(
        vec![account("alice.testnet"), account("alice.testnet")],
        1,
        DESK.to_string(),
        U64(SEPOLIA),
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
    c.propose_case(terms());
}

#[test]
#[should_panic(expected = "caller is not a guardian")]
fn stranger_cannot_approve() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("mallory.testnet");
    let _ = c.approve_case(id);
}

#[test]
fn below_threshold_does_not_request_a_signature() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("alice.testnet");
    let _ = c.approve_case(id);
    assert_eq!(status(&c, id), ProposalStatus::Pending);
    assert!(get_created_receipts().is_empty());
}

#[test]
#[should_panic(expected = "already approved")]
fn same_guardian_cannot_approve_twice() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("alice.testnet");
    let _ = c.approve_case(id);
    set_caller("alice.testnet");
    let _ = c.approve_case(id);
}

#[test]
fn threshold_requests_a_signature_for_the_exact_digest() {
    let mut c = contract(2);
    let id = approved_and_signing(&mut c);
    let proposal = c.get_proposal(id).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Signing);
    assert_eq!(proposal.digest, c.case_digest(terms()));

    let receipts = get_created_receipts();
    let sign_receipt = receipts
        .iter()
        .find(|receipt| receipt.receiver_id == account("v1.signer-prod.testnet"))
        .expect("no receipt to the signer");
    let payload = proposal.digest.trim_start_matches("0x");
    let args = sign_args(sign_receipt);
    assert_eq!(args["request"]["payload_v2"]["Ecdsa"], Value::String(payload.to_string()));
    assert_eq!(args["request"]["path"], "return-desk-1");
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
    let _ = c.approve_case(id);
}

#[test]
fn stores_signature_for_anyone_to_read() {
    let mut c = contract(2);
    let id = approved_and_signing(&mut c);
    set_caller("controller.testnet");
    let signature = c.on_signed(id, Ok(signature_response()));
    let proposal = c.get_proposal(id).unwrap();
    assert_eq!(proposal.status, ProposalStatus::Signed);
    assert_eq!(proposal.signature, signature);
    let expected = "0x4e3cb210ca4197413b2066175a8a81a78e497e499f44116407e9371ce8a8dd997cf8899358fe262a83ce4b1e4a98d157450203adab4a212847e48ef0c20c34f71b";
    assert_eq!(proposal.signature.as_deref(), Some(expected));
}

#[test]
fn failed_signature_can_be_retried_by_anyone() {
    let mut c = contract(2);
    let id = approved_and_signing(&mut c);
    set_caller("controller.testnet");
    assert_eq!(c.on_signed(id, Err(PromiseError::Failed)), None);
    assert_eq!(status(&c, id), ProposalStatus::Approved);

    set_caller("mallory.testnet");
    let _ = c.retry_signature(id);
    assert_eq!(status(&c, id), ProposalStatus::Signing);
    assert_eq!(c.get_proposal(id).unwrap().digest, c.case_digest(terms()));
}

#[test]
#[should_panic(expected = "proposal is not awaiting a signature")]
fn cannot_retry_before_approval() {
    let mut c = contract(2);
    let id = propose(&mut c);
    set_caller("mallory.testnet");
    let _ = c.retry_signature(id);
}

#[test]
#[should_panic(expected = "proposal is not awaiting a signature")]
fn cannot_sign_again_once_signed() {
    let mut c = contract(2);
    let id = approved_and_signing(&mut c);
    set_caller("controller.testnet");
    c.on_signed(id, Ok(signature_response()));
    set_caller("mallory.testnet");
    let _ = c.retry_signature(id);
}

// `#[private]` on on_signed only applies in wasm, so it is checked on testnet in scripts/demo.ts.

#[test]
#[should_panic(expected = "proposal not found")]
fn cannot_approve_unknown_proposal() {
    let mut c = contract(2);
    set_caller("alice.testnet");
    let _ = c.approve_case(U64(9));
}

#[test]
#[should_panic(expected = "case_id already proposed")]
fn rejects_duplicate_case_id() {
    let mut c = contract(2);
    propose(&mut c);
    let mut again = terms();
    again.nonce = U64(2);
    c.propose_case(again);
}

#[test]
#[should_panic(expected = "nonce already used")]
fn rejects_duplicate_nonce() {
    let mut c = contract(2);
    propose(&mut c);
    let mut again = terms();
    again.case_id = format!("0x{}", "02".repeat(32));
    c.propose_case(again);
}

// Checks that bad terms are rejected with exactly the expected message.
fn assert_rejected(change: impl Fn(&mut CaseTerms), expected: &str) {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut c = contract(2);
        let mut bad = terms();
        change(&mut bad);
        set_caller("alice.testnet");
        c.propose_case(bad);
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
    assert_rejected(|t| t.chain_id = U64(1), "wrong chain_id");
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
        let c = ReturnDeskController::new(
            vec![account("alice.testnet")],
            1,
            vector["verifyingContract"].as_str().unwrap().to_string(),
            terms.chain_id,
            "p".to_string(),
            account("v1.signer-prod.testnet"),
            10_000,
        );
        assert_eq!(c.case_digest(terms), vector["digest"].as_str().unwrap());
    }
}
