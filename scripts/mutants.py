#!/usr/bin/env python3
# Mutation testing: injects one bug at a time into a COPY of Pactum and checks whether the Foundry tests catch it.
# If a deliberately broken contract still passes, the tests are not good enough there.
# Runs one mutant at a time to save memory. Never touches the real contracts/.
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "contracts")

# Not real bugs: the code changes but the behavior does not, so no test can catch them.
EQUIVALENT = {
    # On error tryRecover returns address(0), and the constructor rejects a zero controller.
    "recover error ignored",
    # With no tokens moved, received is also 0 and it reverts with the same NothingToReturn error.
    "zero accepted allowed",
}

MUTANTS = [
    ("no chainId check", "if (terms.chainId != block.chainid) revert WrongChain();", ""),
    ("no nonce replay check", "if (nonceUsed[terms.nonce]) revert NonceUsed();", ""),
    ("nonce never marked used", "nonceUsed[terms.nonce] = true;", ""),
    ("existing case can be overwritten", "if (_cases[terms.caseId].token != address(0)) revert CaseExists();", ""),
    ("no signature check", "if (err != ECDSA.RecoverError.NoError || signer != controller) revert InvalidSignature();", ""),
    ("any signer accepted", "signer != controller", "signer == address(0)"),
    ("recover error ignored", "err != ECDSA.RecoverError.NoError || ", ""),
    ("zero rewardTo allowed", "if (rewardTo == address(0)) revert ZeroRewardAddress();", ""),
    ("trusts amount instead of received", "uint256 received = token.balanceOf(address(this)) - balanceBefore;", "uint256 received = accepted; balanceBefore;"),
    ("zero received allowed", "if (received == 0) revert NothingToReturn();", ""),
    ("zero accepted allowed", "if (accepted == 0) revert NothingToReturn();", ""),
    ("maxReturn ignored in returnFunds", "uint256 accepted = Math.min(amount, c.maxReturn - c.totalReturned);\n        if (accepted == 0)", "uint256 accepted = amount;\n        if (accepted == 0)"),
    ("maxReturn ignored in quote", "uint256 accepted = Math.min(amount, c.maxReturn - c.totalReturned);\n        return _split", "uint256 accepted = amount;\n        return _split"),
    ("totalReturned not updated", "c.totalReturned += received;", ""),
    ("totalReward not updated", "c.totalReward += reward;", ""),
    ("totalRefund not updated", "c.totalRefund += refund;", ""),
    ("reward not paid", "if (reward > 0) token.safeTransfer(rewardTo, reward);", ""),
    ("reward paid to msg.sender", "token.safeTransfer(rewardTo, reward)", "token.safeTransfer(msg.sender, reward)"),
    ("no Merkle proof check", "if (!MerkleProof.verifyCalldata(proof, c.refundRoot, leaf)) revert InvalidProof();", ""),
    ("claim of zero allowed", "if (amount == 0) revert NothingToClaim();", ""),
    ("user claimed not updated", "claimed[caseId][account] += amount;", ""),
    ("totalClaimed not updated", "c.totalClaimed += amount;", ""),
    ("refund paid to msg.sender", "IERC20(c.token).safeTransfer(account, amount);", "IERC20(c.token).safeTransfer(msg.sender, amount);"),
    ("reward cap ignored", "Math.min(Math.mulDiv(amount, bps, BPS), c.rewardCap - c.totalReward)", "Math.mulDiv(amount, bps, BPS)"),
    ("tier deadline exclusive", "if (block.timestamp <= tiers[i].until) return tiers[i].rewardBps;", "if (block.timestamp < tiers[i].until) return tiers[i].rewardBps;"),
    ("open after last tier", "revert CaseClosed();", "return tiers[tiers.length - 1].rewardBps;"),
    ("currentTier deadline exclusive", "if (block.timestamp <= tiers[i].until) return (true,", "if (block.timestamp < tiers[i].until) return (true,"),
    ("claim not limited by pool", "return Math.min(entitled - alreadyClaimed, c.totalRefund - c.totalClaimed);", "return entitled - alreadyClaimed;"),
    ("no nonReentrant on returnFunds", "function returnFunds(bytes32 caseId, uint256 amount, address rewardTo) external nonReentrant {", "function returnFunds(bytes32 caseId, uint256 amount, address rewardTo) external {"),
    ("no nonReentrant on claimRefund", "        external\n        nonReentrant\n    {\n        Case storage c = _getCase(caseId);\n        bytes32 leaf", "        external\n    {\n        Case storage c = _getCase(caseId);\n        bytes32 leaf"),
    ("no nonReentrant on openCase", "function openCase(CaseTerms calldata terms, bytes calldata controllerSig) external nonReentrant {", "function openCase(CaseTerms calldata terms, bytes calldata controllerSig) external {"),
    ("maxReturn above totalLoss allowed", "|| terms.maxReturn > terms.totalLoss ", ""),
    ("zero caseId allowed", "terms.caseId == bytes32(0) || ", ""),
    ("zero refundRoot allowed", "|| terms.refundRoot == bytes32(0) ", ""),
    ("too many tiers allowed", "|| tiers.length > MAX_TIERS ", ""),
    ("expired terms allowed", " || tiers[tiers.length - 1].until < block.timestamp", ""),
    ("tier order not checked", "tiers[i].until <= tiers[i - 1].until || ", ""),
    ("falling reward not checked", " || tiers[i].rewardBps >= tiers[i - 1].rewardBps", ""),
    ("reward above 100% allowed", " || tiers[0].rewardBps > BPS", ""),
    ("wrong tier typehash", 'keccak256("RewardTier(uint64 until,uint16 rewardBps)")', 'keccak256("RewardTier(uint64 until,uint32 rewardBps)")'),
    ("wrong domain version", 'EIP712("Pactum", "1")', 'EIP712("Pactum", "2")'),
    ("nonce left out of the hash", "terms.nonce,\n                    terms.chainId", "uint256(0),\n                    terms.chainId"),
    ("evidence left out of the hash", "terms.evidenceHash,\n                    keccak256", "bytes32(0),\n                    keccak256"),
    ("controller withdraw function added", "function getCase(bytes32 caseId) external view", "function withdraw(address token, uint256 amount) external { require(msg.sender == controller); IERC20(token).safeTransfer(controller, amount); }\n\n    function getCase(bytes32 caseId) external view"),
    ("public sweep function added", "function getCase(bytes32 caseId) external view", "function sweep(address token) external { IERC20(token).safeTransfer(msg.sender, IERC20(token).balanceOf(address(this))); }\n\n    function getCase(bytes32 caseId) external view"),
    ("terms setter added", "function getCase(bytes32 caseId) external view", "function setRewardCap(bytes32 caseId, uint256 cap) external { require(msg.sender == controller); _cases[caseId].rewardCap = cap; }\n\n    function getCase(bytes32 caseId) external view"),
    ("payable function added", "function getCase(bytes32 caseId) external view", "function donate() external payable {}\n\n    function getCase(bytes32 caseId) external view"),
]


