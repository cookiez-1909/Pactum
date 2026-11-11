# Security policy

Pactum is a testnet prototype built at NEAR HACKATHON. It is **not audited** and must not hold real funds. There is no bug bounty.

## Scope

- `contracts/src`: the Pactum and PublicNotes Solidity contracts
- `controller/src`: the PactumController NEAR contract that signs through Chain Signatures
- `registry/src`: the PactumRegistry NEAR contract for operator stakes
- `web/` and `scripts/`, where a bug could mislead someone into sending funds to the wrong place

The demo tokens and `VulnerableVault` are broken on purpose. Bugs in them are expected and out of scope.

## Reporting a vulnerability

Please report privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability**. Include the affected file, the steps to reproduce and the impact you expect.

Please do not open a public issue for a vulnerability, and do not test against deployed contracts in a way that affects other people.
