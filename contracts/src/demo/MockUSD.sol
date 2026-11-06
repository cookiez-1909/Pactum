// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test token for the demo. Anyone can mint it, so it has no value.
contract MockUSD is ERC20("Mock USD", "mUSD") {
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
