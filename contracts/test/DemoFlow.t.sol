// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Pactum} from "../src/Pactum.sol";
import {VulnerableVault} from "../src/demo/VulnerableVault.sol";
import {BaseTest} from "./Base.t.sol";

/// @notice The full demo scenario from section 9: hack, open a case, return, refund.
contract DemoFlowTest is BaseTest {
    function test_hackReturnRefund() public {
        // Do not use the hacker's existing balance from BaseTest.
        vm.prank(hacker);
        usd.transfer(address(0xdead), ONE_MILLION);

        VulnerableVault vault = new VulnerableVault(usd);
        address[3] memory users = [alice, bob, carol];
        uint256[3] memory allocations = [ALICE_ALLOCATION, BOB_ALLOCATION, CAROL_ALLOCATION];
        for (uint256 i = 0; i < 3; ++i) {
            usd.mint(users[i], allocations[i]);
            vm.startPrank(users[i]);
            usd.approve(address(vault), allocations[i]);
            vault.deposit(allocations[i]);
            vm.stopPrank();
        }
        assertEq(usd.balanceOf(address(vault)), ONE_MILLION);

        // Step 2: the attacker exploits the bug and takes everything.
        vm.prank(hacker);
        vault.emergencyWithdraw(hacker);
        assertEq(usd.balanceOf(address(vault)), 0);
        assertEq(usd.balanceOf(hacker), ONE_MILLION);

        // Step 3: open a case with a 10% reward until 72 hours and 5% until 7 days.
        Pactum.CaseTerms memory t = _terms();
        t.tiers = new Pactum.RewardTier[](2);
        t.tiers[0] = Pactum.RewardTier(tier2Until, 1000);
        t.tiers[1] = Pactum.RewardTier(tier3Until, 500);
        _open(t);

        // Step 5: one transaction splits 100,000 to the reward wallet and 900,000 to refunds.
        _return(ONE_MILLION);
        assertEq(usd.balanceOf(rewardWallet), 100_000e18);
        assertEq(usd.balanceOf(address(desk)), 900_000e18);

        // Step 6: users claim their share.
        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION, _aliceProof());
        desk.claimRefund(CASE_ID, bob, BOB_ALLOCATION, _bobProof());
        desk.claimRefund(CASE_ID, carol, CAROL_ALLOCATION, _carolProof());
        assertEq(usd.balanceOf(alice), 540_000e18);
        assertEq(usd.balanceOf(bob), 270_000e18);
        assertEq(usd.balanceOf(carol), 90_000e18);
        assertEq(usd.balanceOf(address(desk)), 0);
    }

    function test_vaultBugLetsAnyoneDrain() public {
        VulnerableVault vault = new VulnerableVault(usd);
        usd.mint(alice, 100e18);
        vm.startPrank(alice);
        usd.approve(address(vault), 100e18);
        vault.deposit(100e18);
        vm.stopPrank();
        assertEq(vault.deposits(alice), 100e18);

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vault.emergencyWithdraw(stranger);
        assertEq(usd.balanceOf(stranger), 100e18);
    }
}
