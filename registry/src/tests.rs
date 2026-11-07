//! Unit tests: registration, withdrawal, challenges, slashing votes. The real call to a controller is in the sandbox tests.

use near_sdk::json_types::{U128, U64};
use near_sdk::test_utils::{get_created_receipts, VMContextBuilder};
use near_sdk::{test_vm_config, testing_env, AccountId, NearToken, PromiseResult, RuntimeFeesConfig};

use crate::{ChallengeStatus, PactumRegistry, Verdict, CHALLENGE_STORAGE, OPERATOR_STORAGE};

const NOW: u64 = 1_800_000_000;
const NEAR: u128 = 10u128.pow(24);
const MIN_STAKE: u128 = NEAR;
const DEPOSIT: u128 = NEAR / 10;
const DELAY: u64 = 604_800;
const HOLD: u64 = 15_811_200;
const TTL: u64 = 2_592_000;

fn account(name: &str) -> AccountId {
    name.parse().unwrap()
}

fn set(caller: &str, attached: u128, time: u64) {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(account("registry.testnet"))
        .predecessor_account_id(account(caller))
        .attached_deposit(NearToken::from_yoctonear(attached))
        .block_timestamp(time * 1_000_000_000)
        .prepaid_gas(near_sdk::Gas::from_tgas(300));
    testing_env!(context.build());
}

fn contract() -> PactumRegistry {
    set("deployer.testnet", 0, NOW);
    PactumRegistry::new(
        vec![account("c1.testnet"), account("c2.testnet"), account("c3.testnet")],
        2,
        U128(MIN_STAKE),
        U64(DELAY),
        U64(HOLD),
        U128(DEPOSIT),
        U64(TTL),
    )
}

// Calls on_config as if the controller had just returned its guardian list.
fn answer(r: &mut PactumRegistry, caller: &str, attached: u128, reply: PromiseResult) -> bool {
    let mut context = VMContextBuilder::new();
    context
        .current_account_id(account("registry.testnet"))
        .predecessor_account_id(account("registry.testnet"))
        .block_timestamp(NOW * 1_000_000_000)
        .prepaid_gas(near_sdk::Gas::from_tgas(300));
    testing_env!(context.build(), test_vm_config(), RuntimeFeesConfig::test(), Default::default(), vec![reply]);
    r.on_config(account("ctrl.testnet"), account(caller), U128(attached), "https://example.org".to_string())
}

fn guardians(names: &[&str]) -> PromiseResult {
    let list: Vec<String> = names.iter().map(|name| (*name).to_string()).collect();
    PromiseResult::Successful(near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({ "guardians": list, "threshold": 2 })).unwrap())
}

fn registered() -> PactumRegistry {
    let mut r = contract();
    assert!(answer(&mut r, "op.testnet", 2 * NEAR, guardians(&["op.testnet"])));
    r
}

fn stake_of(r: &PactumRegistry) -> u128 {
    r.get_operator(account("ctrl.testnet")).unwrap().stake.0
}

fn open(r: &mut PactumRegistry) -> U64 {
    set("watcher.testnet", DEPOSIT, NOW);
    r.open_challenge(account("ctrl.testnet"), "The refund list pays the team".to_string())
}

fn vote(r: &mut PactumRegistry, who: &str, id: U64, verdict: Verdict) {
    set(who, 0, NOW);
    r.vote_challenge(id, verdict);
}

fn transfers_to(name: &str) -> usize {
    get_created_receipts().into_iter().filter(|receipt| receipt.receiver_id == account(name)).count()
}

#[test]
#[should_panic(expected = "threshold must be between")]
fn init_rejects_an_impossible_threshold() {
    set("deployer.testnet", 0, NOW);
    PactumRegistry::new(vec![account("c1.testnet")], 2, U128(1), U64(1), U64(1), U128(DEPOSIT), U64(1));
}

#[test]
#[should_panic(expected = "duplicate council member")]
fn init_rejects_a_repeated_member() {
    set("deployer.testnet", 0, NOW);
    PactumRegistry::new(vec![account("c1.testnet"), account("c1.testnet")], 1, U128(1), U64(1), U64(1), U128(DEPOSIT), U64(1));
}

