# Main project commands. See README.md for details.
.PHONY: setup test test-evm test-near test-sandbox scenarios mutants demo-local demo-testnet verify verify-wasm build-near vectors web-local clean

setup:
	git submodule update --init
	cd scripts && npm ci
	cd web && npm ci

test: test-evm test-near

test-evm:
	cd contracts && forge test

test-near:
	cd controller && cargo test

# Runs the real wasm in a local NEAR sandbox against a MOCK MPC contract, to exercise MPC failure paths.
test-sandbox: build-near
	cd sandbox/mock-signer && cargo near build non-reproducible-wasm --no-abi
	cd sandbox/tests && cargo test --test flow -- --test-threads=2

# Simulated situations on Anvil with time travel. The controller is a test key.
scenarios:
	cd contracts && forge build
	cd scripts && npx tsx scenarios.ts

# Plants bugs in a copy of ReturnDesk to test the Foundry test suite itself.
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

# Runs for real on Sepolia and NEAR testnet. Needs a wallet with Sepolia ETH in .env.
demo-testnet: build-near
	cd contracts && forge build
	cd scripts && npx tsx demo.ts --mode testnet

# Rebuilds the NEAR contracts from source and compares them with the deployed wasm. Needs cargo-near and the pinned toolchain.
verify-wasm: build-near
	cmp controller/target/near/return_desk_controller.wasm deployments/return_desk_controller.wasm
	@echo "PASS: rebuilt wasm is byte-identical to deployments/return_desk_controller.wasm"

# Re-reads the existing testnet transactions. No wallet needed.
verify:
	cd contracts && forge build
	cd scripts && npx tsx verify.ts

# The interface with Anvil and test accounts, clicking return and refund by itself, with no wallet.
web-local:
	cd contracts && forge build
	trap 'kill 0' EXIT; (cd scripts && npx tsx demo.ts --mode local --stage) & (cd web && npm run dev)

clean:
	cd contracts && forge clean
	cd controller && cargo clean
	cd sandbox/mock-signer && cargo clean
	cd sandbox/tests && cargo clean
