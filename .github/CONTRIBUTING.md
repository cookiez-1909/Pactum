# Contributing to Pactum

Thanks for taking a look. Pactum is a hackathon prototype on testnets, so the most useful contributions are bug reports, test cases and questions about the design.

## Set up

You need `git`, `make`, [Foundry](https://getfoundry.sh), Rust, Node.js 22 or newer and network access. No wallet and no keys.

```bash
make setup
```

## Check your change

| Command | What it runs |
| --- | --- |
| `make test` | Foundry tests, NEAR contract unit tests and the refund list tests |
| `make test-sandbox` | The real NEAR wasm in a local sandbox, against a mock MPC contract |
| `make scenarios` | Time-travel scenarios on Anvil |
| `make test-ui` | The web app in Chromium on sample data |
| `make verify-wasm` | Rebuilds the NEAR contracts and compares them byte for byte with `deployments/` |
| `make verify` | Re-checks every claim in the README against public testnet data |

CI runs the first group on every push and pull request.

## Conventions

- Code, comments, logs and interface text are in English.
- Keep the README truthful. A number or claim in it must be something a command in this repo can reproduce.
- The deployed NEAR wasm embeds source line numbers. A comment-only edit in `controller/src` or `registry/src` must keep every line where it is, so `make verify-wasm` keeps passing. Any other change there means a rebuild and a new deployment.
- Never commit keys. Keys live in environment variables, and `.env` is ignored by git.
- Testnet only. Do not send real or stolen funds to any address in this repo.

## Reporting a problem

Open an issue with the command you ran, what you expected and what happened. For anything that could put funds at risk, follow [SECURITY.md](SECURITY.md) instead.