#[test]
#[should_panic(expected = "challenge_deposit must cover storage")]
fn init_rejects_a_challenge_deposit_below_storage() {
    set("deployer.testnet", 0, NOW);
    PactumRegistry::new(vec![account("c1.testnet")], 1, U128(1), U64(1), U64(1), U128(1), U64(1));
}

#[test]
#[should_panic(expected = "below the minimum stake")]
fn register_needs_the_minimum_stake() {
    let mut r = contract();
    set("op.testnet", MIN_STAKE, NOW);
    let _ = r.register(account("ctrl.testnet"), String::new());
}

#[test]
#[should_panic(expected = "website is too long")]
fn register_limits_the_website() {
    let mut r = contract();
    set("op.testnet", 2 * NEAR, NOW);
    let _ = r.register(account("ctrl.testnet"), "x".repeat(201));
}

#[test]
fn a_guardian_of_the_controller_gets_listed_and_storage_comes_off_the_stake() {
    let r = registered();
    let operator = r.get_operator(account("ctrl.testnet")).unwrap();
    assert_eq!(operator.owner, account("op.testnet"));
    assert_eq!(operator.stake.0, 2 * NEAR - OPERATOR_STORAGE.as_yoctonear());
    assert!(r.is_listed(account("ctrl.testnet")));
    assert_eq!(r.list_operators(0, 10).len(), 1);
}

#[test]
fn a_stranger_cannot_claim_a_controller_and_gets_the_money_back() {
    let mut r = contract();
    assert!(!answer(&mut r, "stranger.testnet", 2 * NEAR, guardians(&["op.testnet"])));
    assert!(r.get_operator(account("ctrl.testnet")).is_none());
    assert_eq!(transfers_to("stranger.testnet"), 1);
}

#[test]
fn a_controller_that_fails_to_answer_refunds_the_caller() {
    let mut r = contract();
    assert!(!answer(&mut r, "op.testnet", 2 * NEAR, PromiseResult::Failed));
    assert_eq!(transfers_to("op.testnet"), 1);
    assert!(!r.is_listed(account("ctrl.testnet")));
}

#[test]
fn a_malformed_answer_refunds_the_caller() {
    let mut r = contract();
    assert!(!answer(&mut r, "op.testnet", 2 * NEAR, PromiseResult::Successful(b"not json".to_vec())));
    assert_eq!(transfers_to("op.testnet"), 1);
}

#[test]
fn a_second_registration_is_refunded_and_keeps_the_first() {
    let mut r = registered();
    assert!(!answer(&mut r, "other.testnet", 5 * NEAR, guardians(&["other.testnet"])));
    assert_eq!(transfers_to("other.testnet"), 1);
    assert_eq!(r.get_operator(account("ctrl.testnet")).unwrap().owner, account("op.testnet"));
}

#[test]
#[should_panic(expected = "controller is already registered")]
fn register_rejects_a_taken_controller_early() {
    let mut r = registered();
    set("other.testnet", 2 * NEAR, NOW);
    let _ = r.register(account("ctrl.testnet"), String::new());
}

#[test]
fn unstaking_leaves_the_list_at_once_but_only_pays_after_the_wait() {
    let mut r = registered();
    set("op.testnet", 0, NOW);
    r.request_unstake(account("ctrl.testnet"));
    assert!(!r.is_listed(account("ctrl.testnet")));
    // The waiting time since registration must also pass, not only the time since asking to leave.
    assert_eq!(r.get_operator(account("ctrl.testnet")).unwrap().unstake_at.unwrap().0, NOW + HOLD);
    set("op.testnet", 0, NOW + HOLD);
    let _ = r.withdraw(account("ctrl.testnet"));
    let operator = r.get_operator(account("ctrl.testnet")).unwrap();
    assert!(operator.withdrawn);
    assert_eq!(operator.stake.0, 0);
    assert_eq!(transfers_to("op.testnet"), 1);
}

