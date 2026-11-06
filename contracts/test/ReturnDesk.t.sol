// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReturnDesk} from "../src/ReturnDesk.sol";
import {BaseTest} from "./Base.t.sol";
import {FeeOnTransferToken, ReentrantToken} from "./mocks/TestTokens.sol";

contract OpenCaseTest is BaseTest {
    function test_opensAndStoresExactTerms() public {
        ReturnDesk.CaseTerms memory t = _terms();
        vm.expectEmit(address(desk));
        emit ReturnDesk.CaseOpened(CASE_ID, address(usd), ONE_MILLION, t.refundRoot, EVIDENCE);
        _open(t);

        ReturnDesk.Case memory c = desk.getCase(CASE_ID);
        assertEq(c.token, address(usd));
        assertEq(c.totalLoss, ONE_MILLION);
        assertEq(c.maxReturn, ONE_MILLION);
        assertEq(c.rewardCap, 200_000e18);
        assertEq(c.refundRoot, t.refundRoot);
        assertEq(c.evidenceHash, EVIDENCE);

        ReturnDesk.RewardTier[] memory tiers = desk.getTiers(CASE_ID);
        assertEq(tiers.length, 3);
        assertEq(tiers[1].until, tier2Until);
        assertEq(tiers[1].rewardBps, 1000);
        assertTrue(desk.nonceUsed(1));
    }

    function test_anyoneCanRelayTheSignature() public {
        ReturnDesk.CaseTerms memory t = _terms();
        bytes memory sig = _sign(desk, t, controllerKey);
        vm.prank(makeAddr("untrustedRelayer"));
        desk.openCase(t, sig);
        assertEq(desk.getCase(CASE_ID).token, address(usd));
    }

    // Recomputes the hash independently from the type string, without the contract's function.
    function test_hashMatchesIndependentEip712Encoding() public view {
        ReturnDesk.CaseTerms memory t = _terms();
        bytes32 tierType = keccak256("RewardTier(uint64 until,uint16 rewardBps)");
        bytes32 termsType = keccak256(
            "CaseTerms(bytes32 caseId,address token,uint256 totalLoss,uint256 maxReturn,uint256 rewardCap,bytes32 refundRoot,bytes32 evidenceHash,RewardTier[] tiers,uint256 nonce,uint256 chainId)RewardTier(uint64 until,uint16 rewardBps)"
        );
        bytes32 tiersHash = keccak256(
            abi.encodePacked(
                keccak256(abi.encode(tierType, tier1Until, uint16(1500))),
                keccak256(abi.encode(tierType, tier2Until, uint16(1000))),
                keccak256(abi.encode(tierType, tier3Until, uint16(500)))
            )
        );
        bytes32 structHash = keccak256(
            abi.encode(
                termsType,
                t.caseId,
                t.token,
                t.totalLoss,
                t.maxReturn,
                t.rewardCap,
                t.refundRoot,
                t.evidenceHash,
                tiersHash,
                t.nonce,
                t.chainId
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ReturnDesk"),
                keccak256("1"),
                block.chainid,
                address(desk)
            )
        );
        assertEq(desk.hashCaseTerms(t), keccak256(abi.encodePacked(hex"1901", domain, structHash)));
    }

    function test_revertsOnSignatureFromWrongKey() public {
        ReturnDesk.CaseTerms memory t = _terms();
        (, uint256 wrongKey) = makeAddrAndKey("notController");
        bytes memory sig = _sign(desk, t, wrongKey);
        vm.expectRevert(ReturnDesk.InvalidSignature.selector);
        desk.openCase(t, sig);
    }

    function test_revertsOnMalformedSignature() public {
        ReturnDesk.CaseTerms memory t = _terms();
        vm.expectRevert(ReturnDesk.InvalidSignature.selector);
        desk.openCase(t, hex"1234");
    }

    function test_revertsOnHighSMalleatedSignature() public {
        ReturnDesk.CaseTerms memory t = _terms();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(controllerKey, desk.hashCaseTerms(t));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes memory malleated = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(ReturnDesk.InvalidSignature.selector);
        desk.openCase(t, malleated);
    }

    function test_revertsWhenAnySignedFieldChanges() public {
        ReturnDesk.CaseTerms memory t = _terms();
        bytes memory sig = _sign(desk, t, controllerKey);

        ReturnDesk.CaseTerms memory changed = _terms();
        changed.rewardCap += 1;
        vm.expectRevert(ReturnDesk.InvalidSignature.selector);
        desk.openCase(changed, sig);

        changed = _terms();
        changed.tiers[0].rewardBps = 2000;
        vm.expectRevert(ReturnDesk.InvalidSignature.selector);
        desk.openCase(changed, sig);

        changed = _terms();
        changed.refundRoot = keccak256("other root");
        vm.expectRevert(ReturnDesk.InvalidSignature.selector);
        desk.openCase(changed, sig);
    }

    function test_revertsOnReusedSignature() public {
        ReturnDesk.CaseTerms memory t = _terms();
        bytes memory sig = _sign(desk, t, controllerKey);
        desk.openCase(t, sig);
        vm.expectRevert(ReturnDesk.NonceUsed.selector);
        desk.openCase(t, sig);
    }

    function test_revertsOnReusedNonceForAnotherCase() public {
        _openDefault();
        ReturnDesk.CaseTerms memory t = _terms();
        t.caseId = keccak256("case-2");
        bytes memory sig = _sign(desk, t, controllerKey);
        vm.expectRevert(ReturnDesk.NonceUsed.selector);
        desk.openCase(t, sig);
    }

    function test_revertsOnExistingCaseId() public {
        _openDefault();
        ReturnDesk.CaseTerms memory t = _terms();
        t.nonce = 2;
        bytes memory sig = _sign(desk, t, controllerKey);
        vm.expectRevert(ReturnDesk.CaseExists.selector);
        desk.openCase(t, sig);
    }

    function test_revertsOnWrongChainId() public {
        ReturnDesk.CaseTerms memory t = _terms();
        bytes memory sig = _sign(desk, t, controllerKey);
        vm.chainId(block.chainid + 1);
        vm.expectRevert(ReturnDesk.WrongChain.selector);
        desk.openCase(t, sig);
    }

    // An attacker also edits chainId in the terms to match the new chain: the old signature is still invalid.
    function test_revertsWhenSignatureFromOtherChainHasPatchedChainId() public {
        ReturnDesk.CaseTerms memory t = _terms();
        bytes memory sig = _sign(desk, t, controllerKey);
        vm.chainId(block.chainid + 1);
        t.chainId = block.chainid;
        vm.expectRevert(ReturnDesk.InvalidSignature.selector);
        desk.openCase(t, sig);
    }

    function test_revertsOnSignatureForAnotherDeskContract() public {
        ReturnDesk other = new ReturnDesk(controller);
        ReturnDesk.CaseTerms memory t = _terms();
        bytes memory sig = _sign(other, t, controllerKey);
        vm.expectRevert(ReturnDesk.InvalidSignature.selector);
        desk.openCase(t, sig);
    }

    function _expectInvalid(ReturnDesk.CaseTerms memory t) private {
        bytes memory sig = _sign(desk, t, controllerKey);
        vm.expectRevert(ReturnDesk.InvalidTerms.selector);
        desk.openCase(t, sig);
    }

    function test_revertsOnInvalidTerms() public {
        ReturnDesk.CaseTerms memory t = _terms();
        t.caseId = bytes32(0);
        _expectInvalid(t);

        t = _terms();
        t.token = address(0);
        _expectInvalid(t);

        t = _terms();
        t.totalLoss = 0;
        _expectInvalid(t);

        t = _terms();
        t.maxReturn = 0;
        _expectInvalid(t);

        t = _terms();
        t.maxReturn = t.totalLoss + 1;
        _expectInvalid(t);

        t = _terms();
        t.refundRoot = bytes32(0);
        _expectInvalid(t);

        t = _terms();
        t.tiers = new ReturnDesk.RewardTier[](0);
        _expectInvalid(t);

        t = _terms();
        t.tiers = new ReturnDesk.RewardTier[](9);
        for (uint256 i = 0; i < 9; ++i) {
            t.tiers[i] = ReturnDesk.RewardTier(uint64(block.timestamp + i + 1), uint16(1000 - i));
        }
        _expectInvalid(t);
    }

    function test_revertsOnBadTierOrdering() public {
        ReturnDesk.CaseTerms memory t = _terms();
        t.tiers[1].until = t.tiers[0].until;
        _expectInvalid(t);

        t = _terms();
        t.tiers[1].rewardBps = t.tiers[0].rewardBps;
        _expectInvalid(t);

        t = _terms();
        t.tiers[0].rewardBps = 10_001;
        _expectInvalid(t);

        t = _terms();
        t.tiers[0].until = uint64(block.timestamp - 3);
        t.tiers[1].until = uint64(block.timestamp - 2);
        t.tiers[2].until = uint64(block.timestamp - 1);
        _expectInvalid(t);
    }

    function test_constructorRejectsZeroController() public {
        vm.expectRevert(ReturnDesk.ZeroController.selector);
        new ReturnDesk(address(0));
    }
}

