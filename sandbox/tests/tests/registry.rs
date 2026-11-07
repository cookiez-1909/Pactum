//! Runs the real PactumRegistry wasm with the real PactumController wasm in a local NEAR sandbox.
//! The point is to test the real call between the two contracts, the refunds, and that slashed funds really stay in the contract.

use near_workspaces::network::Sandbox;
use near_workspaces::types::{Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::{json, Value};

const CONTROLLER_WASM: &str = "../../controller/target/near/pactum_controller.wasm";
const REGISTRY_WASM: &str = "../../registry/target/near/pactum_registry.wasm";
const DESK: &str = "0x1111111111111111111111111111111111111111";
const ONE_NEAR: u128 = 10u128.pow(24);

struct Setup {
    _worker: Worker<Sandbox>,
    registry: Contract,
    controller: Contract,
    guardian: Account,
    stranger: Account,
    council: Vec<Account>,
}

async fn setup(unstake_delay: u64) -> Setup {
    let worker = near_workspaces::sandbox().await.expect("sandbox");
    let controller = worker.dev_deploy(&std::fs::read(CONTROLLER_WASM).expect("run: make build-near")).await.unwrap();
    let registry = worker.dev_deploy(&std::fs::read(REGISTRY_WASM).expect("run: make build-near")).await.unwrap();
    let guardian = worker.dev_create_account().await.unwrap();
    let stranger = worker.dev_create_account().await.unwrap();
    let mut council = Vec::new();
    for _ in 0..3 {
        council.push(worker.dev_create_account().await.unwrap());
    }
    controller
        .call("new")
        .args_json(json!({
            "guardians": [guardian.id()],
            "threshold": 1,
            "deployments": [{ "chain_id": "11155111", "pactum": DESK }],
            "derivation_path": "pactum-1",
            "signer_contract": "signer.test.near",
            "max_reward_bps": 2000,
        }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
    let ids: Vec<String> = council.iter().map(|member| member.id().to_string()).collect();
    registry
        .call("new")
        .args_json(json!({
            "council": ids,
            "council_threshold": 2,
            "min_stake": ONE_NEAR.to_string(),
            "unstake_delay_seconds": unstake_delay.to_string(),
            "min_hold_seconds": "0",
            "challenge_deposit": (ONE_NEAR / 10).to_string(),
            "challenge_ttl_seconds": "2592000",
        }))
        .transact()
        .await
        .unwrap()
        .into_result()
        .unwrap();
    Setup { _worker: worker, registry, controller, guardian, stranger, council }
}

impl Setup {
    async fn register(&self, who: &Account, near: u128) -> near_workspaces::result::ExecutionFinalResult {
        who.call(self.registry.id(), "register")
            .args_json(json!({ "controller": self.controller.id(), "website": "https://example.org" }))
            .deposit(NearToken::from_near(near))
            .gas(Gas::from_tgas(150))
            .transact()
            .await
            .unwrap()
    }

    async fn operator(&self) -> Value {
        self.registry.view("get_operator").args_json(json!({ "controller": self.controller.id() })).await.unwrap().json().unwrap()
    }

    async fn listed(&self) -> bool {
        self.registry.view("is_listed").args_json(json!({ "controller": self.controller.id() })).await.unwrap().json().unwrap()
    }

    async fn challenge(&self) -> String {
        self.stranger
            .call(self.registry.id(), "open_challenge")
            .args_json(json!({ "controller": self.controller.id(), "evidence": "The list pays the team" }))
            .deposit(NearToken::from_millinear(100))
            .max_gas()
            .transact()
            .await
            .unwrap()
            .into_result()
            .unwrap()
            .json()
            .unwrap()
    }

    async fn vote(&self, who: usize, id: &str, verdict: Value) -> near_workspaces::result::ExecutionFinalResult {
        self.council[who]
            .call(self.registry.id(), "vote_challenge")
            .args_json(json!({ "challenge_id": id, "verdict": verdict }))
            .gas(Gas::from_tgas(100))
            .transact()
            .await
            .unwrap()
    }
}

#[tokio::test]
async fn a_real_guardian_gets_listed_through_a_real_cross_contract_call() {
    let s = setup(0).await;
    let result = s.register(&s.guardian, 2).await;
    assert!(result.failures().is_empty(), "{:?}", result.failures());
    assert!(s.listed().await);
    let operator = s.operator().await;
    assert_eq!(operator["owner"], s.guardian.id().to_string());
    assert_eq!(operator["stake"], (2 * ONE_NEAR - ONE_NEAR / 100).to_string());
}

#[tokio::test]
async fn a_stranger_is_refunded_by_a_real_transfer() {
    let s = setup(0).await;
    let before = s.stranger.view_account().await.unwrap().balance.as_yoctonear();
    let result = s.register(&s.stranger, 5).await;
    assert!(result.is_success(), "{:?}", result.failures());
    assert_eq!(result.json::<bool>().unwrap(), false);
    assert!(!s.listed().await);
    let after = s.stranger.view_account().await.unwrap().balance.as_yoctonear();
    assert!(before - after < ONE_NEAR / 10, "only gas should be spent, lost {}", before - after);
}

#[tokio::test]
async fn an_account_with_no_contract_is_refunded() {
    let s = setup(0).await;
    let before = s.guardian.view_account().await.unwrap().balance.as_yoctonear();
    let result = s
        .guardian
        .call(s.registry.id(), "register")
        .args_json(json!({ "controller": s.stranger.id(), "website": "" }))
        .deposit(NearToken::from_near(5))
        .gas(Gas::from_tgas(150))
        .transact()
        .await
        .unwrap();
    assert_eq!(result.json::<bool>().unwrap(), false);
    let after = s.guardian.view_account().await.unwrap().balance.as_yoctonear();
    assert!(before - after < ONE_NEAR / 10, "only gas should be spent, lost {}", before - after);
}

#[tokio::test]
async fn too_little_gas_keeps_the_money_with_the_caller() {
    let s = setup(0).await;
    let before = s.guardian.view_account().await.unwrap().balance.as_yoctonear();
    let result = s
        .guardian
        .call(s.registry.id(), "register")
        .args_json(json!({ "controller": s.controller.id(), "website": "" }))
        .deposit(NearToken::from_near(5))
        .gas(Gas::from_tgas(10))
        .transact()
        .await
        .unwrap();
    assert!(!result.is_success());
    let after = s.guardian.view_account().await.unwrap().balance.as_yoctonear();
    assert!(before - after < ONE_NEAR / 10, "the deposit must come back, lost {}", before - after);
    assert!(!s.listed().await);
}

#[tokio::test]
async fn the_callback_is_private() {
    let s = setup(0).await;
    let result = s
        .stranger
        .call(s.registry.id(), "on_config")
        .args_json(json!({ "controller": s.controller.id(), "caller": s.stranger.id(), "attached": (5 * ONE_NEAR).to_string(), "website": "" }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await
        .unwrap();
    assert!(format!("{:?}", result.failures()).contains("is private"), "{:?}", result.failures());
    assert!(!s.listed().await);
}

#[tokio::test]
async fn slashed_money_stays_locked_and_the_challenger_gets_the_deposit_back() {
    let s = setup(0).await;
    let _ = s.register(&s.guardian, 2).await;
    let stranger_before = s.stranger.view_account().await.unwrap().balance.as_yoctonear();
    let id = s.challenge().await;
    assert!(s.vote(0, &id, json!({ "Slash": { "bps": 5000 } })).await.is_success());
    assert!(s.vote(1, &id, json!({ "Slash": { "bps": 5000 } })).await.is_success());
    let operator = s.operator().await;
    let stake: u128 = operator["stake"].as_str().unwrap().parse().unwrap();
    let slashed: u128 = operator["total_slashed"].as_str().unwrap().parse().unwrap();
    assert_eq!(slashed, stake);
    // The challenger only loses 0.03 NEAR of storage plus gas; the rest of the deposit comes back.
    let stranger_after = s.stranger.view_account().await.unwrap().balance.as_yoctonear();
    let cost = stranger_before - stranger_after;
    assert!(cost >= 3 * ONE_NEAR / 100 && cost < 4 * ONE_NEAR / 100, "the challenge cost {cost}");
    // The contract balance still holds the slashed part: the money went nowhere.
    let balance = s.registry.view_account().await.unwrap().balance.as_yoctonear();
    assert!(balance >= stake + slashed, "balance {balance}, stake {stake}, slashed {slashed}");
    assert!(!s.listed().await || stake >= ONE_NEAR);
}

#[tokio::test]
async fn the_owner_gets_the_stake_back_after_a_real_withdrawal() {
    let s = setup(0).await;
    let _ = s.register(&s.guardian, 2).await;
    let request = s.guardian.call(s.registry.id(), "request_unstake").args_json(json!({ "controller": s.controller.id() })).max_gas().transact().await.unwrap();
    assert!(request.is_success(), "{:?}", request.failures());
    assert!(!s.listed().await);
    let before = s.guardian.view_account().await.unwrap().balance.as_yoctonear();
    let withdraw = s.guardian.call(s.registry.id(), "withdraw").args_json(json!({ "controller": s.controller.id() })).max_gas().transact().await.unwrap();
    assert!(withdraw.failures().is_empty(), "{:?}", withdraw.failures());
    let after = s.guardian.view_account().await.unwrap().balance.as_yoctonear();
    assert!(after > before + ONE_NEAR, "stake was not paid back");
    assert_eq!(s.operator().await["withdrawn"], true);
}

#[tokio::test]
async fn the_wait_is_enforced_on_the_real_contract() {
    let s = setup(604_800).await;
    let _ = s.register(&s.guardian, 2).await;
    let _ = s.guardian.call(s.registry.id(), "request_unstake").args_json(json!({ "controller": s.controller.id() })).max_gas().transact().await.unwrap();
    let early = s.guardian.call(s.registry.id(), "withdraw").args_json(json!({ "controller": s.controller.id() })).max_gas().transact().await.unwrap();
    assert!(format!("{:?}", early.failures()).contains("unstake delay has not passed"), "{:?}", early.failures());
}

#[tokio::test]
async fn keeps_working_with_no_access_keys() {
    let s = setup(0).await;
    let keys = s.registry.view_access_keys().await.unwrap();
    let delete: Vec<_> = keys.iter().map(|key| key.public_key.clone()).collect();
    let mut tx = s.registry.as_account().batch(s.registry.id());
    for key in delete {
        tx = tx.delete_key(key);
    }
    tx.transact().await.unwrap().into_result().unwrap();
    assert_eq!(s.registry.view_access_keys().await.unwrap().len(), 0);
    let result = s.register(&s.guardian, 2).await;
    assert!(result.failures().is_empty(), "{:?}", result.failures());
    assert!(s.listed().await);
}