#[test]
fn the_unstake_delay_applies_after_the_holding_period() {
    let mut r = registered();
    set("op.testnet", 0, NOW + HOLD);
    r.request_unstake(account("ctrl.testnet"));
    assert_eq!(r.get_operator(account("ctrl.testnet")).unwrap().unstake_at.unwrap().0, NOW + HOLD + DELAY);
}

#[test]
#[should_panic(expected = "unstake delay has not passed")]
fn withdraw_waits_for_the_delay() {
    let mut r = registered();
    set("op.testnet", 0, NOW);
    r.request_unstake(account("ctrl.testnet"));
    set("op.testnet", 0, NOW + HOLD - 1);
    let _ = r.withdraw(account("ctrl.testnet"));
}

#[test]
#[should_panic(expected = "unstake was not requested")]
fn withdraw_needs_a_request() {
    let mut r = registered();
    set("op.testnet", 0, NOW + HOLD);
    let _ = r.withdraw(account("ctrl.testnet"));
}

#[test]
#[should_panic(expected = "caller is not the operator")]
fn only_the_operator_can_unstake() {
    let mut r = registered();
    set("stranger.testnet", 0, NOW);
    r.request_unstake(account("ctrl.testnet"));
}

#[test]
#[should_panic(expected = "operator has withdrawn")]
fn withdraw_only_pays_once() {
    let mut r = registered();
    set("op.testnet", 0, NOW);
    r.request_unstake(account("ctrl.testnet"));
    set("op.testnet", 0, NOW + HOLD);
    let _ = r.withdraw(account("ctrl.testnet"));
    let _ = r.withdraw(account("ctrl.testnet"));
}

#[test]
#[should_panic(expected = "an open challenge blocks withdrawal")]
fn an_open_challenge_blocks_withdrawal() {
    let mut r = registered();
    set("op.testnet", 0, NOW);
    r.request_unstake(account("ctrl.testnet"));
    open(&mut r);
    set("op.testnet", 0, NOW + HOLD);
    let _ = r.withdraw(account("ctrl.testnet"));
}

#[test]
fn an_operator_who_withdrew_can_register_again() {
    let mut r = registered();
    set("op.testnet", 0, NOW);
    r.request_unstake(account("ctrl.testnet"));
    set("op.testnet", 0, NOW + HOLD);
    let _ = r.withdraw(account("ctrl.testnet"));
    assert!(answer(&mut r, "op.testnet", 2 * NEAR, guardians(&["op.testnet"])));
    assert!(r.is_listed(account("ctrl.testnet")));
    assert_eq!(r.list_operators(0, 10).len(), 1, "the controller must not be listed twice");
}

#[test]
#[should_panic(expected = "below the challenge deposit")]
fn a_challenge_needs_the_deposit() {
    let mut r = registered();
    set("watcher.testnet", DEPOSIT - 1, NOW);
    r.open_challenge(account("ctrl.testnet"), "x".to_string());
}

#[test]
#[should_panic(expected = "evidence must be between")]
fn a_challenge_needs_evidence() {
    let mut r = registered();
    set("watcher.testnet", DEPOSIT, NOW);
    r.open_challenge(account("ctrl.testnet"), String::new());
}

#[test]
#[should_panic(expected = "evidence must be between")]
fn evidence_has_a_size_limit() {
    let mut r = registered();
    set("watcher.testnet", DEPOSIT, NOW);
    r.open_challenge(account("ctrl.testnet"), "x".repeat(2_001));
}

#[test]
#[should_panic(expected = "operator not found")]
fn a_challenge_needs_an_operator() {
    let mut r = contract();
    set("watcher.testnet", DEPOSIT, NOW);
    r.open_challenge(account("nobody.testnet"), "x".to_string());
}