contract ReturnFundsTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _openDefault();
    }

    function test_splitsAtomicallyInOneCall() public {
        vm.warp(tier1Until + 1); // 10% tier.
        vm.expectEmit(address(desk));
        emit ReturnDesk.FundsReturned(CASE_ID, hacker, rewardWallet, ONE_MILLION, 100_000e18, 900_000e18, 1000);
        _return(ONE_MILLION);

        assertEq(usd.balanceOf(rewardWallet), 100_000e18);
        assertEq(usd.balanceOf(address(desk)), 900_000e18);
        assertEq(usd.balanceOf(hacker), 0);
        ReturnDesk.Case memory c = desk.getCase(CASE_ID);
        assertEq(c.totalReturned, ONE_MILLION);
        assertEq(c.totalReward, 100_000e18);
        assertEq(c.totalRefund, 900_000e18);
    }

    function test_tierBoundariesAreInclusive() public {
        uint16[3] memory expected = [1500, 1000, 500];
        uint64[3] memory until = [tier1Until, tier2Until, tier3Until];
        for (uint256 i = 0; i < 3; ++i) {
            vm.warp(until[i]);
            (bool open, uint16 bps, uint64 tierEnd) = desk.currentTier(CASE_ID);
            assertTrue(open);
            assertEq(bps, expected[i]);
            assertEq(tierEnd, until[i]);
            (uint256 reward, uint256 refund) = desk.quote(CASE_ID, 1000e18);
            assertEq(reward, 1000e18 * uint256(expected[i]) / 10_000);
            assertEq(reward + refund, 1000e18);
        }
    }

    function test_movesToNextTierOneSecondAfterBoundary() public {
        vm.warp(tier1Until + 1);
        (, uint16 bps,) = desk.currentTier(CASE_ID);
        assertEq(bps, 1000);
        vm.warp(tier2Until + 1);
        (, bps,) = desk.currentTier(CASE_ID);
        assertEq(bps, 500);
    }

    function test_revertsAfterLastTier() public {
        vm.warp(tier3Until + 1);
        vm.prank(hacker);
        vm.expectRevert(ReturnDesk.CaseClosed.selector);
        desk.returnFunds(CASE_ID, 1e18, rewardWallet);

        vm.expectRevert(ReturnDesk.CaseClosed.selector);
        desk.quote(CASE_ID, 1e18);

        (bool open,,) = desk.currentTier(CASE_ID);
        assertFalse(open);
        assertEq(usd.balanceOf(hacker), ONE_MILLION);
    }

    function test_partialReturnsAccumulate() public {
        _return(100_000e18); // 15%.
        vm.warp(tier1Until + 1);
        _return(100_000e18); // 10%.
        ReturnDesk.Case memory c = desk.getCase(CASE_ID);
        assertEq(c.totalReturned, 200_000e18);
        assertEq(c.totalReward, 25_000e18);
        assertEq(c.totalRefund, 175_000e18);
        assertEq(usd.balanceOf(rewardWallet), 25_000e18);
        assertEq(usd.balanceOf(address(desk)), 175_000e18);
    }

    function test_rewardCapMovesExcessToRefund() public {
        ReturnDesk.CaseTerms memory t = _terms();
        t.caseId = keccak256("capped");
        t.nonce = 2;
        t.rewardCap = 50_000e18;
        _open(t);

        vm.prank(hacker);
        desk.returnFunds(t.caseId, ONE_MILLION, rewardWallet); // 15% would be 150k, capped at 50k.

        ReturnDesk.Case memory c = desk.getCase(t.caseId);
        assertEq(c.totalReward, 50_000e18);
        assertEq(c.totalRefund, 950_000e18);
        assertEq(usd.balanceOf(rewardWallet), 50_000e18);
    }

    function test_rewardCapAppliesAcrossPartialReturns() public {
        ReturnDesk.CaseTerms memory t = _terms();
        t.caseId = keccak256("capped");
        t.nonce = 2;
        t.rewardCap = 20_000e18;
        _open(t);

        vm.startPrank(hacker);
        desk.returnFunds(t.caseId, 100_000e18, rewardWallet); // Reward 15k.
        desk.returnFunds(t.caseId, 100_000e18, rewardWallet); // Only 5k left.
        desk.returnFunds(t.caseId, 100_000e18, rewardWallet); // Cap used up, reward 0.
        vm.stopPrank();

        ReturnDesk.Case memory c = desk.getCase(t.caseId);
        assertEq(c.totalReward, 20_000e18);
        assertEq(c.totalRefund, 280_000e18);
        assertEq(usd.balanceOf(rewardWallet), 20_000e18);
    }

    function test_zeroRewardCapStillAcceptsReturn() public {
        ReturnDesk.CaseTerms memory t = _terms();
        t.caseId = keccak256("no reward");
        t.nonce = 2;
        t.rewardCap = 0;
        _open(t);
        vm.prank(hacker);
        desk.returnFunds(t.caseId, 1000e18, rewardWallet);
        assertEq(usd.balanceOf(rewardWallet), 0);
        assertEq(desk.getCase(t.caseId).totalRefund, 1000e18);
    }

    function test_maxReturnPullsOnlyWhatCaseAccepts() public {
        ReturnDesk.CaseTerms memory t = _terms();
        t.caseId = keccak256("limited");
        t.nonce = 2;
        t.maxReturn = 400_000e18;
        _open(t);

        vm.prank(hacker);
        desk.returnFunds(t.caseId, ONE_MILLION, rewardWallet);

        assertEq(desk.getCase(t.caseId).totalReturned, 400_000e18);
        assertEq(usd.balanceOf(hacker), 600_000e18);

        vm.prank(hacker);
        vm.expectRevert(ReturnDesk.NothingToReturn.selector);
        desk.returnFunds(t.caseId, 1, rewardWallet);
    }

    function test_quoteMatchesActualSplit() public {
        (uint256 reward, uint256 refund) = desk.quote(CASE_ID, 123_456e18);
        _return(123_456e18);
        ReturnDesk.Case memory c = desk.getCase(CASE_ID);
        assertEq(c.totalReward, reward);
        assertEq(c.totalRefund, refund);
    }

    function test_revertsOnZeroRewardAddress() public {
        vm.prank(hacker);
        vm.expectRevert(ReturnDesk.ZeroRewardAddress.selector);
        desk.returnFunds(CASE_ID, 1e18, address(0));
    }

    function test_revertsOnZeroAmount() public {
        vm.prank(hacker);
        vm.expectRevert(ReturnDesk.NothingToReturn.selector);
        desk.returnFunds(CASE_ID, 0, rewardWallet);
    }

    function test_revertsOnUnknownCase() public {
        vm.prank(hacker);
        vm.expectRevert(ReturnDesk.CaseNotFound.selector);
        desk.returnFunds(keccak256("nope"), 1e18, rewardWallet);
        vm.expectRevert(ReturnDesk.CaseNotFound.selector);
        desk.quote(keccak256("nope"), 1e18);
        vm.expectRevert(ReturnDesk.CaseNotFound.selector);
        desk.claimRefund(keccak256("nope"), alice, 1, new bytes32[](0));
    }

    function test_revertsWithoutApproval() public {
        address stranger = makeAddr("stranger");
        usd.mint(stranger, 1e18);
        vm.prank(stranger);
        vm.expectRevert();
        desk.returnFunds(CASE_ID, 1e18, rewardWallet);
    }

    // Nobody can use the hacker's approval to change the reward address: the function only takes msg.sender's tokens.
    function test_frontRunnerCannotSpendSomeoneElsesApproval() public {
        address frontRunner = makeAddr("frontRunner");
        vm.prank(frontRunner);
        vm.expectRevert();
        desk.returnFunds(CASE_ID, 1e18, frontRunner);
        assertEq(usd.balanceOf(hacker), ONE_MILLION);
    }
}

