// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Pactum} from "../src/Pactum.sol";
import {BaseTest} from "./Base.t.sol";
import {FeeOnTransferToken} from "./mocks/TestTokens.sol";

contract SplitFuzzTest is BaseTest {
    function testFuzz_rewardPlusRefundEqualsReceived(uint256 amount, uint16 bps, uint256 cap) public {
        amount = bound(amount, 1, ONE_MILLION);
        bps = uint16(bound(bps, 0, 10_000));
        cap = bound(cap, 0, ONE_MILLION);

        Pactum.CaseTerms memory t = _terms();
        t.rewardCap = cap;
        t.tiers = new Pactum.RewardTier[](1);
        t.tiers[0] = Pactum.RewardTier(uint64(block.timestamp + 1 days), bps);
        _open(t);

        _return(amount);

        Pactum.Case memory c = desk.getCase(CASE_ID);
        assertEq(c.totalReward + c.totalRefund, amount);
        assertEq(c.totalReturned, amount);
        assertLe(c.totalReward, cap);
        assertLe(c.totalReward, amount * bps / 10_000);
        assertEq(usd.balanceOf(rewardWallet), c.totalReward);
        assertEq(usd.balanceOf(address(desk)), c.totalRefund);
    }

    // Rounding down: even if everyone claims in full, the total never exceeds the net refund.
    function testFuzz_allClaimsNeverExceedRefund(uint256 returned, uint256 aliceAllocation, uint256 bobAllocation)
        public
    {
        returned = bound(returned, 1, ONE_MILLION);
        aliceAllocation = bound(aliceAllocation, 1, ONE_MILLION - 1);
        bobAllocation = ONE_MILLION - aliceAllocation;

        Pactum.CaseTerms memory t = _terms();
        t.refundRoot = _pair(_leaf(alice, aliceAllocation), _leaf(bob, bobAllocation));
        _open(t);
        _return(returned);

        bytes32[] memory proof = new bytes32[](1);
        Pactum.Case memory c = desk.getCase(CASE_ID);
        uint256 aliceExpected = aliceAllocation * c.totalRefund / ONE_MILLION;
        uint256 bobExpected = bobAllocation * c.totalRefund / ONE_MILLION;

        if (aliceExpected > 0) {
            proof[0] = _leaf(bob, bobAllocation);
            desk.claimRefund(CASE_ID, alice, aliceAllocation, proof);
        }
        if (bobExpected > 0) {
            proof[0] = _leaf(alice, aliceAllocation);
            desk.claimRefund(CASE_ID, bob, bobAllocation, proof);
        }

        c = desk.getCase(CASE_ID);
        assertEq(usd.balanceOf(alice), aliceExpected);
        assertEq(usd.balanceOf(bob), bobExpected);
        assertLe(c.totalClaimed, c.totalRefund);
        assertLe(c.totalRefund - c.totalClaimed, 1, "rounding dust above 1 wei");
    }
}

/// @notice Picks random valid actions on two cases sharing a token and one case using a fee-on-transfer token.
contract Handler is Test {
    Pactum public immutable desk;
    FeeOnTransferToken public immutable token;
    bytes32[] public caseIds;
    address[] public users;
    uint256[] public allocations;
    mapping(bytes32 caseId => bytes32[][]) private _proofs;

    address private constant REWARD_TO = address(0xBEEF);

    // The handler measures the actual total received itself, as an independent check on the contract's books.
    mapping(bytes32 caseId => uint256) public measuredReceived;

    constructor(Pactum desk_, FeeOnTransferToken token_, bytes32[] memory caseIds_, address[] memory users_, uint256[] memory allocations_, bytes32[][] memory proofs_) {
        desk = desk_;
        token = token_;
        caseIds = caseIds_;
        users = users_;
        allocations = allocations_;
        for (uint256 i = 0; i < caseIds_.length; ++i) {
            for (uint256 j = 0; j < proofs_.length; ++j) {
                _proofs[caseIds_[i]].push(proofs_[j]);
            }
        }
        token.approve(address(desk), type(uint256).max);
    }

    function returnFunds(uint256 caseSeed, uint256 amount) external {
        bytes32 caseId = caseIds[caseSeed % caseIds.length];
        amount = bound(amount, 1, 200_000e18);
        token.mint(address(this), amount);
        uint256 returnedBefore = desk.getCase(caseId).totalReturned;
        desk.returnFunds(caseId, amount, REWARD_TO);
        measuredReceived[caseId] += desk.getCase(caseId).totalReturned - returnedBefore;
    }

    function claim(uint256 caseSeed, uint256 userSeed) external {
        bytes32 caseId = caseIds[caseSeed % caseIds.length];
        uint256 index = userSeed % users.length;
        desk.claimRefund(caseId, users[index], allocations[index], _proofs[caseId][index]);
    }

    function warp(uint256 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 0, 12 hours));
    }

    function caseCount() external view returns (uint256) {
        return caseIds.length;
    }
}

