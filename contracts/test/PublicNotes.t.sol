// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {PublicNotes} from "../src/PublicNotes.sol";

contract PublicNotesTest is Test {
    PublicNotes private notes = new PublicNotes();
    bytes32 private constant TOPIC = keccak256("discussion:kestrel");

    function test_emitsTheCallerAsAuthor() public {
        address alice = makeAddr("alice");
        vm.expectEmit(address(notes));
        emit PublicNotes.Note(TOPIC, alice, "hello");
        vm.prank(alice);
        notes.post(TOPIC, "hello");
    }

    function test_revertsOnEmptyNote() public {
        vm.expectRevert(PublicNotes.EmptyNote.selector);
        notes.post(TOPIC, "");
    }

    function test_acceptsTheMaximumLength() public {
        notes.post(TOPIC, string(new bytes(notes.MAX_LENGTH())));
    }

    function test_revertsAboveTheMaximumLength() public {
        string memory tooLong = string(new bytes(notes.MAX_LENGTH() + 1));
        vm.expectRevert(PublicNotes.NoteTooLong.selector);
        notes.post(TOPIC, tooLong);
    }
}