contract ClaimRefundTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _openDefault();
        vm.warp(tier1Until + 1); // 10% tier.
    }

    function test_claimsProportionalShare() public {
        _return(ONE_MILLION);

        vm.expectEmit(address(desk));
        emit ReturnDesk.RefundClaimed(CASE_ID, alice, 540_000e18);
        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION, _aliceProof());
        desk.claimRefund(CASE_ID, bob, BOB_ALLOCATION, _bobProof());
        desk.claimRefund(CASE_ID, carol, CAROL_ALLOCATION, _carolProof());

        assertEq(usd.balanceOf(alice), 540_000e18);
        assertEq(usd.balanceOf(bob), 270_000e18);
        assertEq(usd.balanceOf(carol), 90_000e18);
        assertEq(usd.balanceOf(address(desk)), 0);
        assertEq(desk.getCase(CASE_ID).totalClaimed, 900_000e18);
    }

    function test_anyoneCanClaimButFundsGoToAccount() public {
        _return(ONE_MILLION);
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION, _aliceProof());
        assertEq(usd.balanceOf(stranger), 0);
        assertEq(usd.balanceOf(alice), 540_000e18);
    }

    function test_claimsAgainAfterMoreFundsReturn() public {
        _return(100_000e18);
        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION, _aliceProof());
        assertEq(usd.balanceOf(alice), 54_000e18);

        _return(100_000e18);
        assertEq(desk.claimable(CASE_ID, alice, ALICE_ALLOCATION), 54_000e18);
        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION, _aliceProof());
        assertEq(usd.balanceOf(alice), 108_000e18);
        assertEq(desk.claimed(CASE_ID, alice), 108_000e18);
    }

    function test_refundsRemainClaimableAfterCaseCloses() public {
        _return(ONE_MILLION);
        vm.warp(tier3Until + 365 days);
        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION, _aliceProof());
        assertEq(usd.balanceOf(alice), 540_000e18);
    }

    function test_revertsOnSecondClaim() public {
        _return(ONE_MILLION);
        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION, _aliceProof());
        vm.expectRevert(ReturnDesk.NothingToClaim.selector);
        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION, _aliceProof());
    }

    function test_revertsBeforeAnyFundsReturn() public {
        vm.expectRevert(ReturnDesk.NothingToClaim.selector);
        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION, _aliceProof());
    }

    function test_revertsOnWrongProof() public {
        _return(ONE_MILLION);
        vm.expectRevert(ReturnDesk.InvalidProof.selector);
        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION, _bobProof());
    }

    function test_revertsOnInflatedAllocation() public {
        _return(ONE_MILLION);
        vm.expectRevert(ReturnDesk.InvalidProof.selector);
        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION + 1, _aliceProof());
    }

    function test_revertsOnWrongAccount() public {
        _return(ONE_MILLION);
        vm.expectRevert(ReturnDesk.InvalidProof.selector);
        desk.claimRefund(CASE_ID, hacker, ALICE_ALLOCATION, _aliceProof());
    }

    function test_revertsOnEmptyProof() public {
        _return(ONE_MILLION);
        vm.expectRevert(ReturnDesk.InvalidProof.selector);
        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION, new bytes32[](0));
    }

    // A wrong root whose allocations total twice the loss: total claims still cannot exceed the net refund.
    function test_badRootCannotPayMoreThanRefundPool() public {
        address mallory = makeAddr("mallory");
        address trent = makeAddr("trent");
        ReturnDesk.CaseTerms memory t = _terms();
        t.caseId = keccak256("bad root");
        t.nonce = 2;
        t.refundRoot = _pair(_leaf(mallory, ONE_MILLION), _leaf(trent, ONE_MILLION));
        _open(t);

        usd.mint(hacker, ONE_MILLION);
        vm.prank(hacker);
        desk.returnFunds(t.caseId, ONE_MILLION, rewardWallet);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = _leaf(trent, ONE_MILLION);
        desk.claimRefund(t.caseId, mallory, ONE_MILLION, proof);
        assertEq(usd.balanceOf(mallory), 900_000e18);

        proof[0] = _leaf(mallory, ONE_MILLION);
        vm.expectRevert(ReturnDesk.NothingToClaim.selector);
        desk.claimRefund(t.caseId, trent, ONE_MILLION, proof);
    }

    // A case with a wrong root cannot take money from another case using the same token.
    function test_casesSharingTokenStayIsolated() public {
        address mallory = makeAddr("mallory");
        ReturnDesk.CaseTerms memory t = _terms();
        t.caseId = keccak256("other");
        t.nonce = 2;
        t.refundRoot = _pair(_leaf(mallory, ONE_MILLION), _leaf(mallory, ONE_MILLION));
        _open(t);

        _return(ONE_MILLION); // Funds go into CASE_ID.
        usd.mint(hacker, 1000e18);
        vm.prank(hacker);
        desk.returnFunds(t.caseId, 1000e18, rewardWallet); // Only 900 tokens go to the second case.

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = _leaf(mallory, ONE_MILLION);
        desk.claimRefund(t.caseId, mallory, ONE_MILLION, proof);
        assertEq(usd.balanceOf(mallory), 900e18);

        desk.claimRefund(CASE_ID, alice, ALICE_ALLOCATION, _aliceProof());
        assertEq(usd.balanceOf(alice), 540_000e18);
    }
}

