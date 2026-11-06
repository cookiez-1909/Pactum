// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A token that charges a fee on every transfer. The fee is burned from the amount received.
contract FeeOnTransferToken is ERC20("Fee Token", "FEE") {
    uint256 public immutable feeBps;

    constructor(uint256 feeBps_) {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = value * feeBps / 10_000;
        super._update(from, address(0), fee);
        super._update(from, to, value - fee);
    }
}

/// @notice A malicious token that calls back into the contract during a transfer to test reentrancy.
contract ReentrantToken is ERC20("Reentrant Token", "RE") {
    address public target;
    bytes public payload;
    uint256 public transfersBeforeAttack;
    bool public armed;

    bool public attacked;
    bool public attackSucceeded;
    bytes public attackReturnData;

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_, uint256 transfersBeforeAttack_) external {
        target = target_;
        payload = payload_;
        transfersBeforeAttack = transfersBeforeAttack_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (!armed) return;
        if (transfersBeforeAttack > 0) {
            transfersBeforeAttack -= 1;
            return;
        }
        armed = false;
        attacked = true;
        (attackSucceeded, attackReturnData) = target.call(payload);
    }
}
