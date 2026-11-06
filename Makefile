# Main project commands. See README.md for details.
.PHONY: setup test test-evm test-near demo-local demo-testnet verify build-near vectors web-local clean

setup:
	git submodule update --init --recursive
	cd scripts && npm ci
	cd web && npm ci

test: test-evm test-near

test-evm:
	cd contracts && forge test

test-near:
	cd controller && cargo test

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