contract NoAdminPathTest is BaseTest {
    function setUp() public override {
        super.setUp();
        _openDefault();
        _return(ONE_MILLION);
    }

    function test_noCommonWithdrawFunctionExists() public {
        string[6] memory signatures = [
            "withdraw(address,uint256)",
            "withdraw(uint256)",
            "emergencyWithdraw(address)",
            "sweep(address,address)",
            "rescueTokens(address,address,uint256)",
            "transferOwnership(address)"
        ];
        uint256 balanceBefore = usd.balanceOf(address(desk));
        vm.startPrank(controller);
        for (uint256 i = 0; i < signatures.length; ++i) {
            (bool ok,) = address(desk).call(abi.encodeWithSignature(signatures[i], address(usd), controller, 1));
            assertFalse(ok, signatures[i]);
        }
        vm.stopPrank();
        assertEq(usd.balanceOf(address(desk)), balanceBefore);
    }

    function test_controllerHasNoSpecialClaim() public {
        vm.prank(controller);
        vm.expectRevert(ReturnDesk.InvalidProof.selector);
        desk.claimRefund(CASE_ID, controller, 1, new bytes32[](0));
    }

    function test_controllerCannotOverwriteOpenCase() public {
        ReturnDesk.CaseTerms memory t = _terms();
        t.nonce = 2;
        t.tiers[0].rewardBps = 1;
        t.tiers[1].rewardBps = 0;
        t.tiers = _firstTwo(t.tiers);
        bytes memory sig = _sign(desk, t, controllerKey);
        vm.expectRevert(ReturnDesk.CaseExists.selector);
        desk.openCase(t, sig);
        assertEq(desk.getTiers(CASE_ID)[0].rewardBps, 1500);
    }

    function _firstTwo(ReturnDesk.RewardTier[] memory tiers)
        private
        pure
        returns (ReturnDesk.RewardTier[] memory out)
    {
        out = new ReturnDesk.RewardTier[](2);
        out[0] = tiers[0];
        out[1] = tiers[1];
    }
}

