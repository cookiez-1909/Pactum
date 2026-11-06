# Return Desk

Return Desk lets whoever holds exploited funds return them and receive a published reward in one transaction, while the rest becomes refunds that users claim directly. It removes the steps where a hacker, a protocol team and users each have to trust one another after a hack.

Built at NEAR HACKATHON. Testnet prototype with fake tokens, not audited. **Do not send real or stolen funds.**

| | |
| --- | --- |
| ReturnDesk (Sepolia) | [`0xf3d202683d9a05fb4272ab313589e9a0cbe5bdba`](https://sepolia.etherscan.io/address/0xf3d202683d9a05fb4272ab313589e9a0cbe5bdba) |
| MockUSD (Sepolia) | [`0x03b625896462770d7fbad0e81c0c59f229d72f37`](https://sepolia.etherscan.io/address/0x03b625896462770d7fbad0e81c0c59f229d72f37) |
| VulnerableVault (Sepolia, intentionally buggy) | [`0xe5c7c24001bf9e8eef7e4d15f1fcdfb7c5545c20`](https://sepolia.etherscan.io/address/0xe5c7c24001bf9e8eef7e4d15f1fcdfb7c5545c20) |
| ReturnDeskController (NEAR testnet) | [`ctrl-aadc19d6.rd-stranger-93cc38385a.testnet`](https://testnet.nearblocks.io/address/ctrl-aadc19d6.rd-stranger-93cc38385a.testnet) |
| Controller address on EVM | [`0x083939Bb99D1491d3836E3302E5a638D4543f27e`](https://sepolia.etherscan.io/address/0x083939Bb99D1491d3836E3302E5a638D4543f27e) |
| The one transaction | [reward and refund split](https://sepolia.etherscan.io/tx/0xa1806458da60efe9768905be81ad5ba51877dc6eb780588f0dfac003433f3dfa) |
| Chain Signatures approval | [`2VS2B79A…`](https://testnet.nearblocks.io/txns/2VS2B79AzzozJ7LA8upLsSmkoH4KeXftifFXQ8FUxU3x) |
| Video and X post | Not published yet |
| Hosted demo | Not published yet |

Every transaction is listed in [`deployments/sepolia.json`](deployments/sepolia.json).

## Try it in 2 minutes

You need `git`, `make`, [Foundry](https://getfoundry.sh), Rust, Node.js 22 or newer and network access. No wallet and no keys.

```text
make setup        → installs submodules and npm packages
make demo-local   → log contains: stolen 1,000,000; reward 100,000; refund pool 900,000; claimed 900,000
make verify       → reads the existing testnet transactions, prints 19 checks marked PASS and a PASS summary
```

In a clean-room run on a machine with cached Rust crates, these three took about 50 seconds. Warnings from `npm ci` do not stop the setup.

Then, if you want more:

```text
make test         → all tests pass: 64 in Foundry, 20 in Rust. Took about 2 minutes, mostly compiling Rust
make web-local    → serves http://localhost:5173, open it to return the funds and claim refunds with test accounts
```

`make web-local` uses ports 5173 and 8546 and runs until you press Ctrl-C.

`make demo-local` and `make web-local` run on Anvil with a **simulated** controller: a local test key replaces NEAR. Only `make demo-testnet` and `make verify` involve Chain Signatures.

`make demo-testnet` repeats the whole flow on Sepolia and NEAR testnet. It needs a funded Sepolia key in `.env` (see [`.env.example`](.env.example)) and `cargo-near`. The NEAR faucet limits how many accounts one machine can create, so the script reuses guardian accounts between runs.

```bash
cargo install cargo-near --locked --version 0.23.0 --no-default-features
```

## The problem

After a hack, a protocol often posts an on-chain message such as "return 90%, keep 10%". That negotiation has three weak points:

- The hacker fears returning the funds and getting nothing, or being identified while making contact.
- The protocol fears paying first and receiving nothing back.
- Users fear the money reaches the team's wallet and is never shared out fairly.

Hackers have returned funds after such negotiations, for example at [Euler](https://www.coindesk.com/business/2023/04/03/euler-says-all-recoverable-funds-stolen-in-200m-hack-have-been-returned) and [Poly Network](https://blockworks.co/news/poly-network-hacker-returns-600-million-offered-500000-bug-bounty). Those were manual processes with no contract enforcing the outcome.

## How it works

```text
Attacker returns 1,000,000 mUSD at a 10% reward, in one transaction
├─ 100,000 mUSD → reward address chosen by the attacker
└─ 900,000 mUSD → refund pool, claimed by users with Merkle proofs
```

```text
Guardians (several NEAR accounts)
      │ propose_case, approve_case
      ▼
ReturnDeskController on NEAR testnet
      │ hashes the approved terms, requests a signature
      ▼
Chain Signatures (v1.signer-prod.testnet)
      │ EIP-712 signature, stored on NEAR for anyone to read
      ▼
Anyone relays it to Sepolia (the relayer needs no trust)
      ▼
ReturnDesk on Sepolia
      ├─ openCase(terms, signature)
      ├─ returnFunds(): atomic split
      └─ claimRefund(): users claim with a Merkle proof
```

The split lives in the EVM contract because NEAR cannot read EVM state by itself. Sending funds to a Chain Signatures address and splitting them later would require trusting someone to report the result, and it would lose atomicity.

Formulas:

```text
reward = min(rewardBps × received / 10000, rewardCap − rewardPaidSoFar)
refund = received − reward
claimable = allocation × totalRefund / totalLoss − alreadyClaimed
```

Properties enforced by [`ReturnDesk.sol`](contracts/src/ReturnDesk.sol):

- The reward and the refund booking happen in the same transaction.
- No reward fund is needed: the reward comes out of the returned money.
- The reward falls over time and `returnFunds` reverts after the last tier.
- Terms cannot change after `openCase`.
- There is no owner, no upgrade path and no withdraw function. Tokens leave only through `returnFunds` and `claimRefund`.

## How NEAR is used

- **Chain Signatures: control without a private key.** `ReturnDesk.controller` is an address derived from the NEAR contract account. Its signature comes from the MPC network, only when the contract asks. `make verify` checks the derivation and that the signature recovers to that address.
- **NEAR smart contract: public approval rules.** [`ReturnDeskController`](controller/src/lib.rs) holds the guardians, the 2-of-3 threshold and a global reward limit. It validates the terms and computes the EIP-712 digest itself. There is no function that signs an arbitrary payload, so only the digest of approved terms can ever be signed.
- **A contract account with no access keys.** After deployment every key of the controller account is deleted, and `make verify` confirms this. Nobody can change its code or act as it. The account was created as a sub-account to avoid the faucet limit, and [a parent has no control over its sub-accounts](https://docs.near.org/protocol/accounts-contracts/account-id).

The digest matches byte for byte across three independent implementations. viem generates [test vectors](contracts/test/vectors/case_terms.json), and both Solidity and Rust are tested against them. In the testnet run, the MPC network signed in 8.7 seconds, measured from the final approval to the stored signature.

**Honest limit of this design.** On one chain, an EVM multisig could do most of this. What NEAR adds is keyless control separated from the team's own infrastructure, and one controller that could serve several EVM chains. The prototype runs on Sepolia only: **multi-chain is a design, not something built here**.

## Why not just SEAL Safe Harbor?

[SEAL Safe Harbor](https://frameworks.securityalliance.org/safe-harbor/overview) is the closest existing framework and proves that the industry accepts publishing reward terms in advance. Return Desk is meant as an on-chain execution layer that complements it, not a replacement: **Safe Harbor states the terms, Return Desk executes the split and the refunds.**

This comparison comes from reading the [SEAL repository](https://github.com/security-alliance/safe-harbor) at commit `78ba923` and its [on-chain adoption guide](https://frameworks.securityalliance.org/safe-harbor/on-chain-adoption-guide). Its Solana folder contains no program source at that commit, so this covers the EVM contracts only.

| | SEAL Safe Harbor | Return Desk |
| --- | --- | --- |
| Moves tokens | No, `registry-contracts/src` only stores terms | Yes, receives and splits in one transaction |
| Where funds go | An Asset Recovery Address set by the protocol | A contract with no team withdrawal |
| Changing terms | The owner can call `setBountyTerms`, and SEAL's README warns whitehats to "assume protocols may act adversarially" | Impossible after `openCase` |
| Total cap with a kept reward | Rejected together: `Agreement__CannotSetBothAggregateBountyCapUsdAndRetainable` | Works, because the contract does the split |
| Who it serves | Eligible whitehats rescuing funds from an attack someone else started | Anyone holding the funds, including the original attacker |
| Legal protection | **Yes, SEAL is stronger here:** a legal agreement with a release of claims | **None**, only a payment commitment |
| Cap unit | USD | Token amount, so no price oracle is needed |

Someone holding the funds can also keep 10% and send the rest to the protocol without any contract. Return Desk adds only three things to that: a commitment that cannot change, automatic refunds, and a team that cannot touch the money. We searched public sources and did not find a product with this exact mechanism, which does not prove that none exists.

## Limits and risks

- **A team can hack itself.** It could drain its own protocol and "return" the funds to collect the reward. `rewardCap`, several guardians and public evidence reduce this risk but do not remove it. This is the biggest weakness.
- **No immunity from prosecution.** The contract only commits to a payment.
- **Sanctions.** Paying a sanctioned party may be illegal. Real use needs legal advice and screening, and this prototype has neither.
- **Professional groups may not return funds.** The best fit is an independent hacker at a small or mid-sized protocol.
- **Remaining trust.** `refundRoot` must be correct, and the Chain Signatures MPC network must behave correctly. A wrong root can misallocate that case's refunds, but tests show it cannot pay more than the case's pool or reach another case's tokens.
- **It does not stop hacks.** It only improves the chance of getting money back.
- **Locked tokens.** Tokens sent to `ReturnDesk` without `returnFunds`, a reward sent to the contract itself and rounding dust stay locked, because no withdrawal exists. Allocations that sum to less than the loss leave funds locked as well.
- **Token assumptions.** Fee-on-transfer tokens are tested. Tokens whose balances rebase downward are not supported.
- **Contract binary.** The NEAR contract is built with `cargo near build non-reproducible-wasm`, so the deployed code hash `A7Hh1B6ZRAAXeAqPfVQLzWVVSTiPvE4dxuJ2VNWJJgtt` is not proven to come from this source by a reproducible build.
- **Not audited.**

## Tests

| Command | Measured result |
| --- | --- |
| `cd contracts && forge test` | 64 passed. Fuzz 1,000 runs, invariants 256 runs at depth 64 |
| `cd contracts && forge coverage` | `ReturnDesk.sol`: 100% lines and 100% branches |
| `cd controller && cargo test` | 20 passed |

Covered as the spec requires: wrong signature, reused signature, wrong chain, tier boundaries, partial returns, `rewardCap`, after the deadline, reentrancy, fee-on-transfer tokens, wrong Merkle proofs, double claims, refunds never exceeding funds, and on NEAR: below threshold, duplicate approval, stranger approval and invalid terms. `#[private]` on the signature callback only applies in wasm, so it is checked on testnet by `make demo-testnet`. Foundry also verifies two real MPC signatures from testnet.

## Simulated, demo-only and intentionally broken parts

- `make demo-local` and `make web-local`: the controller is a local test key, not NEAR. The output says `SIMULATED`.
- `VulnerableVault`: intentionally vulnerable. `emergencyWithdraw` has no access control.
- `MockUSD`: anyone can mint it, so it has no value.
- Users, attacker and reward wallets in the demo are test accounts controlled by the demo script.
- [`spike/chain-signatures`](spike/chain-signatures) is the first experiment that proved an MPC signature recovers correctly on the EVM. It is kept as evidence and is not part of the product.

## Repository

```text
contracts/    Solidity contracts and Foundry tests
controller/   NEAR contract in Rust
scripts/      demo, verify and test vector generation in TypeScript
web/          React app: Incident, Return, Refund, Ledger
deployments/  public addresses and transaction hashes of the testnet run
spike/        first Chain Signatures experiment, kept as evidence
```

Code comments are written in Vietnamese, the language of the author. Identifiers, logs and the interface are in English.

## Disclosure

All code in this repository was written during the hackathon window, from 2026-11-06. It reuses no earlier project and no template. Much of the code was written with an AI coding tool.

- **AI tools:** Claude Code.
- **Solidity:** [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) 5.6.1, [forge-std](https://github.com/foundry-rs/forge-std), [Foundry](https://getfoundry.sh).
- **NEAR:** [near-sdk](https://crates.io/crates/near-sdk) 5.30.1, [cargo-near](https://crates.io/crates/cargo-near) 0.23.0, NEAR Chain Signatures through `v1.signer-prod.testnet`.
- **TypeScript:** [viem](https://viem.sh) 2.57.16, [near-api-js](https://www.npmjs.com/package/near-api-js) 7.4.0, [@openzeppelin/merkle-tree](https://www.npmjs.com/package/@openzeppelin/merkle-tree) 1.0.8, [@noble/curves](https://www.npmjs.com/package/@noble/curves) and [@noble/hashes](https://www.npmjs.com/package/@noble/hashes) 2.4.0, tsx, TypeScript.
- **Web:** React 19, Vite, IBM Plex fonts from Google Fonts.
- **Reference only:** the [near/mpc](https://github.com/near/mpc) source at the deployed commit, for the signing interface and key derivation.

## License

[MIT](LICENSE)