def main() -> int:
    work = tempfile.mkdtemp(prefix="pactum-mutants-")
    copy = os.path.join(work, "contracts")
    shutil.copytree(SRC, copy, ignore=shutil.ignore_patterns("out", "cache", "lib"))
    os.symlink(os.path.join(SRC, "lib"), os.path.join(copy, "lib"))
    path = os.path.join(copy, "src/Pactum.sol")
    original = open(path).read()
    env = dict(os.environ, FOUNDRY_FUZZ_RUNS="100", FOUNDRY_INVARIANT_RUNS="32", FOUNDRY_INVARIANT_DEPTH="32")

    not_killed = []
    # Run only the mutants whose name contains a string: python3 scripts/mutants.py payable
    selected = [item for item in MUTANTS if len(sys.argv) < 2 or sys.argv[1] in item[0]]
    for name, old, new in selected:
        count = original.count(old)
        if count != 1:
            print(f"SKIPPED  {name}: pattern found {count} times", flush=True)
            not_killed.append(f"{name} (not applied)")
            continue
        open(path, "w").write(original.replace(old, new))
        result = subprocess.run(["forge", "test"], cwd=copy, env=env, capture_output=True, text=True)
        output = result.stdout + result.stderr
        if "Compiler run failed" in output:
            print(f"NOBUILD  {name}", flush=True)
            not_killed.append(f"{name} (did not compile)")
        elif result.returncode != 0:
            failing = len({line for line in output.splitlines() if line.startswith("[FAIL")})
            print(f"KILLED   {name} ({failing} tests failed)", flush=True)
        else:
            if name in EQUIVALENT:
                print(f"EQUIV    {name} (survives by design, see EQUIVALENT)", flush=True)
            else:
                print(f"SURVIVED {name}", flush=True)
                not_killed.append(name)

    shutil.rmtree(work)
    real = len([item for item in selected if item[0] not in EQUIVALENT])
    print(f"\n{real - len(not_killed)} of {real} mutants killed, plus {len(selected) - real} equivalent")
    for name in not_killed:
        print(f"  not killed: {name}")
    return 1 if not_killed else 0


sys.exit(main())
