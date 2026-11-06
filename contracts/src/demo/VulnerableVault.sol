// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title VulnerableVault
/// @notice INTENTIONALLY BROKEN. Demo only. Never deploy it with real funds.
/// @dev Bug: `emergencyWithdraw` does not check the caller, so anyone can take every deposit.
contract VulnerableVault {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    mapping(address account => uint256) public deposits;

    event Deposited(address indexed account, uint256 amount);
    event Drained(address indexed to, uint256 amount);

    constructor(IERC20 token_) {
        token = token_;
    }

    function deposit(uint256 amount) external {
        deposits[msg.sender] += amount;
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @dev INTENTIONAL BUG: an admin function that never checks the caller.
    function emergencyWithdraw(address to) external {
        uint256 amount = token.balanceOf(address(this));
        token.safeTransfer(to, amount);
        emit Drained(to, amount);
    }
}
