//! A fake contract standing in for the MPC network, used ONLY in local sandbox tests.
//! It records sign requests and returns exactly the kind of result a test wants to simulate. Its signatures are not real.

use near_sdk::serde_json::{json, Value};
use near_sdk::{env, near, AccountId, PanicOnDefault};

/// How the fake contract responds to `sign`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Ok,
    Panic,
    Malformed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct LastRequest {
    pub caller: AccountId,
    pub deposit_yocto: String,
    pub request: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct MockSigner {
    mode: Mode,
    calls: u32,
    last: Option<LastRequest>,
}

#[near]
impl MockSigner {
    #[init]
    pub fn new() -> Self {
        Self { mode: Mode::Ok, calls: 0, last: None }
    }

    pub fn set_mode(&mut self, mode: Mode) {
        self.mode = mode;
    }

    #[payable]
    pub fn sign(&mut self, request: Value) -> Value {
        self.calls += 1;
        self.last = Some(LastRequest {
            caller: env::predecessor_account_id(),
            deposit_yocto: env::attached_deposit().as_yoctonear().to_string(),
            request: request.to_string(),
        });
        match self.mode {
            Mode::Ok => json!({
                "scheme": "Secp256k1",
                "big_r": { "affine_point": "034e3cb210ca4197413b2066175a8a81a78e497e499f44116407e9371ce8a8dd99" },
                "s": { "scalar": "7cf8899358fe262a83ce4b1e4a98d157450203adab4a212847e48ef0c20c34f7" },
                "recovery_id": 0
            }),
            Mode::Malformed => json!({ "error": "not a signature" }),
            Mode::Panic => env::panic_str("mock signer failure"),
        }
    }

    pub fn calls(&self) -> u32 {
        self.calls
    }

    pub fn last(&self) -> Option<LastRequest> {
        self.last.clone()
    }
}
