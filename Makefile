# Main project commands. See README.md for details.
.PHONY: pages registry-testnet refund-list test-refund-list setup test test-evm test-near test-sandbox test-ui scenarios mutants demo-local demo-testnet demo-stage faucet verify verify-wasm intents-quote build-near vectors web-local clean

setup:
	git submodule update --init
	cd scripts && npm ci
	cd web && npm ci

test: test-evm test-near test-refund-list

test-evm:
	cd contracts && forge test

test-near:
	cd controller && cargo test
	cd registry && cargo test

# Runs the real wasm in a local NEAR sandbox against a MOCK MPC contract, to exercise MPC failure paths.
test-sandbox: build-near
	cd sandbox/mock-signer && cargo near build non-reproducible-wasm --no-abi
	cd sandbox/tests && cargo test -- --test-threads=2

# Simulated situations on Anvil with time travel. The controller is a test key.
scenarios:
	cd contracts && forge build
	cd scripts && npx tsx scenarios.ts

# Drives the interface in Chromium on sample data. Needs network access for NEAR Intents quotes.
test-ui:
	bash e2e/run.sh

# Injects bugs into a copy of Pactum to test the Foundry suite itself.
mutants:
	python3 scripts/mutants.py

# Regenerates the hash vectors with viem. Foundry and Rust both read this file.
vectors:
	cd scripts && npx tsx gen-vectors.ts

# Runs the whole flow on Anvil with a SIMULATED controller. No wallet or NEAR needed.
demo-local:
	cd contracts && forge build
	cd scripts && npx tsx demo.ts --mode local

build-near:
	cd controller && cargo near build non-reproducible-wasm --no-abi
	cd registry && cargo near build non-reproducible-wasm --no-abi

# Runs for real on Sepolia and NEAR testnet. Needs a wallet with Sepolia ETH in .env.
demo-testnet: build-near
	cd contracts && forge build
	cd scripts && npx tsx demo.ts --mode testnet

# Rebuilds the NEAR contracts from source and compares them with the deployed wasm. Needs cargo-near and the pinned toolchain.
verify-wasm: build-near
	cmp controller/target/near/pactum_controller.wasm deployments/pactum_controller.wasm
	cmp registry/target/near/pactum_registry.wasm deployments/pactum_registry.wasm
	@echo "PASS: rebuilt wasm is byte-identical to the files in deployments/"

# A new hack on testnet that stops on the main chain so the rest is clicked in the app. Reuses the existing controller, so it only costs gas.
demo-stage:
	cd contracts && forge build
	cd scripts && npx tsx demo.ts --mode testnet --stage

# Requests 5 testnet NEAR for an account, the same way as the NEAR faucet page. Example: make faucet ACCOUNT=abc.testnet
faucet:
	cd scripts && npx tsx faucet.ts $(ACCOUNT)

# Deploys the operator registry to NEAR testnet, stakes for the current controller and runs challenge drills. Run after demo-testnet.
registry-testnet: build-near
	cd scripts && npx tsx registry.ts

# Builds a refund list from a CSV or from token transfer history. See the top of scripts/refund-list.ts for arguments.
refund-list:
	cd scripts && npx tsx refund-list.ts $(ARGS)

test-refund-list:
	cd scripts && npx tsx --test refund-list.test.ts

# Re-reads the existing testnet transactions. No wallet needed.
verify:
	cd contracts && forge build
	cd scripts && npx tsx verify.ts

# Fetches a real NEAR Intents quote. No wallet, and nothing is transferred.
intents-quote:
	cd scripts && npx tsx intents-quote.ts

# The interface with several fictional hacks on Anvil and test accounts. No wallet needed.
web-local:
	cd contracts && forge build
	trap 'kill 0' EXIT; (cd scripts && npx tsx seed.ts) & (cd web && npm run dev)

clean:
	cd contracts && forge clean
	cd controller && cargo clean
	cd sandbox/mock-signer && cargo clean
	cd sandbox/tests && cargo clean

# Builds the GitHub Pages site in web/dist: a sandbox chain in the browser, and the real testnet case at ?live.
pages:
	bash web-sandbox/pages.sh