contract FeeOnTransferTest is BaseTest {
    FeeOnTransferToken private fee;
    bytes32 private feeCase = keccak256("fee case");

    function setUp() public override {
        super.setUp();
        fee = new FeeOnTransferToken(100); // 1% fee.
        fee.mint(hacker, ONE_MILLION);
        vm.prank(hacker);
        fee.approve(address(desk), type(uint256).max);

        ReturnDesk.CaseTerms memory t = _terms();
        t.caseId = feeCase;
        t.token = address(fee);
        t.nonce = 2;
        _open(t);
        vm.warp(tier1Until + 1); // 10% tier.
    }

    function test_accountsOnlyWhatWasReallyReceived() public {
        vm.prank(hacker);
        desk.returnFunds(feeCase, 100_000e18, rewardWallet);

        ReturnDesk.Case memory c = desk.getCase(feeCase);
        assertEq(c.totalReturned, 99_000e18);
        assertEq(c.totalReward, 9900e18);
        assertEq(c.totalRefund, 89_100e18);
        assertEq(c.totalReward + c.totalRefund, c.totalReturned);
        assertEq(fee.balanceOf(address(desk)), 89_100e18);
        assertEq(fee.balanceOf(rewardWallet), 9801e18); // The recipient also pays the 1% fee.
    }

    function test_claimsStayFundedWithFeeToken() public {
        vm.prank(hacker);
        desk.returnFunds(feeCase, ONE_MILLION, rewardWallet);
        desk.claimRefund(feeCase, alice, ALICE_ALLOCATION, _aliceProof());
        desk.claimRefund(feeCase, bob, BOB_ALLOCATION, _bobProof());
        desk.claimRefund(feeCase, carol, CAROL_ALLOCATION, _carolProof());
        ReturnDesk.Case memory c = desk.getCase(feeCase);
        assertEq(c.totalClaimed, c.totalRefund);
        assertEq(fee.balanceOf(address(desk)), 0);
    }

    function test_totalFeeTokenRevertsWhenNothingArrives() public {
        FeeOnTransferToken full = new FeeOnTransferToken(10_000);
        full.mint(hacker, 100e18);
        vm.prank(hacker);
        full.approve(address(desk), type(uint256).max);
        ReturnDesk.CaseTerms memory t = _terms();
        t.caseId = keccak256("full fee");
        t.token = address(full);
        t.nonce = 3;
        _open(t);
        vm.prank(hacker);
        vm.expectRevert(ReturnDesk.NothingToReturn.selector);
        desk.returnFunds(t.caseId, 100e18, rewardWallet);
    }
}

