//! Runs the real ReturnDeskController wasm in a local NEAR sandbox, with a FAKE MPC contract.
//! The point is to test failure paths that cannot be forced on the real MPC network:
//! MPC failures, malformed responses, too little gas, and `#[private]` in wasm.
//! These tests do NOT prove real signatures. Real signatures are checked by `make verify`.

use near_workspaces::network::Sandbox;
use near_workspaces::types::Gas;
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

const CONTROLLER_WASM: &str = "../../controller/target/near/return_desk_controller.wasm";
const MOCK_WASM: &str = "../mock-signer/target/near/mock_signer.wasm";
const DESK: &str = "0x1111111111111111111111111111111111111111";
const SEPOLIA: &str = "11155111";

struct Setup {
    worker: Worker<Sandbox>,
    controller: Contract,
    signer: Contract,
    alice: Account,
    bob: Account,
    stranger: Account,
}

async fn setup() -> Setup {
    let worker = near_workspaces::sandbox().await.expect("sandbox");
    // Allows another wasm file, to run the same tests against an older build.
    let controller_path = std::env::var("CONTROLLER_WASM").unwrap_or_else(|_| CONTROLLER_WASM.to_string());
    let controller_wasm = std::fs::read(controller_path).expect("run: make build-near");
    let mock_wasm = std::fs::read(MOCK_WASM).expect("run: make test-sandbox");
    let controller = worker.dev_deploy(&controller_wasm).await.unwrap();
    let signer = worker.dev_deploy(&mock_wasm).await.unwrap();
    signer.call("new").transact().await.unwrap().into_result().unwrap();
    let alice = worker.dev_create_account().await.unwrap();
    let bob = worker.dev_create_account().await.unwrap();
    let stranger = worker.dev_create_account().await.unwrap();
    controller
        .call("new")
        .args_json(json!({
            "guardians": [alice.id(), bob.id()],
            "threshold": 2,
            "return_desk": DESK,
            "chain_id": SEPOLIA,
            "derivation_path": "return-desk-1",
            "signer_contract": signer.id(),
            "max_reward_bps": 2000,
        }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
    Setup { worker, controller, signer, alice, bob, stranger }
}

fn terms(seed: u8) -> Value {
    json!({
        "case_id": format!("0x{:064x}", u64::from(seed) + 1),
        "token": format!("0x{}", "22".repeat(20)),
        "total_loss": "1000000000000000000000000",
        "max_return": "1000000000000000000000000",
        "reward_cap": "150000000000000000000000",
        "refund_root": format!("0x{}", "33".repeat(32)),
        "evidence_hash": format!("0x{}", "44".repeat(32)),
        "tiers": [
            { "until": "4000000000", "reward_bps": 1000 },
            { "until": "4100000000", "reward_bps": 500 },
        ],
        "nonce": seed.to_string(),
        "chain_id": SEPOLIA,
    })
}

impl Setup {
    async fn propose(&self, seed: u8) -> String {
        let outcome = self
            .alice
            .call(self.controller.id(), "propose_case")
            .args_json(json!({ "terms": terms(seed) }))
            .max_gas()
            .transact()
            .await
            .unwrap()
            .into_result()
            .unwrap();
        outcome.json::<String>().unwrap()
    }

    async fn approve(&self, who: &Account, id: &str) -> near_workspaces::result::ExecutionFinalResult {
        who.call(self.controller.id(), "approve_case")
            .args_json(json!({ "proposal_id": id }))
            .gas(Gas::from_tgas(150))
            .transact()
            .await
            .unwrap()
    }

    async fn proposal(&self, id: &str) -> Value {
        self.controller
            .view("get_proposal")
            .args_json(json!({ "proposal_id": id }))
            .await
            .unwrap()
            .json()
            .unwrap()
    }

    async fn set_mode(&self, mode: &str) {
        self.signer
            .call("set_mode")
            .args_json(json!({ "mode": mode }))
            .transact()
            .await
            .unwrap()
            .into_result()
            .unwrap();
    }

    async fn signer_calls(&self) -> u32 {
        self.signer.view("calls").await.unwrap().json().unwrap()
    }

    async fn retry(&self, who: &Account, id: &str) -> near_workspaces::result::ExecutionFinalResult {
        who.call(self.controller.id(), "retry_signature")
            .args_json(json!({ "proposal_id": id }))
            .gas(Gas::from_tgas(150))
            .transact()
            .await
            .unwrap()
    }
}

// Collects every error message of a transaction, including from child receipts.
fn failure_text(result: &near_workspaces::result::ExecutionFinalResult) -> String {
    format!("{:?}", result.failures())
}

#[tokio::test]
async fn threshold_requests_exact_digest_with_real_cross_contract_call() {
    let s = setup().await;
    let id = s.propose(1).await;

    assert!(s.approve(&s.alice, &id).await.is_success());
    assert_eq!(s.proposal(&id).await["status"], "Pending");
    assert_eq!(s.signer_calls().await, 0, "signed below threshold");

    assert!(s.approve(&s.bob, &id).await.is_success());
    let proposal = s.proposal(&id).await;
    assert_eq!(proposal["status"], "Signed");
    assert_eq!(s.signer_calls().await, 1);

    let last: Value = s.signer.view("last").await.unwrap().json().unwrap();
    assert_eq!(last["caller"], s.controller.id().to_string());
    assert_eq!(last["deposit_yocto"], "1");
    let request: Value = serde_json::from_str(last["request"].as_str().unwrap()).unwrap();
    let digest = proposal["digest"].as_str().unwrap().trim_start_matches("0x");
    assert_eq!(request["payload_v2"]["Ecdsa"], digest);
    assert_eq!(request["path"], "return-desk-1");
    assert_eq!(request["domain_id"], 0);

    let signature = proposal["signature"].as_str().unwrap();
    assert_eq!(signature.len(), 2 + 65 * 2);
    assert!(signature.ends_with("1b"));
}

#[tokio::test]
async fn signer_failure_returns_to_approved_and_anyone_can_retry() {
    let s = setup().await;
    s.set_mode("Panic").await;
    let id = s.propose(1).await;
    let _ = s.approve(&s.alice, &id).await;
    let _ = s.approve(&s.bob, &id).await;
    let proposal = s.proposal(&id).await;
    assert_eq!(proposal["status"], "Approved");
    assert!(proposal["signature"].is_null());

    s.set_mode("Ok").await;
    let retried = s.retry(&s.stranger, &id).await;
    assert!(retried.is_success(), "{:?}", retried.failures());
    let signed = s.proposal(&id).await;
    assert_eq!(signed["status"], "Signed");
    assert_eq!(signed["digest"], proposal["digest"], "retry must sign the same digest");
}

#[tokio::test]
async fn malformed_signer_response_does_not_get_stuck() {
    let s = setup().await;
    s.set_mode("Malformed").await;
    let id = s.propose(1).await;
    let _ = s.approve(&s.alice, &id).await;
    assert!(s.approve(&s.bob, &id).await.is_success());
    assert_eq!(s.proposal(&id).await["status"], "Approved");

    s.set_mode("Ok").await;
    assert!(s.retry(&s.stranger, &id).await.is_success());
    assert_eq!(s.proposal(&id).await["status"], "Signed");
}

#[tokio::test]
async fn too_little_gas_rolls_back_the_approval() {
    let s = setup().await;
    let id = s.propose(1).await;
    assert!(s.approve(&s.alice, &id).await.is_success());

    let result = s
        .bob
        .call(s.controller.id(), "approve_case")
        .args_json(json!({ "proposal_id": id }))
        .gas(Gas::from_tgas(30))
        .transact()
        .await
        .unwrap();
    assert!(result.is_failure());
    let proposal = s.proposal(&id).await;
    assert_eq!(proposal["status"], "Pending");
    assert_eq!(proposal["approvals"].as_array().unwrap().len(), 1, "failed call must not count");

    assert!(s.approve(&s.bob, &id).await.is_success());
    assert_eq!(s.proposal(&id).await["status"], "Signed");
}

#[tokio::test]
async fn wasm_rejects_unauthorized_calls_for_the_right_reason() {
    let s = setup().await;
    let id = s.propose(1).await;

    let forged = s
        .stranger
        .call(s.controller.id(), "on_signed")
        .args_json(json!({ "proposal_id": id }))
        .gas(Gas::from_tgas(50))
        .transact()
        .await
        .unwrap();
    assert!(failure_text(&forged).contains("Method on_signed is private"), "{}", failure_text(&forged));

    let propose = s
        .stranger
        .call(s.controller.id(), "propose_case")
        .args_json(json!({ "terms": terms(2) }))
        .max_gas()
        .transact()
        .await
        .unwrap();
    assert!(failure_text(&propose).contains("caller is not a guardian"), "{}", failure_text(&propose));

    let approve = s.approve(&s.stranger, &id).await;
    assert!(failure_text(&approve).contains("caller is not a guardian"), "{}", failure_text(&approve));

    let reinit = s
        .stranger
        .call(s.controller.id(), "new")
        .args_json(json!({
            "guardians": [s.stranger.id()],
            "threshold": 1,
            "return_desk": DESK,
            "chain_id": SEPOLIA,
            "derivation_path": "evil",
            "signer_contract": s.signer.id(),
            "max_reward_bps": 10000,
        }))
        .max_gas()
        .transact()
        .await
        .unwrap();
    assert!(reinit.is_failure(), "second init must fail");
    let config: Value = s.controller.view("get_config").await.unwrap().json().unwrap();
    assert_eq!(config["threshold"], 2);
}

#[tokio::test]
async fn cannot_sign_twice_or_approve_after_signing() {
    let s = setup().await;
    let id = s.propose(1).await;
    let _ = s.approve(&s.alice, &id).await;
    let _ = s.approve(&s.bob, &id).await;
    assert_eq!(s.signer_calls().await, 1);

    let retry = s.retry(&s.stranger, &id).await;
    assert!(failure_text(&retry).contains("not awaiting a signature"), "{}", failure_text(&retry));
    let again = s.approve(&s.alice, &id).await;
    assert!(failure_text(&again).contains("not pending"), "{}", failure_text(&again));
    assert_eq!(s.signer_calls().await, 1, "no second signature request");
}

// With every key removed, the contract must still work and nobody can sign in its place.
#[tokio::test]
async fn keeps_working_with_no_access_keys() {
    let s = setup().await;
    let keys = s.worker.view_access_keys(s.controller.id()).await.unwrap();
    assert_eq!(keys.len(), 1);
    let controller_account = s.controller.as_account();
    controller_account
        .batch(controller_account.id())
        .delete_key(controller_account.secret_key().public_key())
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
    assert_eq!(s.worker.view_access_keys(s.controller.id()).await.unwrap().len(), 0);

    let id = s.propose(1).await;
    let _ = s.approve(&s.alice, &id).await;
    assert!(s.approve(&s.bob, &id).await.is_success());
    assert_eq!(s.proposal(&id).await["status"], "Signed");
}