#[test]
fn a_slash_takes_effect_at_the_threshold_and_returns_the_deposit() {
    let mut r = registered();
    let before = stake_of(&r);
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Slash { bps: 2_500 });
    assert_eq!(stake_of(&r), before, "slashed below threshold");
    vote(&mut r, "c2.testnet", id, Verdict::Slash { bps: 2_500 });
    assert_eq!(stake_of(&r), before - before / 4);
    assert_eq!(transfers_to("watcher.testnet"), 1);
    let challenge = &r.list_challenges(U64(0), 10)[0];
    assert_eq!(challenge.status, ChallengeStatus::Upheld);
    assert_eq!(challenge.slashed.0, before / 4);
    assert_eq!(challenge.deposit.0, DEPOSIT - CHALLENGE_STORAGE.as_yoctonear());
    assert_eq!(r.get_config().total_slashed.0, before / 4);
    assert_eq!(r.get_operator(account("ctrl.testnet")).unwrap().open_challenges, 0);
}

#[test]
fn nobody_receives_the_slashed_money() {
    let mut r = registered();
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Slash { bps: 5_000 });
    set("c2.testnet", 0, NOW);
    r.vote_challenge(id, Verdict::Slash { bps: 5_000 });
    // Only one transfer: the challenger's deposit is returned. The slashed part stays in the contract.
    assert_eq!(get_created_receipts().len(), 1);
    assert_eq!(transfers_to("watcher.testnet"), 1);
}

#[test]
fn different_percentages_do_not_add_up() {
    let mut r = registered();
    let before = stake_of(&r);
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Slash { bps: 1_000 });
    vote(&mut r, "c2.testnet", id, Verdict::Slash { bps: 5_000 });
    assert_eq!(stake_of(&r), before);
}

#[test]
fn a_member_can_change_their_vote() {
    let mut r = registered();
    let before = stake_of(&r);
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Slash { bps: 1_000 });
    vote(&mut r, "c2.testnet", id, Verdict::Dismiss);
    vote(&mut r, "c2.testnet", id, Verdict::Slash { bps: 1_000 });
    assert_eq!(stake_of(&r), before - before / 10);
}

#[test]
fn one_member_voting_twice_is_still_one_vote() {
    let mut r = registered();
    let before = stake_of(&r);
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Dismiss);
    vote(&mut r, "c1.testnet", id, Verdict::Dismiss);
    assert_eq!(r.list_challenges(U64(0), 10)[0].status, ChallengeStatus::Open);
    assert_eq!(stake_of(&r), before);
}

#[test]
fn a_full_slash_bans_the_operator_for_good() {
    let mut r = registered();
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Slash { bps: 10_000 });
    vote(&mut r, "c2.testnet", id, Verdict::Slash { bps: 10_000 });
    let operator = r.get_operator(account("ctrl.testnet")).unwrap();
    assert!(operator.banned);
    assert_eq!(operator.stake.0, 0);
    assert!(!r.is_listed(account("ctrl.testnet")));
    assert!(!answer(&mut r, "op.testnet", 5 * NEAR, guardians(&["op.testnet"])), "a banned controller cannot come back");
}

#[test]
fn a_slash_below_the_minimum_removes_the_listing_until_topped_up() {
    let mut r = registered();
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Slash { bps: 9_000 });
    vote(&mut r, "c2.testnet", id, Verdict::Slash { bps: 9_000 });
    assert!(!r.is_listed(account("ctrl.testnet")));
    set("op.testnet", 2 * NEAR, NOW);
    r.add_stake(account("ctrl.testnet"));
    assert!(r.is_listed(account("ctrl.testnet")));
    assert!(r.get_operator(account("ctrl.testnet")).unwrap().total_slashed.0 > 0, "the history stays public");
}

#[test]
fn an_operator_who_is_leaving_can_still_be_slashed() {
    let mut r = registered();
    set("op.testnet", 0, NOW);
    r.request_unstake(account("ctrl.testnet"));
    let before = stake_of(&r);
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Slash { bps: 1_000 });
    vote(&mut r, "c2.testnet", id, Verdict::Slash { bps: 1_000 });
    assert_eq!(stake_of(&r), before - before / 10);
}

