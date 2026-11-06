//! EIP-712 hash of a case's terms. It must match `Pactum.hashCaseTerms` byte for byte.
//! Checked against the test vectors in `contracts/test/vectors/case_terms.json`.

use near_sdk::env;

use crate::types::ParsedTerms;

const DOMAIN_TYPE: &[u8] =
    b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const DOMAIN_NAME: &[u8] = b"Pactum";
const DOMAIN_VERSION: &[u8] = b"1";
const REWARD_TIER_TYPE: &[u8] = b"RewardTier(uint64 until,uint16 rewardBps)";
const CASE_TERMS_TYPE: &[u8] = b"CaseTerms(bytes32 caseId,address token,uint256 totalLoss,uint256 maxReturn,uint256 rewardCap,bytes32 refundRoot,bytes32 evidenceHash,RewardTier[] tiers,uint256 nonce,uint256 chainId)RewardTier(uint64 until,uint16 rewardBps)";

fn keccak(data: &[u8]) -> [u8; 32] {
    env::keccak256_array(data)
}

// Every value in abi.encode takes exactly 32 bytes; numbers and addresses are left-padded.
fn word_u64(value: u64) -> [u8; 32] {
    let mut word = [0u8; 32];
    word[24..].copy_from_slice(&value.to_be_bytes());
    word
}

fn word_address(address: &[u8; 20]) -> [u8; 32] {
    let mut word = [0u8; 32];
    word[12..].copy_from_slice(address);
    word
}

fn hash_words(words: &[[u8; 32]]) -> [u8; 32] {
    keccak(&words.concat())
}

fn domain_separator(chain_id: u64, verifying_contract: &[u8; 20]) -> [u8; 32] {
    hash_words(&[
        keccak(DOMAIN_TYPE),
        keccak(DOMAIN_NAME),
        keccak(DOMAIN_VERSION),
        word_u64(chain_id),
        word_address(verifying_contract),
    ])
}

fn tiers_hash(terms: &ParsedTerms) -> [u8; 32] {
    let tier_type = keccak(REWARD_TIER_TYPE);
    let hashes: Vec<[u8; 32]> = terms
        .tiers
        .iter()
        .map(|(until, bps)| hash_words(&[tier_type, word_u64(*until), word_u64(u64::from(*bps))]))
        .collect();
    hash_words(&hashes)
}

/// Final hash: keccak256(0x1901 || domainSeparator || structHash).
pub fn case_digest(terms: &ParsedTerms, verifying_contract: &[u8; 20]) -> [u8; 32] {
    let struct_hash = hash_words(&[
        keccak(CASE_TERMS_TYPE),
        terms.case_id,
        word_address(&terms.token),
        terms.total_loss,
        terms.max_return,
        terms.reward_cap,
        terms.refund_root,
        terms.evidence_hash,
        tiers_hash(terms),
        word_u64(terms.nonce),
        word_u64(terms.chain_id),
    ]);
    let mut message = Vec::with_capacity(66);
    message.extend_from_slice(&[0x19, 0x01]);
    message.extend_from_slice(&domain_separator(terms.chain_id, verifying_contract));
    message.extend_from_slice(&struct_hash);
    keccak(&message)
}
