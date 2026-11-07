// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title Pactum
/// @notice Whoever holds exploited funds returns them here. One transaction pays the published reward
///         and books the rest for users to claim against a Merkle allocation.
/// @dev Testnet prototype, not audited. No owner, not upgradeable, no withdraw function.
///      Tokens leave the contract only through `returnFunds` (reward) and `claimRefund` (refund).
///      A signed offer that is not yet open can be revoked by the controller with `revokeNonce`. Once a case is open, nobody can change it.
///      Tokens sent straight to the contract without `returnFunds` are not recorded and stay locked forever.
contract Pactum is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct RewardTier {
        uint64 until; // Reward rate that applies while block.timestamp <= until.
        uint16 rewardBps; // 1000 = 10%.
    }

    struct CaseTerms {
        bytes32 caseId;
        address token;
        uint256 totalLoss;
        uint256 maxReturn; // Most the case accepts.
        uint256 rewardCap; // Total reward cap for the case.
        bytes32 refundRoot; // Merkle root of (account, allocation).
        bytes32 evidenceHash;
        RewardTier[] tiers;
        uint256 nonce;
        uint256 chainId;
    }

    /// @dev A stored case. Terms never change after `openCase`; only the four running totals do.
    struct Case {
        address token;
        uint256 totalLoss;
        uint256 maxReturn;
        uint256 rewardCap;
        bytes32 refundRoot;
        bytes32 evidenceHash;
        uint256 totalReturned; // Tokens actually received.
        uint256 totalReward; // Paid to reward recipients.
        uint256 totalRefund; // Net refund reserved for users.
        uint256 totalClaimed; // Already claimed by users.
    }

    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_TIERS = 8;

    bytes32 public constant REWARD_TIER_TYPEHASH = keccak256("RewardTier(uint64 until,uint16 rewardBps)");
    bytes32 public constant CASE_TERMS_TYPEHASH = keccak256(
        "CaseTerms(bytes32 caseId,address token,uint256 totalLoss,uint256 maxReturn,uint256 rewardCap,"
        "bytes32 refundRoot,bytes32 evidenceHash,RewardTier[] tiers,uint256 nonce,uint256 chainId)"
        "RewardTier(uint64 until,uint16 rewardBps)"
    );

    /// @dev The EIP-712 domain binds the chain id and contract address, so a revocation signature cannot be reused elsewhere.
    bytes32 public constant REVOKE_NONCE_TYPEHASH = keccak256("RevokeNonce(uint256 nonce)");

    /// @notice Address derived from the NEAR account through Chain Signatures, fixed at deployment.
    address public immutable controller;

    mapping(bytes32 caseId => Case) private _cases;
    mapping(bytes32 caseId => RewardTier[]) private _tiers;
    mapping(uint256 nonce => bool) public nonceUsed;
    mapping(bytes32 caseId => mapping(address account => uint256)) public claimed;

    event CaseOpened(
        bytes32 indexed caseId, address indexed token, uint256 totalLoss, bytes32 refundRoot, bytes32 evidenceHash
    );
    event FundsReturned(
        bytes32 indexed caseId,
        address indexed from,
        address indexed rewardTo,
        uint256 received,
        uint256 reward,
        uint256 refund,
        uint16 rewardBps
    );
    event RefundClaimed(bytes32 indexed caseId, address indexed account, uint256 amount);
    event NonceRevoked(uint256 indexed nonce);

    error ZeroController();
    error WrongChain();
    error NonceUsed();
    error CaseExists();
    error CaseNotFound();
    error InvalidTerms();
    error InvalidSignature();
    error CaseClosed();
    error ZeroRewardAddress();
    error RewardToPactum();
    error RewardTooLow();
    error NothingToReturn();
    error InvalidProof();
    error NothingToClaim();

    constructor(address controller_) EIP712("Pactum", "1") {
        if (controller_ == address(0)) revert ZeroController();
        controller = controller_;
    }

    /// @notice Opens a case. Anyone can submit the signature, but only signed terms take effect.
    function openCase(CaseTerms calldata terms, bytes calldata controllerSig) external nonReentrant {
        if (terms.chainId != block.chainid) revert WrongChain();
        if (nonceUsed[terms.nonce]) revert NonceUsed();
        if (_cases[terms.caseId].token != address(0)) revert CaseExists();
        _validateTerms(terms);

        _requireControllerSig(hashCaseTerms(terms), controllerSig);

        nonceUsed[terms.nonce] = true;
        Case storage c = _cases[terms.caseId];
        c.token = terms.token;
        c.totalLoss = terms.totalLoss;
        c.maxReturn = terms.maxReturn;
        c.rewardCap = terms.rewardCap;
        c.refundRoot = terms.refundRoot;
        c.evidenceHash = terms.evidenceHash;
        RewardTier[] storage tiers = _tiers[terms.caseId];
        for (uint256 i = 0; i < terms.tiers.length; ++i) {
            tiers.push(terms.tiers[i]);
        }

        emit CaseOpened(terms.caseId, terms.token, terms.totalLoss, terms.refundRoot, terms.evidenceHash);
    }

    /// @notice Revokes a signed offer that is not yet open by burning its nonce, so the old signature can no longer open a case.
    /// @dev Anyone can submit the revocation signature, but the controller only signs one after the council votes to cancel on NEAR.
    ///      Once a case is open its nonce is spent, so this reverts: published terms cannot be withdrawn.
    function revokeNonce(uint256 nonce, bytes calldata controllerSig) external {
        if (nonceUsed[nonce]) revert NonceUsed();
        _requireControllerSig(hashRevokeNonce(nonce), controllerSig);
        nonceUsed[nonce] = true;
        emit NonceRevoked(nonce);
    }

    /// @notice Takes up to `amount` from the caller, pays the reward to `rewardTo` and books the rest for users.
    /// @dev Takes only what the case still accepts, so an oversized `amount` never takes too much.
    ///      The caller must approve the token for this contract first.
    ///      `minReward` guards against a reward lower than the caller saw: the transaction landing after a deadline,
    ///      or someone else returning first and using up the reward cap. If it is lower, no token leaves the caller's wallet.
    function returnFunds(bytes32 caseId, uint256 amount, address rewardTo, uint256 minReward) external nonReentrant {
        if (rewardTo == address(0)) revert ZeroRewardAddress();
        // A reward sent to this contract itself would belong to no ledger and stay locked forever.
        if (rewardTo == address(this)) revert RewardToPactum();
        Case storage c = _getCase(caseId);
        uint16 bps = _currentBps(caseId);

        uint256 accepted = Math.min(amount, c.maxReturn - c.totalReturned);
        if (accepted == 0) revert NothingToReturn();

        // Measures what was actually received from the balance change, so fee-on-transfer tokens cannot skew the books.
        IERC20 token = IERC20(c.token);
        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), accepted);
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert NothingToReturn();

        (uint256 reward, uint256 refund) = _split(c, received, bps);
        if (reward < minReward) revert RewardTooLow();
        c.totalReturned += received;
        c.totalReward += reward;
        c.totalRefund += refund;

        if (reward > 0) token.safeTransfer(rewardTo, reward);

        emit FundsReturned(caseId, msg.sender, rewardTo, received, reward, refund, bps);
    }

    /// @notice Sends the refund currently available to `account`. Anyone can call it; the money only goes to `account`.
    /// @dev Can be called again when more funds return: claimable = allocation * totalRefund / totalLoss.
    function claimRefund(bytes32 caseId, address account, uint256 allocation, bytes32[] calldata proof)
        external
        nonReentrant
    {
        Case storage c = _getCase(caseId);
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(account, allocation))));
        if (!MerkleProof.verifyCalldata(proof, c.refundRoot, leaf)) revert InvalidProof();

        uint256 amount = _claimable(c, caseId, account, allocation);
        if (amount == 0) revert NothingToClaim();

        claimed[caseId][account] += amount;
        c.totalClaimed += amount;

        IERC20(c.token).safeTransfer(account, amount);

        emit RefundClaimed(caseId, account, amount);
    }

    /// @notice How a return of `amount` would be split right now, assuming the token charges no transfer fee.
    /// @dev Reverts once the case is closed, like `returnFunds`.
    function quote(bytes32 caseId, uint256 amount) external view returns (uint256 reward, uint256 refund) {
        Case storage c = _getCase(caseId);
        uint16 bps = _currentBps(caseId);
        uint256 accepted = Math.min(amount, c.maxReturn - c.totalReturned);
        return _split(c, accepted, bps);
    }

    /// @notice What `account` can claim right now. This does not check the allocation against the Merkle root.
    function claimable(bytes32 caseId, address account, uint256 allocation) external view returns (uint256) {
        return _claimable(_getCase(caseId), caseId, account, allocation);
    }

    /// @notice The current reward tier. `open` is false after the last deadline.
    function currentTier(bytes32 caseId) external view returns (bool open, uint16 rewardBps, uint64 until) {
        _getCase(caseId);
        RewardTier[] storage tiers = _tiers[caseId];
        for (uint256 i = 0; i < tiers.length; ++i) {
            if (block.timestamp <= tiers[i].until) return (true, tiers[i].rewardBps, tiers[i].until);
        }
        return (false, 0, tiers[tiers.length - 1].until);
    }

    function getCase(bytes32 caseId) external view returns (Case memory) {
        return _getCase(caseId);
    }

    function getTiers(bytes32 caseId) external view returns (RewardTier[] memory) {
        _getCase(caseId);
        return _tiers[caseId];
    }

    /// @notice The EIP-712 hash the controller signs. The NEAR contract must produce exactly these bytes.
    function hashCaseTerms(CaseTerms calldata terms) public view returns (bytes32) {
        bytes32[] memory tierHashes = new bytes32[](terms.tiers.length);
        for (uint256 i = 0; i < terms.tiers.length; ++i) {
            tierHashes[i] = keccak256(abi.encode(REWARD_TIER_TYPEHASH, terms.tiers[i].until, terms.tiers[i].rewardBps));
        }
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CASE_TERMS_TYPEHASH,
                    terms.caseId,
                    terms.token,
                    terms.totalLoss,
                    terms.maxReturn,
                    terms.rewardCap,
                    terms.refundRoot,
                    terms.evidenceHash,
                    keccak256(abi.encodePacked(tierHashes)),
                    terms.nonce,
                    terms.chainId
                )
            )
        );
    }

    /// @notice The EIP-712 hash the controller signs to revoke a nonce.
    function hashRevokeNonce(uint256 nonce) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(REVOKE_NONCE_TYPEHASH, nonce)));
    }

    function _requireControllerSig(bytes32 digest, bytes calldata controllerSig) private view {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(digest, controllerSig);
        if (err != ECDSA.RecoverError.NoError || signer != controller) revert InvalidSignature();
    }

    function _validateTerms(CaseTerms calldata terms) private view {
        RewardTier[] calldata tiers = terms.tiers;
        if (
            terms.caseId == bytes32(0) || terms.token == address(0) || terms.totalLoss == 0 || terms.maxReturn == 0
            // Keeps each person's refund within their allocation.
            || terms.maxReturn > terms.totalLoss || terms.refundRoot == bytes32(0) || tiers.length == 0
                || tiers.length > MAX_TIERS || tiers[tiers.length - 1].until < block.timestamp || tiers[0].rewardBps > BPS
        ) revert InvalidTerms();

        // Deadlines increase and rewards decrease, so checking the BPS of the first tier is enough.
        for (uint256 i = 1; i < tiers.length; ++i) {
            if (tiers[i].until <= tiers[i - 1].until || tiers[i].rewardBps >= tiers[i - 1].rewardBps) {
                revert InvalidTerms();
            }
        }
    }

    function _getCase(bytes32 caseId) private view returns (Case storage c) {
        c = _cases[caseId];
        if (c.token == address(0)) revert CaseNotFound();
    }

    function _currentBps(bytes32 caseId) private view returns (uint16) {
        RewardTier[] storage tiers = _tiers[caseId];
        for (uint256 i = 0; i < tiers.length; ++i) {
            if (block.timestamp <= tiers[i].until) return tiers[i].rewardBps;
        }
        revert CaseClosed();
    }

    /// @dev reward = min(bps * amount / 10000, rewardCap - totalReward). Any excess goes to refunds.
    function _split(Case storage c, uint256 amount, uint16 bps) private view returns (uint256 reward, uint256 refund) {
        reward = Math.min(Math.mulDiv(amount, bps, BPS), c.rewardCap - c.totalReward);
        refund = amount - reward;
    }

    /// @dev Always bounded by the case's unclaimed pool, so a wrong root cannot reach another case's money.
    function _claimable(Case storage c, bytes32 caseId, address account, uint256 allocation)
        private
        view
        returns (uint256)
    {
        uint256 entitled = Math.mulDiv(allocation, c.totalRefund, c.totalLoss);
        uint256 alreadyClaimed = claimed[caseId][account];
        if (entitled <= alreadyClaimed) return 0;
        return Math.min(entitled - alreadyClaimed, c.totalRefund - c.totalClaimed);
    }
}
