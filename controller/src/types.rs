//! The contract's public data types and the input format checks.

use near_sdk::json_types::U64;
use near_sdk::{near, AccountId};

/// The reward rate of one deadline tier.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RewardTier {
    pub until: U64,
    pub reward_bps: u16,
}

/// Case terms in a readable form: bytes as 0x-prefixed hex, uint256 as decimal.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CaseTerms {
    pub case_id: String,
    pub token: String,
    pub total_loss: String,
    pub max_return: String,
    pub reward_cap: String,
    pub refund_root: String,
    pub evidence_hash: String,
    pub tiers: Vec<RewardTier>,
    pub nonce: U64,
    pub chain_id: U64,
}

/// Proposal state. It only moves forward, except a failed signing request goes back to `Approved`.
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProposalStatus {
    Pending,
    Approved,
    Signing,
    Signed,
}

/// A proposal to open a case, with the fixed hash and the MPC signature once available.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: U64,
    pub terms: CaseTerms,
    pub digest: String,
    pub proposer: AccountId,
    pub approvals: Vec<AccountId>,
    pub status: ProposalStatus,
    /// The 65-byte signature (r || s || v) in hex, ready to pass to `Pactum.openCase`.
    pub signature: Option<String>,
}

/// Public configuration, unchanged after initialization.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Config {
    pub guardians: Vec<AccountId>,
    pub threshold: u32,
    pub pactum: String,
    pub chain_id: U64,
    pub derivation_path: String,
    pub signer_contract: AccountId,
    pub max_reward_bps: u16,
}

/// Arguments for the MPC contract's `sign` function.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SignRequest {
    pub path: String,
    pub payload_v2: SignPayload,
    pub domain_id: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub enum SignPayload {
    Ecdsa(String),
}

/// The MPC contract's secp256k1 response.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SignResponse {
    pub big_r: BigR,
    pub s: Scalar,
    pub recovery_id: u8,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct BigR {
    pub affine_point: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Scalar {
    pub scalar: String,
}

/// Terms converted to bytes, for checking and hashing.
pub struct ParsedTerms {
    pub case_id: [u8; 32],
    pub token: [u8; 20],
    pub total_loss: [u8; 32],
    pub max_return: [u8; 32],
    pub reward_cap: [u8; 32],
    pub refund_root: [u8; 32],
    pub evidence_hash: [u8; 32],
    pub tiers: Vec<(u64, u16)>,
    pub nonce: u64,
    pub chain_id: u64,
}

impl ParsedTerms {
    pub fn parse(terms: &CaseTerms) -> Result<Self, &'static str> {
        Ok(Self {
            case_id: parse_hex_fixed(&terms.case_id).ok_or("case_id must be 32-byte hex")?,
            token: parse_hex_fixed(&terms.token).ok_or("token must be 20-byte hex")?,
            total_loss: parse_uint256(&terms.total_loss).ok_or("total_loss must be a uint256")?,
            max_return: parse_uint256(&terms.max_return).ok_or("max_return must be a uint256")?,
            reward_cap: parse_uint256(&terms.reward_cap).ok_or("reward_cap must be a uint256")?,
            refund_root: parse_hex_fixed(&terms.refund_root)
                .ok_or("refund_root must be 32-byte hex")?,
            evidence_hash: parse_hex_fixed(&terms.evidence_hash)
                .ok_or("evidence_hash must be 32-byte hex")?,
            tiers: terms.tiers.iter().map(|t| (t.until.0, t.reward_bps)).collect(),
            nonce: terms.nonce.0,
            chain_id: terms.chain_id.0,
        })
    }
}

/// Reads 0x-prefixed hex of a fixed length. Only one spelling is accepted, so hashing is never ambiguous.
pub fn parse_hex_fixed<const N: usize>(value: &str) -> Option<[u8; N]> {
    let digits = value.strip_prefix("0x")?.as_bytes();
    if digits.len() != N * 2 {
        return None;
    }
    let mut out = [0u8; N];
    for (index, pair) in digits.chunks(2).enumerate() {
        out[index] = (hex_digit(pair[0])? << 4) | hex_digit(pair[1])?;
    }
    Some(out)
}

fn hex_digit(digit: u8) -> Option<u8> {
    match digit {
        b'0'..=b'9' => Some(digit - b'0'),
        b'a'..=b'f' => Some(digit - b'a' + 10),
        b'A'..=b'F' => Some(digit - b'A' + 10),
        _ => None,
    }
}

/// Reads a decimal uint256 into 32 big-endian bytes. Rejects leading zeros and overflow.
pub fn parse_uint256(value: &str) -> Option<[u8; 32]> {
    let digits = value.as_bytes();
    if digits.is_empty() || (digits.len() > 1 && digits[0] == b'0') {
        return None;
    }
    let mut out = [0u8; 32];
    for digit in digits {
        if !digit.is_ascii_digit() {
            return None;
        }
        let mut carry = u16::from(digit - b'0');
        for byte in out.iter_mut().rev() {
            let next = u16::from(*byte) * 10 + carry;
            *byte = (next & 0xff) as u8;
            carry = next >> 8;
        }
        if carry != 0 {
            return None;
        }
    }
    Some(out)
}

pub fn to_hex(bytes: &[u8]) -> String {
    const TABLE: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(2 + bytes.len() * 2);
    out.push_str("0x");
    for byte in bytes {
        out.push(TABLE[usize::from(byte >> 4)] as char);
        out.push(TABLE[usize::from(byte & 0x0f)] as char);
    }
    out
}

/// Turns an MPC response into an EVM signature: r is the x coordinate of big_r, v = 27 + recovery_id.
pub fn evm_signature(response: &SignResponse) -> Option<String> {
    let big_r: [u8; 33] = parse_hex_fixed(&format!("0x{}", response.big_r.affine_point))?;
    let s: [u8; 32] = parse_hex_fixed(&format!("0x{}", response.s.scalar))?;
    if response.recovery_id > 1 {
        return None;
    }
    let mut signature = Vec::with_capacity(65);
    signature.extend_from_slice(&big_r[1..]);
    signature.extend_from_slice(&s);
    signature.push(27 + response.recovery_id);
    Some(to_hex(&signature))
}
