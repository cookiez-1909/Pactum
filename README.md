# Pactum

Pactum lets whoever holds exploited funds return them and receive a published reward in one transaction, while the rest becomes refunds that users claim directly. It removes the steps where a hacker, a protocol team and users each have to trust one another after a hack.

Built at NEAR HACKATHON. Testnet prototype with fake tokens, not audited. **Do not send real or stolen funds.**

| | |
| --- | --- |
| Pactum (Sepolia) | [`0x9fe2cc3d0c8b467461cc2db2f154451cb4adf1fe`](https://sepolia.etherscan.io/address/0x9fe2cc3d0c8b467461cc2db2f154451cb4adf1fe) |
| MockUSD (Sepolia) | [`0x2f684e5d74e45d90d4d1d8f1c259a0ebef138400`](https://sepolia.etherscan.io/address/0x2f684e5d74e45d90d4d1d8f1c259a0ebef138400) |
| VulnerableVault (Sepolia, intentionally buggy) | [`0xac541f28d6f808fb134d981b96b340084575a399`](https://sepolia.etherscan.io/address/0xac541f28d6f808fb134d981b96b340084575a399) |
| PactumController (NEAR testnet) | [`ctrl-09d496de.rd-guardian-a-3ff0494a5d.testnet`](https://testnet.nearblocks.io/address/ctrl-09d496de.rd-guardian-a-3ff0494a5d.testnet) |
| Controller address on EVM | [`0x6738DAbcf6D8bbCEdDCC94aDf4554c37A26dCCA1`](https://sepolia.etherscan.io/address/0x6738DAbcf6D8bbCEdDCC94aDf4554c37A26dCCA1) |
| The one transaction | [reward and refund split](https://sepolia.etherscan.io/tx/0x58075756986e46439840b129da5c3040a6dbde081b0e73a8240f6c5c05a328f7) |
| Chain Signatures approval | [`9tXZTd7i…`](https://testnet.nearblocks.io/txns/9tXZTd7irPuGTeD24Bg3TBuS7mS6Up3t7agDJ2XxkSXg) |
| Video and X post | Not published yet |
| Hosted demo | Not published yet |

Every transaction is listed in [`deployments/sepolia.json`](deployments/sepolia.json).

## Try it in 2 minutes

You need `git`, `make`, [Foundry](https://getfoundry.sh), Rust, Node.js 22 or newer and network access. No wallet and no keys.

```text
make setup        → installs submodules and npm packages
make demo-local   → log contains: stolen 1,000,000; reward 100,000; refund pool 900,000; claimed 900,000
make verify       → reads the existing testnet transactions, prints 22 checks marked PASS and a PASS summary
```

In a clean-room run on a machine with cached Rust crates, these three took about a minute. Warnings from `npm ci` do not stop the setup.

Then, if you want more:

```text
make test         → all tests pass: 72 in Foundry, 21 in Rust. Took 3 to 5 minutes, mostly compiling Rust
make scenarios    → 19 simulated situations on Anvil with real transactions and time travel, all marked PASS
make intents-quote → prints a live NEAR Intents quote, no wallet and nothing is swapped
make web-local    → serves http://localhost:5173 with 5 fictional hacks across 8 mock assets. Pick a test account, then write an offer, return funds or claim
```

`make web-local` uses ports 5173 and 8546 and runs until you press Ctrl-C.

`make demo-local`, `make scenarios` and `make web-local` run on Anvil with a **simulated** controller: a local test key replaces NEAR. Only `make demo-testnet` and `make verify` involve Chain Signatures.

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
PactumController on NEAR testnet
      │ hashes the approved terms, requests a signature
      ▼
Chain Signatures (v1.signer-prod.testnet)
      │ EIP-712 signature, stored on NEAR for anyone to read
      ▼
Anyone relays it to Sepolia (the relayer needs no trust)
      ▼
Pactum on Sepolia
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

Properties enforced by [`Pactum.sol`](contracts/src/Pactum.sol):

- The reward and the refund booking happen in the same transaction.
- No reward fund is needed: the reward comes out of the returned money.
- The reward falls over time and `returnFunds` reverts after the last tier.
- Terms cannot change after `openCase`.
- There is no owner, no upgrade path and no withdraw function. Tokens leave only through `returnFunds` and `claimRefund`.

## Who can return and who can claim

Two questions come up first when trying the app.

**How does a hacker prove they are the hacker after mixers and many wallets?** They do not have to. The contract never asks who took the funds. Tokens are interchangeable, so it only counts what arrives. A wallet with no visible link to the hack can return the funds, and the reward can go to any other wallet. A test and a scenario run exactly this: funds moved through several wallets are returned from an unrelated one.

This does not open a way to take money. `returnFunds` pulls only the caller's own tokens, and the most that comes back is the published reward, so someone sending in 100 at a 10% reward loses 90. The interface blocks a wallet that holds none of the token.

**The real limit is the chain.** A case accepts one token on one chain, so funds that were swapped or bridged away must be swapped or bridged back first.

**Is any identity needed?** No sign-up and no identity check. The reward wallet is optional and defaults to the sending wallet. Entering a wallet in the interface is optional too. It is a read-only view, is not saved, and is only used to read public data.

**Who decides the terms?** The protocol owner writes an offer: how much the holder keeps, the deadlines and any special conditions. In the real flow, guardians must approve it on NEAR before anything is signed. Once published, the offer cannot be lowered, even by its author.

The percentage and the deadlines can be any custom value within the limits. The controller rejects more than 20%, and deadlines go up to 365 days. A case also has a reward cap per asset, so the payout can be lower than the percentage suggests. The interface says so when the cap applied.

"The hacker keeps 20% and returns 80%" is a 20% reward. The holder sends everything to the contract and gets 20% back in the same transaction, which gives the same result but nobody has to go first.

Special conditions are free text. They are hashed into the signed terms through `evidenceHash`, so anyone can check they were not changed. **The contract does not enforce them**, only the reward, deadlines and refunds.

**Why can the contract accept a claim from anyone?** A claim must carry a Merkle proof that the wallet and amount are on the list fixed when the case opened, and the tokens go only to that listed wallet. Letting someone else submit the transaction helps a user with no gas. The interface shows the claim button only to the listed wallet, and a test confirms that a claim sent by a stranger pays only the listed user.

## Assets

`Pactum` works with any ERC-20 on its own chain, in the token's smallest unit, so decimals do not change the formulas. The demo uses mock tokens: mBTC (8 decimals), mETH and mHYPE (18), mADA and mUSDC (6). `rewardCap` is a token amount, so no price oracle is needed.

- **Mock tokens are not the real assets.** They are ERC-20 stand-ins with no value.
- **Native assets are not supported.** Native BTC and ADA have no such contract on this chain, and native ETH would first need wrapping. Real use needs a wrapped ERC-20 of the asset on the chain where `Pactum` runs.
- **One case per token.** The interface groups them into one hack, but the contract keeps one case for each token. Opening, returning and claiming all take one transaction per token.

## How NEAR is used

- **Chain Signatures: control without a private key.** `Pactum.controller` is an address derived from the NEAR contract account. Its signature comes from the MPC network, only when the contract asks. `make verify` checks the derivation and that the signature recovers to that address.
- **NEAR smart contract: public approval rules.** [`PactumController`](controller/src/lib.rs) holds the guardians, the 2-of-3 threshold and a global reward limit. It validates the terms and computes the EIP-712 digest itself. There is no function that signs an arbitrary payload, so only the digest of approved terms can ever be signed.
- **A contract account with no access keys.** After deployment every key of the controller account is deleted, and `make verify` confirms this. Nobody can change its code or act as it. The account was created as a sub-account to avoid the faucet limit, and [a parent has no control over its sub-accounts](https://docs.near.org/protocol/accounts-contracts/account-id).

- **NEAR Intents: refunds in the asset a user wants.** The refund page requests a live quote to swap a refund for an asset on another chain, such as BTC on Bitcoin. `make intents-quote` does the same from the terminal. These are real `dry` quotes at mainnet prices. **No swap runs**, because NEAR Intents has no testnet and the demo tokens are mocks. Real use would have to follow the 1Click terms, which require compliance screening from integrators.

Pactum deliberately does not route the holder's stolen funds through NEAR Intents. Public swaps can be matched between deposit and withdrawal, its SHIELD layer can delay flows linked to reported hacks, and its terms prohibit laundering. Hiding that trail is not a goal of this project.

The digest matches byte for byte across three independent implementations. viem generates [test vectors](contracts/test/vectors/case_terms.json), and both Solidity and Rust are tested against them. Across seven testnet runs, the MPC network signed in 8.7 to 11.7 seconds, measured from the final approval to the stored signature.

**Honest limit of this design.** On one chain, an EVM multisig could do most of this. What NEAR adds is keyless control separated from the team's own infrastructure, and one controller that could serve several EVM chains. The prototype runs on Sepolia only: **multi-chain is a design, not something built here**.

## Why not just SEAL Safe Harbor?

[SEAL Safe Harbor](https://frameworks.securityalliance.org/safe-harbor/overview) is the closest existing framework and proves that the industry accepts publishing reward terms in advance. Pactum is meant as an on-chain execution layer that complements it, not a replacement: **Safe Harbor states the terms, Pactum executes the split and the refunds.**

This comparison comes from reading the [SEAL repository](https://github.com/security-alliance/safe-harbor) at commit `78ba923` and its [on-chain adoption guide](https://frameworks.securityalliance.org/safe-harbor/on-chain-adoption-guide). Its Solana folder contains no program source at that commit, so this covers the EVM contracts only.

| | SEAL Safe Harbor | Pactum |
| --- | --- | --- |
| Moves tokens | No, `registry-contracts/src` only stores terms | Yes, receives and splits in one transaction |
| Where funds go | An Asset Recovery Address set by the protocol | A contract with no team withdrawal |
| Changing terms | The owner can call `setBountyTerms`, and SEAL's README warns whitehats to "assume protocols may act adversarially" | Impossible after `openCase` |
| Total cap with a kept reward | Rejected together: `Agreement__CannotSetBothAggregateBountyCapUsdAndRetainable` | Works, because the contract does the split |
| Who it serves | Eligible whitehats rescuing funds from an attack someone else started | Anyone holding the funds, including the original attacker |
| Legal protection | **Yes, SEAL is stronger here:** a legal agreement with a release of claims | **None**, only a payment commitment |
| Cap unit | USD | Token amount, so no price oracle is needed |

Someone holding the funds can also keep 10% and send the rest to the protocol without any contract. Pactum adds only three things to that: a commitment that cannot change, automatic refunds, and a team that cannot touch the money. We searched public sources and did not find a product with this exact mechanism, which does not prove that none exists.

## Limits and risks

- **A team can hack itself.** It could drain its own protocol and "return" the funds to collect the reward. `rewardCap`, several guardians and public evidence reduce this risk but do not remove it. This is the biggest weakness.
- **No immunity from prosecution.** The contract only commits to a payment.
- **Sanctions.** Paying a sanctioned party may be illegal. Real use needs legal advice and screening, and this prototype has neither.
- **Professional groups may not return funds.** The best fit is an independent hacker at a small or mid-sized protocol.
- **Remaining trust.** `refundRoot` must be correct, and the Chain Signatures MPC network must behave correctly. A wrong root can misallocate that case's refunds, but tests show it cannot pay more than the case's pool or reach another case's tokens.
- **It does not stop hacks.** It only improves the chance of getting money back.
- **Locked tokens.** Tokens sent to `Pactum` without `returnFunds`, a reward sent to the contract itself and rounding dust stay locked, because no withdrawal exists. Allocations that sum to less than the loss leave funds locked as well.
- **Token assumptions.** Fee-on-transfer tokens are tested. Tokens whose balances rebase downward are not supported.
- **NEAR binary provenance is partial.** `make verify` proves the deployed code matches [`deployments/pactum_controller.wasm`](deployments/pactum_controller.wasm), and `make verify-wasm` rebuilds that file from source. The rebuild matched byte for byte from another directory on the same machine, with Rust 1.97.1 and cargo-near 0.23.0. It has not been tested on another machine, and it is not a Docker reproducible build.
- **Not audited.**

## Tests

| Command | Measured result |
| --- | --- |
| `make test-evm` | 72 passed. Fuzz 1,000 runs, invariants 256 runs at depth 64 |
| `cd contracts && forge coverage` | `Pactum.sol`: 100% lines and 100% branches |
| `make mutants` | About 7 minutes. 45 of 45 bugs injected into a copy of `Pactum` were caught. 2 more changes do not alter behavior and are listed in the script |
| `make test-near` | 21 passed |
| `make scenarios` | 19 of 19 situations on Anvil, including time travel across reward tiers, assets with different decimals, funds moved through several wallets and a team hacking itself |
| `make test-ui` | Drives the app in Chromium through every role, offers, returns, refunds and phones. Needs `npx playwright install chromium` in `e2e/`, or `CHROMIUM_PATH` set |
| `make test-sandbox` | 7 passed: the real NEAR wasm in a local sandbox against a **mock** MPC signer. The first build took about 8 minutes |

Covered as the spec requires: wrong signature, reused signature, wrong chain, tier boundaries, partial returns, `rewardCap`, after the deadline, reentrancy, fee-on-transfer tokens, wrong Merkle proofs, double claims, refunds never exceeding funds, and on NEAR: below threshold, duplicate approval, stranger approval and invalid terms.

The mock signer exists to force failures the real MPC network will not produce on demand: a failed signature, a malformed response and too little gas. After each one the proposal stays recoverable, and anyone can retry signing the same digest. It proves nothing about real signatures. Those are checked by `make verify`, and Foundry also verifies two real MPC signatures from testnet.

"No withdraw function" is checked three ways: a test holds the complete list of allowed functions, `make verify` compares the bytecode on Sepolia with this source (excluding immutable values and the unexecuted metadata), and it calls `withdraw` from the controller address with an amount of 0, which would succeed if the function existed.

## Simulated, demo-only and intentionally broken parts

- `make demo-local`, `make scenarios` and `make web-local`: the controller is a local test key, not NEAR. The output says `SIMULATED`.
- `make test-sandbox`: the MPC signer is a mock that returns a fixed response. It lives in [`sandbox/mock-signer`](sandbox/mock-signer).
- `VulnerableVault`: intentionally vulnerable. `emergencyWithdraw` has no access control.
- `MockUSD` and `MockToken`: anyone can mint them, so they have no value.
- The test accounts in `make web-local` (Hacker, Hacker 2, Hacker 3, New wallet, Users, Protocol owner, Stranger) are demo wallets. On a real deployment nothing would label a wallet that moved funds as a hacker.
- The hacks in `make web-local` use fictional protocols (Quillon DEX, Kestrel Bridge, Tidewater Perps, Northgate Lending, Marlin Vaults), and their dollar values use made-up prices.
- The offer form publishes only in local mode, where a test key signs in place of the guardians. It is not connected to NEAR. On testnet, an offer goes through `make demo-testnet`, which uses real guardian approval but fixed terms.
- The text of an offer written in the form is kept in that browser, and only its hash is on-chain. A live version needs to publish the text somewhere public.
- The Discussion tab has no server. Comments marked Sample are written for the demo, and new comments are saved only in that browser, so nobody else sees them. A live version needs shared storage and moderation.
- "Hack tracker" in the interface lists real events with figures and links from public sources, as of 2026-11-06. None of those organizations uses Pactum. The "Would it fit?" column is this project's opinion.
- Users, attacker and reward wallets in the demo are test accounts controlled by the demo script.
- [`spike/chain-signatures`](spike/chain-signatures) is the first experiment that proved an MPC signature recovers correctly on the EVM. It is kept as evidence and is not part of the product.

## Repository

```text
contracts/    Solidity contracts and Foundry tests
controller/   NEAR contract in Rust
scripts/      demo, verify, scenarios, mutation tests and test vector generation
sandbox/      local NEAR sandbox tests and the mock MPC signer
web/          React app: landing page, cases, offers, returns, refunds, discussion, activity, hack tracker and FAQ
e2e/          interface tests in Chromium
deployments/  public addresses, transaction hashes and the deployed wasm of the testnet run
spike/        first Chain Signatures experiment, kept as evidence
```

Code comments are written in Vietnamese, the language of the author. Identifiers, logs and the interface are in English.

## Disclosure

All code in this repository was written during the hackathon window, from 2026-11-06. It reuses no earlier project and no template. Much of the code was written with an AI coding tool.

- **AI tools:** Claude Code.
- **Solidity:** [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) 5.6.1, [forge-std](https://github.com/foundry-rs/forge-std), [Foundry](https://getfoundry.sh).
- **NEAR:** [near-sdk](https://crates.io/crates/near-sdk) 5.30.1, [cargo-near](https://crates.io/crates/cargo-near) 0.23.0, [near-workspaces](https://crates.io/crates/near-workspaces) 0.24.0 for the sandbox tests, NEAR Chain Signatures through `v1.signer-prod.testnet`.
- **TypeScript:** [viem](https://viem.sh) 2.57.16, [near-api-js](https://www.npmjs.com/package/near-api-js) 7.4.0, [@openzeppelin/merkle-tree](https://www.npmjs.com/package/@openzeppelin/merkle-tree) 1.0.8, [@noble/curves](https://www.npmjs.com/package/@noble/curves) and [@noble/hashes](https://www.npmjs.com/package/@noble/hashes) 2.4.0, tsx, TypeScript.
- **Web:** React 19, Vite, Geist fonts from Google Fonts.
- **Testing the interface:** [Playwright](https://playwright.dev) 1.65.0.
- **Reference only:** the [near/mpc](https://github.com/near/mpc) source at the deployed commit, for the signing interface and key derivation.

## License

[MIT](LICENSE)
