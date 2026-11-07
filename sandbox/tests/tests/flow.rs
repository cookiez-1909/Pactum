//! Runs the real PactumController wasm in a local NEAR sandbox against a MOCK MPC contract.
//! The point is to test failure paths that cannot be forced on the real MPC network:
//! MPC failures, malformed responses, too little gas, and `#[private]` in wasm.
//! These tests do NOT prove real signatures. Real signatures are checked by `make verify`.

use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

const CONTROLLER_WASM: &str = "../../controller/target/near/pactum_controller.wasm";
const MOCK_WASM: &str = "../mock-signer/target/near/mock_signer.wasm";
const DESK: &str = "0x1111111111111111111111111111111111111111";
const SEPOLIA: &str = "11155111";
const BASE_SEPOLIA: &str = "84532";
const BASE_DESK: &str = "0x5555555555555555555555555555555555555555";
// Hashes computed with `cast keccak`, which is the EVM's keccak256.
const EVIDENCE: &str = "Test offer: keep 10 percent";
const EVIDENCE_HASH: &str = "0x4a73c11c58a2d50f2ace0ba9406cfde1c2331fc5f50e7fbe1c41fa6e354a7420";
const LONG_EVIDENCE_HASH: &str = "0x010aa279086ab917c15c5de3245f6bdc749a04cdbfe917eb71f10874ec7f1b87";

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
            "deployments": [
                { "chain_id": SEPOLIA, "pactum": DESK },
                { "chain_id": BASE_SEPOLIA, "pactum": BASE_DESK },
            ],
            "derivation_path": "pactum-1",
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
        "evidence_hash": EVIDENCE_HASH,
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
            .call(self.controller.id(), "propose_offer")
            .args_json(json!({ "cases": [terms(seed)], "evidence": EVIDENCE }))
            .deposit(NearToken::from_near(1))
            .max_gas()
            .transact()
            .await
            .unwrap()
            .into_result()
            .unwrap();
        outcome.json::<String>().unwrap()
    }

    async fn approve(&self, who: &Account, id: &str) -> near_workspaces::result::ExecutionFinalResult {
        who.call(self.controller.id(), "approve_offer")
            .args_json(json!({ "proposal_id": id }))
            .gas(Gas::from_tgas(300))
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
            .gas(Gas::from_tgas(300))
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
    let digest = proposal["cases"][0]["digest"].as_str().unwrap().trim_start_matches("0x");
    assert_eq!(request["payload_v2"]["Ecdsa"], digest);
    assert_eq!(request["path"], "pactum-1");
    assert_eq!(request["domain_id"], 0);

    let signature = proposal["cases"][0]["signature"].as_str().unwrap();
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
    assert_eq!(proposal["cases"][0]["status"], "Unsigned");
    assert!(proposal["cases"][0]["signature"].is_null());

    s.set_mode("Ok").await;
    let retried = s.retry(&s.stranger, &id).await;
    assert!(retried.is_success(), "{:?}", retried.failures());
    let signed = s.proposal(&id).await;
    assert_eq!(signed["status"], "Signed");
    assert_eq!(signed["cases"][0]["digest"], proposal["cases"][0]["digest"], "retry must sign the same digest");
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
        .call(s.controller.id(), "approve_offer")
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
        .call(s.controller.id(), "propose_offer")
        .args_json(json!({ "cases": [terms(2)], "evidence": EVIDENCE }))
        .deposit(NearToken::from_near(1))
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
            "deployments": [{ "chain_id": SEPOLIA, "pactum": DESK }],
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

fn on_chain(seed: u8, chain_id: &str) -> Value {
    let mut item = terms(seed);
    item["chain_id"] = json!(chain_id);
    item
}

impl Setup {
    async fn propose_cases(&self, cases: Vec<Value>) -> String {
        self.alice
            .call(self.controller.id(), "propose_offer")
            .args_json(json!({ "cases": cases, "evidence": EVIDENCE }))
            .deposit(NearToken::from_near(1))
            .max_gas()
            .transact()
            .await
            .unwrap()
            .into_result()
            .unwrap()
            .json()
            .unwrap()
    }
}

// Real wasm with real gas: one approval signs for all three chains in a single 300 Tgas transaction.
#[tokio::test]
async fn one_approval_round_signs_three_chains() {
    let s = setup().await;
    let chain = add_third_chain(&s).await;
    let id = s
        .propose_cases(vec![on_chain(1, SEPOLIA), on_chain(1, BASE_SEPOLIA), on_chain(1, &chain)])
        .await;

    assert!(s.approve(&s.alice, &id).await.is_success());
    assert_eq!(s.signer_calls().await, 0, "signed below threshold");
    let result = s.approve(&s.bob, &id).await;
    assert!(result.failures().is_empty(), "{:?}", result.failures());
    assert_eq!(s.signer_calls().await, 3);

    let proposal = s.proposal(&id).await;
    assert_eq!(proposal["status"], "Signed");
    assert_eq!(proposal["approvals"].as_array().unwrap().len(), 2);
    assert_eq!(proposal["evidence"], EVIDENCE);
    let cases = proposal["cases"].as_array().unwrap();
    assert_eq!(cases.len(), 3);
    assert!(cases.iter().all(|item| item["status"] == "Signed" && item["signature"].is_string()));
    assert_ne!(cases[0]["digest"], cases[1]["digest"]);
    assert_ne!(cases[1]["digest"], cases[2]["digest"]);
}

// One failed signature does not lose the others, and signing again only signs what is missing.
#[tokio::test]
async fn signer_failure_keeps_a_multi_chain_offer_recoverable() {
    let s = setup().await;
    s.set_mode("Panic").await;
    let id = s.propose_cases(vec![on_chain(1, SEPOLIA), on_chain(1, BASE_SEPOLIA)]).await;
    let _ = s.approve(&s.alice, &id).await;
    let _ = s.approve(&s.bob, &id).await;
    let failed = s.proposal(&id).await;
    assert_eq!(failed["status"], "Approved");
    assert!(failed["cases"].as_array().unwrap().iter().all(|item| item["status"] == "Unsigned"));

    s.set_mode("Ok").await;
    let retried = s.retry(&s.stranger, &id).await;
    assert!(retried.failures().is_empty(), "{:?}", retried.failures());
    assert_eq!(s.proposal(&id).await["status"], "Signed");
}

// An offer larger than one transaction's limit can still be fully signed by calling again.
#[tokio::test]
async fn large_offer_finishes_in_a_second_call() {
    let s = setup().await;
    let cases = (1..=5).map(|seed| terms(seed)).collect();
    let id = s.propose_cases(cases).await;
    let _ = s.approve(&s.alice, &id).await;
    let _ = s.approve(&s.bob, &id).await;
    assert_eq!(s.signer_calls().await, 3);
    assert_eq!(s.proposal(&id).await["status"], "Approved");

    let retried = s.retry(&s.stranger, &id).await;
    assert!(retried.failures().is_empty(), "{:?}", retried.failures());
    assert_eq!(s.signer_calls().await, 5);
    assert_eq!(s.proposal(&id).await["status"], "Signed");
}

// Adds a chain through a vote and returns its chain id.
async fn add_third_chain(s: &Setup) -> String {
    let chain = "46630".to_string();
    let id: String = s
        .alice
        .call(s.controller.id(), "propose_chain")
        .args_json(json!({ "chain_id": chain, "pactum": "0x6666666666666666666666666666666666666666" }))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap()
        .json()
        .unwrap();
    for who in [&s.alice, &s.bob] {
        who.call(s.controller.id(), "approve_chain")
            .args_json(json!({ "proposal_id": id }))
            .max_gas()
            .transact()
            .await
            .unwrap()
            .into_result()
            .unwrap();
    }
    chain
}

#[tokio::test]
async fn guardians_vote_in_a_chain_but_strangers_and_replacements_fail() {
    let s = setup().await;
    let stranger = s
        .stranger
        .call(s.controller.id(), "propose_chain")
        .args_json(json!({ "chain_id": "46630", "pactum": BASE_DESK }))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await
        .unwrap();
    assert!(failure_text(&stranger).contains("caller is not a guardian"), "{}", failure_text(&stranger));

    let replace = s
        .alice
        .call(s.controller.id(), "propose_chain")
        .args_json(json!({ "chain_id": SEPOLIA, "pactum": BASE_DESK }))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await
        .unwrap();
    assert!(failure_text(&replace).contains("chain_id is already served"), "{}", failure_text(&replace));

    add_third_chain(&s).await;
    let config: Value = s.controller.view("get_config").await.unwrap().json().unwrap();
    let chains = config["deployments"].as_array().unwrap();
    assert_eq!(chains.len(), 3);
    assert_eq!(chains[0]["pactum"], DESK);
    assert_eq!(chains[2]["chain_id"], "46630");
    let votes: Vec<Value> = s
        .controller
        .view("list_chain_proposals")
        .args_json(json!({ "from": "0", "limit": 10 }))
        .await
        .unwrap()
        .json()
        .unwrap();
    assert_eq!(votes[0]["status"], "Added");
}

#[tokio::test]
async fn wasm_rejects_text_that_does_not_match_the_hash() {
    let s = setup().await;
    let result = s
        .alice
        .call(s.controller.id(), "propose_offer")
        .args_json(json!({ "cases": [terms(1)], "evidence": "A different offer" }))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await
        .unwrap();
    assert!(failure_text(&result).contains("evidence does not match evidence_hash"), "{}", failure_text(&result));
    let count: String = s.controller.view("proposal_count").await.unwrap().json().unwrap();
    assert_eq!(count, "0");
}

async fn vote(who: &Account, s: &Setup, method: &str, id: &str) -> near_workspaces::result::ExecutionFinalResult {
    who.call(s.controller.id(), method).args_json(json!({ "proposal_id": id })).gas(Gas::from_tgas(300)).transact().await.unwrap()
}

// The largest offer the contract allows, with the longest text: 12 cases and 4096 bytes.
// The callback only has CALLBACK_GAS, so it must read and write even a large proposal without running out.
#[tokio::test]
async fn largest_offer_signs_and_cancels_with_longest_text() {
    let s = setup().await;
    let evidence = "x".repeat(4096);
    // keccak256 of 4096 "x" characters, computed with `cast keccak`.
    let evidence_hash = LONG_EVIDENCE_HASH;
    let cases: Vec<Value> = (1..=12)
        .map(|seed| {
            let mut item = terms(seed);
            item["evidence_hash"] = json!(evidence_hash);
            item
        })
        .collect();
    let id: String = s
        .alice
        .call(s.controller.id(), "propose_offer")
        .args_json(json!({ "cases": cases, "evidence": evidence }))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap()
        .json()
        .unwrap();
    let _ = s.approve(&s.alice, &id).await;
    let last = s.approve(&s.bob, &id).await;
    assert!(last.failures().is_empty(), "{:?}", last.failures());
    assert_eq!(s.signer_calls().await, 3);
    for _ in 0..3 {
        let retried = s.retry(&s.stranger, &id).await;
        assert!(retried.failures().is_empty(), "{:?}", retried.failures());
    }
    assert_eq!(s.signer_calls().await, 12);
    let signed = s.proposal(&id).await;
    assert_eq!(signed["status"], "Signed");
    assert!(signed["cases"].as_array().unwrap().iter().all(|item| item["signature"].is_string()));

    // Cancels that whole offer: each case needs a revocation signature, also at most 3 per transaction.
    assert!(vote(&s.alice, &s, "vote_cancel", &id).await.is_success());
    let last = vote(&s.bob, &s, "vote_cancel", &id).await;
    assert!(last.failures().is_empty(), "{:?}", last.failures());
    assert_eq!(s.signer_calls().await, 15);
    for _ in 0..3 {
        let retried = s.retry(&s.stranger, &id).await;
        assert!(retried.failures().is_empty(), "{:?}", retried.failures());
    }
    assert_eq!(s.signer_calls().await, 24);
    let cancelled = s.proposal(&id).await;
    assert_eq!(cancelled["status"], "Cancelled");
    assert!(cancelled["cases"].as_array().unwrap().iter().all(|item| item["status"] == "Revoked" && item["revocation"].is_string()));
}

// MPC fails during revocation: it can still be retried, and the original signatures are kept.
#[tokio::test]
async fn signer_failure_keeps_a_cancellation_recoverable() {
    let s = setup().await;
    let id = s.propose(1).await;
    let _ = s.approve(&s.alice, &id).await;
    let _ = s.approve(&s.bob, &id).await;
    assert_eq!(s.proposal(&id).await["status"], "Signed");

    s.set_mode("Panic").await;
    assert!(vote(&s.alice, &s, "vote_cancel", &id).await.is_success());
    let _ = vote(&s.bob, &s, "vote_cancel", &id).await;
    let failed = s.proposal(&id).await;
    assert_eq!(failed["status"], "Cancelled");
    assert_eq!(failed["cases"][0]["status"], "RevokePending");
    assert!(failed["cases"][0]["signature"].is_string());

    s.set_mode("Ok").await;
    let retried = s.retry(&s.stranger, &id).await;
    assert!(retried.failures().is_empty(), "{:?}", retried.failures());
    let done = s.proposal(&id).await;
    assert_eq!(done["cases"][0]["status"], "Revoked");
    assert!(done["cases"][0]["revocation"].is_string());
}

// Too little gas on the deciding cancel vote rolls the vote back, so it never gets stuck cancelled without revocations.
#[tokio::test]
async fn too_little_gas_rolls_back_the_cancel_vote() {
    let s = setup().await;
    let id = s.propose(1).await;
    let _ = s.approve(&s.alice, &id).await;
    let _ = s.approve(&s.bob, &id).await;
    assert!(vote(&s.alice, &s, "vote_cancel", &id).await.is_success());
    let short = s.bob.call(s.controller.id(), "vote_cancel").args_json(json!({ "proposal_id": id })).gas(Gas::from_tgas(30)).transact().await.unwrap();
    assert!(!short.is_success());
    let proposal = s.proposal(&id).await;
    assert_eq!(proposal["status"], "Signed");
    assert_eq!(proposal["cancel_votes"].as_array().unwrap().len(), 1);
}

// The storage deposit pays exactly what is needed, the excess goes back to the proposer, and the contract balance does not drop.
#[tokio::test]
async fn proposer_pays_for_storage_and_gets_the_excess_back() {
    let s = setup().await;
    let before = s.controller.view_account().await.unwrap();
    let alice_before = s.alice.view_account().await.unwrap().balance;
    let id = s.propose(1).await;
    let after = s.controller.view_account().await.unwrap();
    let alice_after = s.alice.view_account().await.unwrap().balance;
    let paid = alice_before.as_yoctonear() - alice_after.as_yoctonear();
    assert!(paid < NearToken::from_millinear(200).as_yoctonear(), "kept too much of the deposit: {paid}");
    let spent_on_storage = u128::from(after.storage_usage - before.storage_usage) * 10u128.pow(19);
    assert!(after.balance.as_yoctonear() >= before.balance.as_yoctonear() + spent_on_storage, "the contract paid for its own storage");

    let without = s.alice.call(s.controller.id(), "propose_offer").args_json(json!({ "cases": [terms(9)], "evidence": EVIDENCE })).max_gas().transact().await.unwrap();
    assert!(failure_text(&without).contains("for storage"), "{}", failure_text(&without));
    assert_eq!(s.proposal(&id).await["status"], "Pending");
}

// On the real wasm: a guardian is replaced by vote, the old one loses access and the new one gains it.
#[tokio::test]
async fn guardians_vote_a_member_out_and_a_new_one_in() {
    let s = setup().await;
    let id: String = s
        .alice
        .call(s.controller.id(), "propose_guardians")
        .args_json(json!({ "guardians": [s.alice.id(), s.stranger.id()], "threshold": 2 }))
        .deposit(NearToken::from_near(1))
        .max_gas()
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap()
        .json()
        .unwrap();
    assert!(vote(&s.alice, &s, "approve_guardians", &id).await.is_success());
    assert!(vote(&s.bob, &s, "approve_guardians", &id).await.is_success());
    let config: Value = s.controller.view("get_config").await.unwrap().json().unwrap();
    assert_eq!(config["guardians"], json!([s.alice.id(), s.stranger.id()]));

    let offer = s.propose(1).await;
    let refused = s.approve(&s.bob, &offer).await;
    assert!(failure_text(&refused).contains("caller is not a guardian"), "{}", failure_text(&refused));
    let _ = s.approve(&s.alice, &offer).await;
    assert!(s.approve(&s.stranger, &offer).await.is_success());
    assert_eq!(s.proposal(&offer).await["status"], "Signed");
}