#[test]
fn a_dismissed_challenge_forfeits_the_deposit_and_frees_the_operator() {
    let mut r = registered();
    let before = stake_of(&r);
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Dismiss);
    set("c2.testnet", 0, NOW);
    r.vote_challenge(id, Verdict::Dismiss);
    assert_eq!(transfers_to("watcher.testnet"), 0);
    assert_eq!(stake_of(&r), before);
    assert_eq!(r.list_challenges(U64(0), 10)[0].status, ChallengeStatus::Dismissed);
    assert_eq!(r.get_config().total_forfeited.0, DEPOSIT - CHALLENGE_STORAGE.as_yoctonear());
    assert_eq!(r.get_operator(account("ctrl.testnet")).unwrap().open_challenges, 0);
}

#[test]
#[should_panic(expected = "caller is not on the council")]
fn a_stranger_cannot_vote() {
    let mut r = registered();
    let id = open(&mut r);
    vote(&mut r, "stranger.testnet", id, Verdict::Dismiss);
}

#[test]
#[should_panic(expected = "the operator cannot vote on its own challenge")]
fn a_council_member_cannot_judge_their_own_operator() {
    let mut r = contract();
    assert!(answer(&mut r, "c1.testnet", 2 * NEAR, guardians(&["c1.testnet"])));
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Dismiss);
}

#[test]
#[should_panic(expected = "bps must be between")]
fn a_slash_above_everything_is_refused() {
    let mut r = registered();
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Slash { bps: 10_001 });
}

#[test]
#[should_panic(expected = "bps must be between")]
fn a_slash_of_nothing_is_refused() {
    let mut r = registered();
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Slash { bps: 0 });
}

#[test]
#[should_panic(expected = "challenge is not open")]
fn a_decided_challenge_stays_decided() {
    let mut r = registered();
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Dismiss);
    vote(&mut r, "c2.testnet", id, Verdict::Dismiss);
    vote(&mut r, "c3.testnet", id, Verdict::Slash { bps: 10_000 });
}

#[test]
#[should_panic(expected = "challenge has not expired")]
fn a_challenge_cannot_be_closed_early() {
    let mut r = registered();
    let id = open(&mut r);
    set("anyone.testnet", 0, NOW + TTL - 1);
    let _ = r.close_expired(id);
}

#[test]
fn an_ignored_challenge_expires_and_stops_blocking_withdrawal() {
    let mut r = registered();
    set("op.testnet", 0, NOW);
    r.request_unstake(account("ctrl.testnet"));
    let id = open(&mut r);
    set("anyone.testnet", 0, NOW + TTL);
    let _ = r.close_expired(id);
    assert_eq!(transfers_to("watcher.testnet"), 1);
    assert_eq!(r.list_challenges(U64(0), 10)[0].status, ChallengeStatus::Expired);
    set("op.testnet", 0, NOW + HOLD + TTL);
    let _ = r.withdraw(account("ctrl.testnet"));
    assert!(r.get_operator(account("ctrl.testnet")).unwrap().withdrawn);
}

#[test]
fn large_stakes_do_not_overflow() {
    assert_eq!(crate::share_of(u128::MAX, 10_000), u128::MAX);
    assert_eq!(crate::share_of(10_001, 5_000), 5_000);
    assert_eq!(crate::share_of(0, 5_000), 0);
}

#[test]
fn registering_again_keeps_the_slashing_history() {
    let mut r = registered();
    let id = open(&mut r);
    vote(&mut r, "c1.testnet", id, Verdict::Slash { bps: 1_000 });
    vote(&mut r, "c2.testnet", id, Verdict::Slash { bps: 1_000 });
    let slashed = r.get_operator(account("ctrl.testnet")).unwrap().total_slashed.0;
    set("op.testnet", 0, NOW);
    r.request_unstake(account("ctrl.testnet"));
    set("op.testnet", 0, NOW + HOLD);
    let _ = r.withdraw(account("ctrl.testnet"));
    assert!(answer(&mut r, "op.testnet", 2 * NEAR, guardians(&["op.testnet"])));
    assert_eq!(r.get_operator(account("ctrl.testnet")).unwrap().total_slashed.0, slashed);
}