contract PactumInvariantTest is BaseTest {
    Handler private handler;
    FeeOnTransferToken private token;
    bytes32 private caseA = keccak256("case A");
    bytes32 private caseB = keccak256("case B");

    function setUp() public override {
        super.setUp();
        token = new FeeOnTransferToken(100);

        Pactum.CaseTerms memory t = _terms();
        t.token = address(token);
        t.caseId = caseA;
        t.rewardCap = 60_000e18;
        _open(t);

        t = _terms();
        t.token = address(token);
        t.caseId = caseB;
        t.nonce = 2;
        t.maxReturn = 300_000e18;
        _open(t);

        bytes32[] memory caseIds = new bytes32[](2);
        caseIds[0] = caseA;
        caseIds[1] = caseB;
        address[] memory users = new address[](3);
        users[0] = alice;
        users[1] = bob;
        users[2] = carol;
        uint256[] memory allocations = new uint256[](3);
        allocations[0] = ALICE_ALLOCATION;
        allocations[1] = BOB_ALLOCATION;
        allocations[2] = CAROL_ALLOCATION;
        bytes32[][] memory proofs = new bytes32[][](3);
        proofs[0] = _aliceProof();
        proofs[1] = _bobProof();
        proofs[2] = _carolProof();

        handler = new Handler(desk, token, caseIds, users, allocations, proofs);
        targetContract(address(handler));
    }

    function _caseAt(uint256 index) private view returns (bytes32 caseId, Pactum.Case memory c) {
        caseId = index == 0 ? caseA : caseB;
        c = desk.getCase(caseId);
    }

    function invariant_rewardPlusRefundEqualsReceived() public view {
        for (uint256 i = 0; i < 2; ++i) {
            (bytes32 caseId, Pactum.Case memory c) = _caseAt(i);
            assertEq(c.totalReward + c.totalRefund, c.totalReturned);
            assertEq(c.totalReturned, handler.measuredReceived(caseId));
        }
    }

    function invariant_balanceCoversAllUnclaimedRefunds() public view {
        (, Pactum.Case memory a) = _caseAt(0);
        (, Pactum.Case memory b) = _caseAt(1);
        uint256 unclaimed = (a.totalRefund - a.totalClaimed) + (b.totalRefund - b.totalClaimed);
        assertEq(token.balanceOf(address(desk)), unclaimed);
    }

    function invariant_limitsHold() public view {
        for (uint256 i = 0; i < 2; ++i) {
            (, Pactum.Case memory c) = _caseAt(i);
            assertLe(c.totalReward, c.rewardCap);
            assertLe(c.totalReturned, c.maxReturn);
            assertLe(c.totalClaimed, c.totalRefund);
        }
    }

    function invariant_claimedSumMatchesTotal() public view {
        for (uint256 i = 0; i < 2; ++i) {
            (bytes32 caseId, Pactum.Case memory c) = _caseAt(i);
            uint256 sum = desk.claimed(caseId, alice) + desk.claimed(caseId, bob) + desk.claimed(caseId, carol);
            assertEq(sum, c.totalClaimed);
        }
    }
}
