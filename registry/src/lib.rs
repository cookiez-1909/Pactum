//! PactumRegistry: a public list of Pactum operators who staked NEAR.
//! Anyone can deploy their own Pactum, but only a staked one is on this list,
//! so posing as an official offer costs real money.
//!
//! Anyone can challenge with public evidence and a small deposit. The council votes to slash or dismiss.
//! Slashed funds stay locked in this contract forever, as if burned: the contract has no keys and no function to withdraw
//! them, so nobody profits from challenging or slashing.
//!
//! The contract cannot tell who cheated; that is human judgment. Testnet prototype, not audited.

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{env, ext_contract, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise};

#[cfg(test)]
mod tests;

const BPS: u128 = 10_000;
const NANOS_PER_SECOND: u64 = 1_000_000_000;
const MAX_WEBSITE_BYTES: usize = 200;
const MAX_EVIDENCE_BYTES: usize = 2_000;
const MAX_COUNCIL: usize = 16;
const MAX_LIST_LIMIT: u32 = 50;
const MAX_CONFIG_BYTES: usize = 16_384;
const GET_CONFIG_GAS: Gas = Gas::from_tgas(20);
const ON_CONFIG_GAS: Gas = Gas::from_tgas(30);
// Storage for one operator and one challenge at most, taken straight from the attached deposit.
const OPERATOR_STORAGE: NearToken = NearToken::from_millinear(10);
const CHALLENGE_STORAGE: NearToken = NearToken::from_millinear(30);

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Operators,
    Challenges,
    Controllers,
}