contract ReentrancyTest is BaseTest {
    ReentrantToken private evil;
    bytes32 private evilCase = keccak256("evil case");

    function setUp() public override {
        super.setUp();
        evil = new ReentrantToken();
        evil.mint(hacker, ONE_MILLION);
        vm.prank(hacker);
        evil.approve(address(desk), type(uint256).max);

        ReturnDesk.CaseTerms memory t = _terms();
        t.caseId = evilCase;
        t.token = address(evil);
        t.nonce = 2;
        _open(t);
    }

    function _assertBlocked() private view {
        assertTrue(evil.attacked(), "attack never ran");
        assertFalse(evil.attackSucceeded(), "reentry succeeded");
        bytes memory data = evil.attackReturnData();
        bytes4 selector;
        assembly ("memory-safe") {
            selector := mload(add(data, 0x20))
        }
        assertEq(selector, ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function test_blocksReentryIntoReturnFundsWhilePulling() public {
        evil.arm(address(desk), abi.encodeCall(ReturnDesk.returnFunds, (evilCase, 1e18, hacker)), 0);
        vm.prank(hacker);
        desk.returnFunds(evilCase, 100e18, rewardWallet);
        _assertBlocked();
    }

    function test_blocksReentryIntoClaimWhilePayingReward() public {
        bytes memory attack =
            abi.encodeCall(ReturnDesk.claimRefund, (evilCase, alice, ALICE_ALLOCATION, _aliceProof()));
        evil.arm(address(desk), attack, 1); // Skip the pull and attack while the reward is paid.
        vm.prank(hacker);
        desk.returnFunds(evilCase, 100e18, rewardWallet);
        _assertBlocked();
        assertEq(evil.balanceOf(alice), 0);
    }

    function test_blocksReentryIntoClaimWhileClaiming() public {
        vm.prank(hacker);
        desk.returnFunds(evilCase, 100e18, rewardWallet);

        bytes memory attack =
            abi.encodeCall(ReturnDesk.claimRefund, (evilCase, alice, ALICE_ALLOCATION, _aliceProof()));
        evil.arm(address(desk), attack, 0);
        desk.claimRefund(evilCase, alice, ALICE_ALLOCATION, _aliceProof());
        _assertBlocked();
        assertEq(evil.balanceOf(alice), desk.claimed(evilCase, alice));
    }

    function test_blocksReentryIntoOpenCase() public {
        ReturnDesk.CaseTerms memory t = _terms();
        t.caseId = keccak256("nested");
        t.nonce = 3;
        bytes memory attack = abi.encodeCall(ReturnDesk.openCase, (t, _sign(desk, t, controllerKey)));
        evil.arm(address(desk), attack, 0);
        vm.prank(hacker);
        desk.returnFunds(evilCase, 100e18, rewardWallet);
        _assertBlocked();
    }
}

// A real signature produced by the NEAR testnet MPC network (spike/chain-signatures).
contract MpcSignatureVectorTest is BaseTest {
    address private constant DERIVED = 0xc6ef73c058ACBc8b73aeB57FB26EC8223796c563;

    function test_recoversAddressFromMpcSignatureRecoveryId0() public pure {
        bytes32 digest = 0xdd97e6dba14450942fb8698101ed76d198357a7e4d475e1f6b8a9d3c112cc649;
        bytes memory sig = abi.encodePacked(
            bytes32(0x4e3cb210ca4197413b2066175a8a81a78e497e499f44116407e9371ce8a8dd99),
            bytes32(0x7cf8899358fe262a83ce4b1e4a98d157450203adab4a212847e48ef0c20c34f7),
            uint8(27)
        );
        assertEq(ECDSA.recover(digest, sig), DERIVED);
    }

    function test_recoversAddressFromMpcSignatureRecoveryId1() public pure {
        bytes32 digest = 0x932b7a70825d1a5282302abe3c1dcd0563b7365b9cc06380925159e200066c06;
        bytes memory sig = abi.encodePacked(
            bytes32(0x878663f63c208af6fb37e191a700248036f75950543619b13201f24aecc3ffff),
            bytes32(0x08bfad75049685a8d5f00f2c90f23e0104704c81962184215064dd5553e57888),
            uint8(28)
        );
        assertEq(ECDSA.recover(digest, sig), DERIVED);
    }
}
