// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ReturnDesk} from "../src/ReturnDesk.sol";
import {MockUSD} from "../src/demo/MockUSD.sol";

/// @notice Shared data and helpers for the tests.
abstract contract BaseTest is Test {
    uint256 internal constant ONE_MILLION = 1_000_000e18;

    ReturnDesk internal desk;
    MockUSD internal usd;

    address internal controller;
    uint256 internal controllerKey;

    address internal hacker = makeAddr("hacker");
    address internal rewardWallet = makeAddr("rewardWallet");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant ALICE_ALLOCATION = 600_000e18;
    uint256 internal constant BOB_ALLOCATION = 300_000e18;
    uint256 internal constant CAROL_ALLOCATION = 100_000e18;

    bytes32 internal constant CASE_ID = keccak256("case-1");
    bytes32 internal constant EVIDENCE = keccak256("evidence");

    uint64 internal tier1Until;
    uint64 internal tier2Until;
    uint64 internal tier3Until;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        (controller, controllerKey) = makeAddrAndKey("controller");
        desk = new ReturnDesk(controller);
        usd = new MockUSD();
        usd.mint(hacker, ONE_MILLION);
        vm.prank(hacker);
        usd.approve(address(desk), type(uint256).max);
        tier1Until = uint64(block.timestamp + 1 days);
        tier2Until = uint64(block.timestamp + 3 days);
        tier3Until = uint64(block.timestamp + 7 days);
    }

    // Merkle leaf in OpenZeppelin's format (double hash, sorted pairs).
    function _leaf(address account, uint256 allocation) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(account, allocation))));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function _root() internal view returns (bytes32) {
        return _pair(_pair(_leaf(alice, ALICE_ALLOCATION), _leaf(bob, BOB_ALLOCATION)), _leaf(carol, CAROL_ALLOCATION));
    }

    function _aliceProof() internal view returns (bytes32[] memory proof) {
        proof = new bytes32[](2);
        proof[0] = _leaf(bob, BOB_ALLOCATION);
        proof[1] = _leaf(carol, CAROL_ALLOCATION);
    }

    function _bobProof() internal view returns (bytes32[] memory proof) {
        proof = new bytes32[](2);
        proof[0] = _leaf(alice, ALICE_ALLOCATION);
        proof[1] = _leaf(carol, CAROL_ALLOCATION);
    }

    function _carolProof() internal view returns (bytes32[] memory proof) {
        proof = new bytes32[](1);
        proof[0] = _pair(_leaf(alice, ALICE_ALLOCATION), _leaf(bob, BOB_ALLOCATION));
    }

    // Default terms: 15% for 1 day, 10% until day 3, 5% until day 7.
    function _terms() internal view returns (ReturnDesk.CaseTerms memory t) {
        t.caseId = CASE_ID;
        t.token = address(usd);
        t.totalLoss = ONE_MILLION;
        t.maxReturn = ONE_MILLION;
        t.rewardCap = 200_000e18;
        t.refundRoot = _root();
        t.evidenceHash = EVIDENCE;
        t.tiers = new ReturnDesk.RewardTier[](3);
        t.tiers[0] = ReturnDesk.RewardTier(tier1Until, 1500);
        t.tiers[1] = ReturnDesk.RewardTier(tier2Until, 1000);
        t.tiers[2] = ReturnDesk.RewardTier(tier3Until, 500);
        t.nonce = 1;
        t.chainId = block.chainid;
    }

    function _sign(ReturnDesk target, ReturnDesk.CaseTerms memory t, uint256 key) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, target.hashCaseTerms(t));
        return abi.encodePacked(r, s, v);
    }

    function _open(ReturnDesk.CaseTerms memory t) internal {
        desk.openCase(t, _sign(desk, t, controllerKey));
    }

    function _openDefault() internal {
        _open(_terms());
    }

    function _return(uint256 amount) internal {
        vm.prank(hacker);
        desk.returnFunds(CASE_ID, amount, rewardWallet);
    }
}