/// An operator, bound to exactly one controller.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Operator {
    pub controller: AccountId,
    pub owner: AccountId,
    pub website: String,
    pub stake: U128,
    pub total_slashed: U128,
    pub registered_at: U64,
    /// When the stake can be withdrawn, in seconds. Set means the operator asked to leave and is off the list.
    pub unstake_at: Option<U64>,
    pub open_challenges: u32,
    /// Slashed 100%: never listed again with this controller.
    pub banned: bool,
    pub withdrawn: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    Slash { bps: u16 },
    Dismiss,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChallengeStatus {
    Open,
    Upheld,
    Dismissed,
    Expired,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Vote {
    pub voter: AccountId,
    pub verdict: Verdict,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Challenge {
    pub id: U64,
    pub controller: AccountId,
    pub challenger: AccountId,
    pub evidence: String,
    pub deposit: U128,
    pub votes: Vec<Vote>,
    pub status: ChallengeStatus,
    pub slashed: U128,
    pub opened_at: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub council: Vec<AccountId>,
    pub council_threshold: u32,
    pub min_stake: U128,
    pub unstake_delay_seconds: U64,
    pub min_hold_seconds: U64,
    pub challenge_deposit: U128,
    pub challenge_ttl_seconds: U64,
    pub total_slashed: U128,
    pub total_forfeited: U128,
}

/// The part to read from `PactumController.get_config`.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct ControllerConfig {
    pub guardians: Vec<AccountId>,
}

#[ext_contract(ext_controller)]
#[allow(dead_code)]
trait Controller {
    fn get_config(&self) -> ControllerConfig;
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct PactumRegistry {
    council: Vec<AccountId>,
    council_threshold: u32,
    min_stake: u128,
    unstake_delay_seconds: u64,
    min_hold_seconds: u64,
    challenge_deposit: u128,
    challenge_ttl_seconds: u64,
    // Anyone who stakes can join, so the list is unbounded. Vectors read only what is needed, so fees do not grow with length.
    controllers: Vector<AccountId>,
    operators: LookupMap<AccountId, Operator>,
    next_challenge_id: u64,
    challenges: LookupMap<u64, Challenge>,
    total_slashed: u128,
    total_forfeited: u128,
}

fn now_seconds() -> u64 {
    env::block_timestamp() / NANOS_PER_SECOND
}

// Avoids a straight multiplication so large numbers cannot overflow.
fn share_of(amount: u128, bps: u16) -> u128 {
    let bps = u128::from(bps);
    amount / BPS * bps + amount % BPS * bps / BPS
}

#[near]
impl PactumRegistry {
    /// Initialized once. Parameters and the council never change afterwards, because this account will have every key removed.
    #[init]
    pub fn new(
        council: Vec<AccountId>,
        council_threshold: u32,
        min_stake: U128,
        unstake_delay_seconds: U64,
        min_hold_seconds: U64,
        challenge_deposit: U128,
        challenge_ttl_seconds: U64,
    ) -> Self {
        require!(!council.is_empty() && council.len() <= MAX_COUNCIL, "council size must be between 1 and 16");
        require!(
            council_threshold >= 1 && council_threshold as usize <= council.len(),
            "threshold must be between 1 and the council size"
        );
        for (index, member) in council.iter().enumerate() {
            require!(!council[..index].contains(member), "duplicate council member");
        }
        require!(min_stake.0 > 0, "min_stake must not be zero");
        require!(challenge_deposit.0 > CHALLENGE_STORAGE.as_yoctonear(), "challenge_deposit must cover storage");
        require!(challenge_ttl_seconds.0 > 0, "challenge_ttl_seconds must not be zero");
        Self {
            council,
            council_threshold,
            min_stake: min_stake.0,
            unstake_delay_seconds: unstake_delay_seconds.0,
            min_hold_seconds: min_hold_seconds.0,
            challenge_deposit: challenge_deposit.0,
            challenge_ttl_seconds: challenge_ttl_seconds.0,
            controllers: Vector::new(StorageKey::Controllers),
            operators: LookupMap::new(StorageKey::Operators),
            next_challenge_id: 0,
            challenges: LookupMap::new(StorageKey::Challenges),
            total_slashed: 0,
            total_forfeited: 0,
        }
    }

    /// Registers a controller with a stake. The contract asks that controller, and only one of its guardians
    /// can register it, so nobody can claim someone else's controller or squat on its name.
    #[payable]
    pub fn register(&mut self, controller: AccountId, website: String) -> Promise {
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= self.min_stake + OPERATOR_STORAGE.as_yoctonear(), "attached deposit is below the minimum stake");
        require!(website.len() <= MAX_WEBSITE_BYTES, "website is too long");
        require!(self.can_take(&controller), "controller is already registered");
        ext_controller::ext(controller.clone())
            .with_static_gas(GET_CONFIG_GAS)
            .get_config()
            .then(Self::ext(env::current_account_id()).with_static_gas(ON_CONFIG_GAS).on_config(
                controller,
                env::predecessor_account_id(),
                U128(attached),
                website,
            ))
    }

    /// Receives the controller's answer. No panics here: a panic would keep the registrant's money, so every failure path refunds.
    #[private]
    pub fn on_config(&mut self, controller: AccountId, caller: AccountId, attached: U128, website: String) -> bool {
        let guardian = env::promise_result_checked(0, MAX_CONFIG_BYTES)
            .ok()
            .and_then(|bytes| near_sdk::serde_json::from_slice::<ControllerConfig>(&bytes).ok())
            .is_some_and(|config| config.guardians.contains(&caller));
        // Check again: another registration may have finished while waiting for the answer.
        if !guardian || !self.can_take(&controller) {
            Promise::new(caller).transfer(NearToken::from_yoctonear(attached.0)).detach();
            return false;
        }
        let stake = attached.0 - OPERATOR_STORAGE.as_yoctonear();
        // Withdrawing and registering again does not erase the slashing history.
        let previous = self.operators.get(&controller).map(|operator| operator.total_slashed);
        if previous.is_none() {
            self.controllers.push(controller.clone());
        }
        self.operators.insert(
            controller.clone(),
            Operator {
                controller,
                owner: caller,
                website,
                stake: U128(stake),
                total_slashed: previous.unwrap_or(U128(0)),
                registered_at: U64(now_seconds()),
                unstake_at: None,
                open_challenges: 0,
                banned: false,
                withdrawn: false,
            },
        );
        true
    }

    /// Adds to the stake, for example after a partial slash.
    #[payable]
    pub fn add_stake(&mut self, controller: AccountId) {
        let attached = env::attached_deposit().as_yoctonear();
        let operator = self.owned(&controller);
        require!(!operator.withdrawn, "operator has withdrawn");
        require!(!operator.banned, "operator is banned");
        operator.stake = U128(operator.stake.0 + attached);
    }

    /// Asks to leave: off the list at once, but the money stays and can still be slashed until it is withdrawn.
    pub fn request_unstake(&mut self, controller: AccountId) {
        let (delay, hold) = (self.unstake_delay_seconds, self.min_hold_seconds);
        let operator = self.owned(&controller);
        require!(!operator.withdrawn, "operator has withdrawn");
        require!(operator.unstake_at.is_none(), "unstake already requested");
        let ready = (now_seconds() + delay).max(operator.registered_at.0 + hold);
        operator.unstake_at = Some(U64(ready));
    }

    /// Withdraws after the waiting period. Blocked while a challenge is open, so nobody escapes before a ruling.
    pub fn withdraw(&mut self, controller: AccountId) -> Promise {
        let operator = self.owned(&controller);
        require!(!operator.withdrawn, "operator has withdrawn");
        let ready = operator.unstake_at.unwrap_or_else(|| env::panic_str("unstake was not requested"));
        require!(now_seconds() >= ready.0, "unstake delay has not passed");
        require!(operator.open_challenges == 0, "an open challenge blocks withdrawal");
        let amount = operator.stake.0;
        let owner = operator.owner.clone();
        operator.stake = U128(0);
        operator.withdrawn = true;
        Promise::new(owner).transfer(NearToken::from_yoctonear(amount))
    }

    /// Anyone can challenge, with public evidence and a deposit against spam.
    #[payable]
    pub fn open_challenge(&mut self, controller: AccountId, evidence: String) -> U64 {
        require!(!evidence.is_empty() && evidence.len() <= MAX_EVIDENCE_BYTES, "evidence must be between 1 and 2000 bytes");
        let attached = env::attached_deposit().as_yoctonear();
        require!(attached >= self.challenge_deposit, "attached deposit is below the challenge deposit");
        let operator = self.operators.get_mut(&controller).unwrap_or_else(|| env::panic_str("operator not found"));
        require!(!operator.withdrawn, "operator has withdrawn");
        require!(!operator.banned, "operator is banned");
        operator.open_challenges += 1;
        let id = self.next_challenge_id;
        self.next_challenge_id += 1;
        self.challenges.insert(
            id,
            Challenge {
                id: U64(id),
                controller,
                challenger: env::predecessor_account_id(),
                evidence,
                deposit: U128(attached - CHALLENGE_STORAGE.as_yoctonear()),
                votes: Vec::new(),
                status: ChallengeStatus::Open,
                slashed: U128(0),
                opened_at: U64(now_seconds()),
            },
        );
        U64(id)
    }

    /// Council members vote, and can change their vote so a split council does not get stuck.
    /// When the threshold agrees on one verdict, it takes effect at once.
    pub fn vote_challenge(&mut self, challenge_id: U64, verdict: Verdict) {
        let caller = env::predecessor_account_id();
        require!(self.council.contains(&caller), "caller is not on the council");
        if let Verdict::Slash { bps } = verdict {
            require!(bps > 0 && u128::from(bps) <= BPS, "bps must be between 1 and 10000");
        }
        let threshold = self.council_threshold as usize;
        let challenge = self.challenge_mut(challenge_id.0);
        require!(challenge.status == ChallengeStatus::Open, "challenge is not open");
        let controller = challenge.controller.clone();
        challenge.votes.retain(|vote| vote.voter != caller);
        challenge.votes.push(Vote { voter: caller.clone(), verdict });
        let agreeing = challenge.votes.iter().filter(|vote| vote.verdict == verdict).count();
        let owner = self.operators.get(&controller).map(|operator| operator.owner.clone());
        require!(owner.as_ref() != Some(&caller), "the operator cannot vote on its own challenge");
        if agreeing >= threshold {
            self.resolve(challenge_id.0, verdict);
        }
    }

    /// If the council does not rule in time, anyone can close the challenge and the challenger gets the deposit back.
    /// That way a challenge cannot block an operator's withdrawal forever.
    pub fn close_expired(&mut self, challenge_id: U64) -> Promise {
        let ttl = self.challenge_ttl_seconds;
        let challenge = self.challenge_mut(challenge_id.0);
        require!(challenge.status == ChallengeStatus::Open, "challenge is not open");
        require!(now_seconds() >= challenge.opened_at.0 + ttl, "challenge has not expired");
        challenge.status = ChallengeStatus::Expired;
        let (controller, challenger, deposit) = (challenge.controller.clone(), challenge.challenger.clone(), challenge.deposit.0);
        self.release(&controller);
        Promise::new(challenger).transfer(NearToken::from_yoctonear(deposit))
    }

    /// Whether it is on the official list: enough stake, not leaving and not banned.
    pub fn is_listed(&self, controller: AccountId) -> bool {
        self.operators.get(&controller).is_some_and(|operator| {
            !operator.withdrawn && !operator.banned && operator.unstake_at.is_none() && operator.stake.0 >= self.min_stake
        })
    }

    pub fn get_operator(&self, controller: AccountId) -> Option<Operator> {
        self.operators.get(&controller).cloned()
    }

    pub fn list_operators(&self, from: u32, limit: u32) -> Vec<Operator> {
        self.controllers
            .iter()
            .skip(from as usize)
            .take(limit.min(MAX_LIST_LIMIT) as usize)
            .filter_map(|controller| self.operators.get(controller).cloned())
            .collect()
    }

    pub fn list_challenges(&self, from: U64, limit: u32) -> Vec<Challenge> {
        let end = from.0.saturating_add(u64::from(limit.min(MAX_LIST_LIMIT))).min(self.next_challenge_id);
        (from.0..end).filter_map(|id| self.challenges.get(&id).cloned()).collect()
    }

    pub fn get_config(&self) -> Config {
        Config {
            council: self.council.clone(),
            council_threshold: self.council_threshold,
            min_stake: U128(self.min_stake),
            unstake_delay_seconds: U64(self.unstake_delay_seconds),
            min_hold_seconds: U64(self.min_hold_seconds),
            challenge_deposit: U128(self.challenge_deposit),
            challenge_ttl_seconds: U64(self.challenge_ttl_seconds),
            total_slashed: U128(self.total_slashed),
            total_forfeited: U128(self.total_forfeited),
        }
    }
}

impl PactumRegistry {
    // The controller is free, or the previous operator left cleanly. A banned entry stays so its history is not erased.
    fn can_take(&self, controller: &AccountId) -> bool {
        self.operators.get(controller).is_none_or(|operator| operator.withdrawn && !operator.banned)
    }

    fn owned(&mut self, controller: &AccountId) -> &mut Operator {
        let caller = env::predecessor_account_id();
        let operator = self.operators.get_mut(controller).unwrap_or_else(|| env::panic_str("operator not found"));
        require!(operator.owner == caller, "caller is not the operator");
        operator
    }

    fn challenge_mut(&mut self, id: u64) -> &mut Challenge {
        self.challenges.get_mut(&id).unwrap_or_else(|| env::panic_str("challenge not found"))
    }

    fn release(&mut self, controller: &AccountId) {
        if let Some(operator) = self.operators.get_mut(controller) {
            operator.open_challenges = operator.open_challenges.saturating_sub(1);
        }
    }

    fn resolve(&mut self, id: u64, verdict: Verdict) {
        let challenge = self.challenge_mut(id);
        let controller = challenge.controller.clone();
        let challenger = challenge.challenger.clone();
        let deposit = challenge.deposit.0;
        match verdict {
            Verdict::Dismiss => {
                challenge.status = ChallengeStatus::Dismissed;
                self.total_forfeited += deposit;
                self.release(&controller);
            }
            Verdict::Slash { bps } => {
                challenge.status = ChallengeStatus::Upheld;
                let operator = self.operators.get_mut(&controller).unwrap_or_else(|| env::panic_str("operator not found"));
                let amount = share_of(operator.stake.0, bps);
                operator.stake = U128(operator.stake.0 - amount);
                operator.total_slashed = U128(operator.total_slashed.0 + amount);
                if u128::from(bps) == BPS {
                    operator.banned = true;
                }
                self.total_slashed += amount;
                self.challenge_mut(id).slashed = U128(amount);
                self.release(&controller);
                Promise::new(challenger).transfer(NearToken::from_yoctonear(deposit)).detach();
            }
        }
    }
}
