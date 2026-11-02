# IDE Activity Stream and Sidebar Layout Design

Date: 2026-08-14

## Goal

Replace the card-heavy tool transcript with an IDE-style activity stream and fix the desktop sidebar so the workspace tree uses available space while phone controls and connection status remain visible.

## Scope

This change covers the Windows desktop renderer only. It does not change Grok CLI protocol handling, tool execution, session persistence, mobile session synchronization, or the visual treatment of normal user and assistant messages.

## Main Conversation Layout

Each assistant turn keeps this order:

1. Assistant progress text for the current stage.
2. One compact activity group for consecutive tool operations.
3. Additional progress text and activity groups when the assistant changes stage.
4. One clearly separated final answer after the turn completes.

The activity group uses a restrained IDE timeline instead of a stack of full-width cards. Its header shows the current or terminal state and a compact summary, for example `Completed 8 steps: searched 2, read 5, edited 1`.

Completed groups are collapsed by default. Running and failed groups remain expanded enough to expose the current or failed item. The user can expand any group to inspect individual operations and raw output.

## Tool Classification and Titles

Tool events are normalized for display without changing their underlying data:

- Search-like calls display `Search <query purpose>`.
- Read-like calls display `Read <file name>`.
- Edit/write-like calls display `Edit <file name>`.
- Terminal calls display a concise command purpose.
- Unknown tools use a cleaned, bounded form of the CLI title.

Raw regular expressions, full paths, arguments, and output stay inside the expandable details area. They do not become the primary row title.

Adjacent equivalent operations are merged by display category and primary target. Repeated reads of the same file become one row such as `Read chat_service.py x4`. Failed operations are never merged into a successful row, and their error details remain individually accessible.

## Activity Group Behavior

An activity group begins with the first tool call after assistant progress text. Consecutive tool calls stay in that group until new assistant progress text starts another stage or the turn finishes.

The group header updates as events arrive. Individual operation rows have stable identities so streaming updates change the existing row rather than inserting duplicates. The group maintains these counts:

- total operations received;
- operations represented after merging;
- running, completed, and failed states;
- counts by search, read, edit, terminal, and other categories.

The final answer is never placed inside the activity group and is never collapsed with tool details.

## Sidebar Layout

The sidebar is a fixed-height flex column with one flexible region: the workspace tree.

- Brand and primary commands remain at the top.
- The workspace tree consumes all remaining vertical space and scrolls internally.
- `All conversations` and `More features` remain below the tree as fixed navigation rows.
- Phone control and backend connection status remain pinned at the bottom and never scroll with the workspace tree.
- The redundant flexible spacer is removed so it cannot consume half the sidebar height.
- The sidebar remains horizontally resizable. The desktop default is 320 px, with a 280-440 px range.

On short windows, the workspace tree shrinks first. Phone control and connection status stay visible. Expanded `More features` may scroll within its own bounded area rather than pushing the footer out of view.

## Visual Style

The activity stream follows an IDE hierarchy while retaining the existing glass theme:

- compact 30-34 px operation rows;
- a thin timeline rail and status icons;
- no decorative card around every operation;
- one subtle framed container per activity group;
- single-line human-readable titles with ellipsis;
- monospace text only for raw paths, expressions, commands, and output inside details.

Normal chat messages, the composer, themes, custom background, and avatars retain their current glass styling.

## Error Handling

Running operations remain visibly active. Failed operations surface a concise failure label in the group and expand automatically. Raw errors remain in details. A failed item does not prevent later tool events or the final answer from rendering.

Malformed or incomplete CLI events fall back to an `Operation` title with a stable event identifier. They must not create an unbounded title or break group rendering.

## Testing

Automated coverage will verify:

- raw regex titles are converted to concise search labels;
- repeated reads of the same file merge and expose a repeat count;
- failed operations remain separate and visible;
- a new assistant progress segment starts a new activity group;
- the final answer remains outside activity groups;
- the sidebar has one flexible workspace region and no flexible spacer;
- phone control and connection status remain visible at short desktop heights;
- desktop, phone, and iPad Electron QA still pass;
- Windows setup and portable packages contain the updated renderer.

## Non-Goals

- Changing how Grok decides which tools to call.
- Suppressing tool calls from session history.
- Redesigning the mobile application in this change.
- Adding a separate terminal or problems panel.
