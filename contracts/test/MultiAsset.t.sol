// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Pactum} from "../src/Pactum.sol";
import {MockToken} from "../src/demo/MockToken.sol";
import {BaseTest} from "./Base.t.sol";

/// @notice Pactum counts in the token's smallest unit, so it must be right for any number of decimals.
contract MultiAssetTest is BaseTest {
    struct Asset {
        string symbol;
        uint8 decimals;
        uint256 wholeLoss;
    }

    function _runFullFlow(Asset memory asset, uint256 nonce) private {
        MockToken token = new MockToken(asset.symbol, asset.symbol, asset.decimals);
        assertEq(token.decimals(), asset.decimals);
        uint256 unit = 10 ** asset.decimals;
        uint256 loss = asset.wholeLoss * unit;

        // Allocations of 60%, 30% and 10% in this asset's own tokens.
        uint256 aliceAllocation = loss * 60 / 100;
        uint256 bobAllocation = loss * 30 / 100;
        uint256 carolAllocation = loss - aliceAllocation - bobAllocation;
        bytes32 root =
            _pair(_pair(_leaf(alice, aliceAllocation), _leaf(bob, bobAllocation)), _leaf(carol, carolAllocation));

        Pactum.CaseTerms memory t = _terms();
        t.caseId = keccak256(abi.encode(asset.symbol));
        t.token = address(token);
        t.totalLoss = loss;
        t.maxReturn = loss;
        t.rewardCap = loss;
        t.refundRoot = root;
        t.nonce = nonce;
        t.tiers = new Pactum.RewardTier[](1);
        t.tiers[0] = Pactum.RewardTier(uint64(block.timestamp + 1 days), 1000);
        _open(t);

        token.mint(hacker, loss);
        vm.startPrank(hacker);
        token.approve(address(desk), loss);
        desk.returnFunds(t.caseId, loss, rewardWallet);
        vm.stopPrank();

        assertEq(token.balanceOf(rewardWallet), loss / 10, "reward is 10% in token units");
        assertEq(token.balanceOf(address(desk)), loss - loss / 10, "refund pool");

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = _leaf(bob, bobAllocation);
        proof[1] = _leaf(carol, carolAllocation);
        desk.claimRefund(t.caseId, alice, aliceAllocation, proof);
        proof[0] = _leaf(alice, aliceAllocation);
        desk.claimRefund(t.caseId, bob, bobAllocation, proof);
        bytes32[] memory carolProof = new bytes32[](1);
        carolProof[0] = _pair(_leaf(alice, aliceAllocation), _leaf(bob, bobAllocation));
        desk.claimRefund(t.caseId, carol, carolAllocation, carolProof);

        assertEq(token.balanceOf(alice), aliceAllocation * 9 / 10);
        assertEq(token.balanceOf(bob), bobAllocation * 9 / 10);
        assertEq(token.balanceOf(carol), carolAllocation * 9 / 10);
        assertEq(token.balanceOf(address(desk)), 0, "fully paid out");
    }

    function test_btcWithEightDecimals() public {
        _runFullFlow(Asset("mBTC", 8, 125), 11);
    }

    function test_adaWithSixDecimals() public {
        _runFullFlow(Asset("mADA", 6, 14_000_000), 12);
    }

    function test_ethAndHypeWithEighteenDecimals() public {
        _runFullFlow(Asset("mETH", 18, 3200), 13);
        _runFullFlow(Asset("mHYPE", 18, 850_000), 14);
    }

    // Several cases with different tokens on one contract keep separate books.
    function test_casesWithDifferentAssetsStaySeparate() public {
        _runFullFlow(Asset("mBTC", 8, 125), 21);
        _runFullFlow(Asset("mADA", 6, 14_000_000), 22);
        assertEq(desk.getCase(keccak256(abi.encode("mBTC"))).totalReturned, 125e8);
        assertEq(desk.getCase(keccak256(abi.encode("mADA"))).totalReturned, 14_000_000e6);
    }

    // With 6 decimals, rounding dust still cannot exceed the net refund.
    function testFuzz_lowDecimalsNeverOverpay(uint96 rawLoss, uint16 bps, uint8 decimalsSeed) public {
        uint8 tokenDecimals = uint8(bound(decimalsSeed, 0, 18));
        uint256 loss = bound(rawLoss, 3, type(uint96).max);
        bps = uint16(bound(bps, 0, 10_000));
        MockToken token = new MockToken("Mock", "MOCK", tokenDecimals);

        uint256 aliceAllocation = loss / 3;
        uint256 bobAllocation = loss - aliceAllocation;
        Pactum.CaseTerms memory t = _terms();
        t.token = address(token);
        t.totalLoss = loss;
        t.maxReturn = loss;
        t.rewardCap = loss;
        t.refundRoot = _pair(_leaf(alice, aliceAllocation), _leaf(bob, bobAllocation));
        t.tiers = new Pactum.RewardTier[](1);
        t.tiers[0] = Pactum.RewardTier(uint64(block.timestamp + 1 days), bps);
        _open(t);

        token.mint(hacker, loss);
        vm.startPrank(hacker);
        token.approve(address(desk), loss);
        desk.returnFunds(CASE_ID, loss, rewardWallet);
        vm.stopPrank();

        Pactum.Case memory c = desk.getCase(CASE_ID);
        assertEq(c.totalReward + c.totalRefund, loss);
        uint256 aliceCan = desk.claimable(CASE_ID, alice, aliceAllocation);
        uint256 bobCan = desk.claimable(CASE_ID, bob, bobAllocation);
        assertLe(aliceCan + bobCan, c.totalRefund);
        assertLe(c.totalRefund - aliceCan - bobCan, 1, "rounding dust above 1 unit");
    }
}
