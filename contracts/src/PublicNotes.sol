// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title PublicNotes
/// @notice Public notes with no server: comments about an incident and offer text.
/// @dev Only emits events and stores no state, so it is cheap and nobody can edit or delete a note.
///      The author is msg.sender, so it cannot be forged. The contract does not verify the content:
///      for an offer, the website only accepts a text whose hash matches `evidenceHash` in the signed terms.
contract PublicNotes {
    uint256 public constant MAX_LENGTH = 2000;

    event Note(bytes32 indexed topic, address indexed author, string text);

    error EmptyNote();
    error NoteTooLong();

    function post(bytes32 topic, string calldata text) external {
        uint256 length = bytes(text).length;
        if (length == 0) revert EmptyNote();
        if (length > MAX_LENGTH) revert NoteTooLong();
        emit Note(topic, msg.sender, text);
    }
}
