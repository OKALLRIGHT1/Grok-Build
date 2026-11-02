# IDE Shell and Mobile Session Sync Design

## Goal

Reorganize the Windows client around an IDE-style workspace and make the mobile web client restore complete conversation content when it connects. The desktop chat timeline, messages, tool steps, and composer retain the existing glass visual treatment.

## Scope

This design contains two coordinated work packages:

1. A desktop IDE shell with project-oriented navigation.
2. A complete, reconnect-safe mobile session synchronization path.

The desktop renderer continues to use the existing ACP, model, permission, plan approval, attachment, queue, settings, and theme behavior. The mobile web client remains served by the desktop control server and does not require an APK update to receive these changes.

## Desktop Information Architecture

### Application Shell

The desktop window uses an IDE-style hierarchy. Rounded surfaces and cards remain allowed, but they cannot replace the hierarchy or make unrelated features appear as equal dashboard tiles.

- The left navigation defaults to 268 pixels, can be resized between 220 and 360 pixels, and can collapse to a 48-pixel icon rail. Width and collapse state are stored locally.
- The top navigation contains New task, Search, Automations, and Skills.
- The middle navigation is a workspace tree. Each workspace is a first-level node and its conversations are nested children.
- The bottom navigation contains account identity, connection state, mobile control, and settings.
- Low-frequency functions such as providers, API keys, usage, extensions, and task monitoring live in the settings center or a compact command menu.
- The main pane contains an editor-style conversation header, the active conversation timeline, and a docked composer.

### Workspace Tree

Each workspace can be expanded or collapsed independently. Its state is stored locally and restored at startup. The active conversation remains visually distinct without turning the whole row into a large card.

Conversation rows show a bounded title and compact metadata such as relative time and running state. Long titles use ellipsis and a tooltip. Loading a conversation activates its workspace, preserves the expanded tree state, and opens the conversation at the newest content.

The entire sidebar can be collapsed. Collapsed mode preserves familiar icon targets and tooltips rather than squeezing text into the narrow rail.

### Main Conversation Pane

The main pane follows IDE task logic while retaining glass chat styling:

- The conversation header behaves like an editor tab/header and shows the current title plus common conversation actions.
- The timeline is the primary work surface. User messages, assistant turns, tool calls, diffs, plans, tables, and attachments keep their existing glass treatment.
- The composer remains docked to the bottom and keeps model, mode, permission, attachment, queue, interrupt, stop, and send controls.
- The welcome state uses one rounded glass task surface inside the editor workspace. It does not introduce unrelated dashboard tiles.
- Starting a task immediately switches from the welcome state to the active timeline.
- Opening a stored conversation settles at the bottom after layout and late image loading complete.

### Theme and Background Behavior

The IDE structure is stable across all existing themes. Theme selection controls shell colors, borders, shadows, and glass opacity. Dark themes can closely resemble the supplied IDE reference; light and colored themes use the same hierarchy with their own palette.

Custom background images remain visible through the main conversation pane. Background position and fit controls continue to apply. The sidebar uses the theme's stronger glass opacity for legibility, while the timeline uses the normal glass opacity. Neither area uses a permanently fixed dark palette.

## Mobile Complete Session Synchronization

### Current Gap

The initial mobile `state` message contains runtime metadata but not the messages and tool events that occurred before the phone connected. Historical content currently reaches the phone only when the official CLI happens to replay a session after the phone is already connected. Therefore a late connection sees only new updates.

### Session Event Ledger

The desktop main process owns a bounded event ledger for the active session. It records the same normalized conversation events that are sent to desktop and mobile renderers:

- user messages and attachments;
- assistant text and reasoning/progress sections;
- tool calls, tool updates, diffs, and results;
- turn completion, interruption, and failure states;
- session loading boundaries needed to reproduce a clean timeline.

Every ledger entry contains a stable session ID and a monotonically increasing sequence number. The ledger never stores permission secrets, API keys, authentication tokens, or unfiltered diagnostic values.

The ledger is session-scoped. Starting a new session creates a new ledger. Loading a stored session clears that session's in-memory view and records the official CLI replay from its loading boundary. A bounded size policy truncates oversized raw tool content using the same presentation limits already used by the clients.

### Initial Sync Protocol

After an authenticated mobile WebSocket opens:

1. The server sends the normal runtime snapshot.
2. The mobile client requests synchronization for the snapshot's active session ID.
3. The server replies with a sync-begin message containing the session ID, ledger generation, first sequence, last sequence, and chunk count.
4. The server sends ordered chunks below the WebSocket payload limit.
5. The server sends sync-complete with the final sequence.

Live updates generated while synchronization is in progress are buffered by the mobile renderer. After sync-complete, the renderer applies buffered entries whose sequence is newer than the synchronized final sequence. Duplicate or retried entries are ignored by `(sessionId, generation, sequence)` identity.

The main process must not reload, stop, or otherwise disturb the active official CLI session merely to synchronize a phone.

### Historical Conversation Switching

The existing mobile conversation list remains available. Selecting another conversation uses the established session-load action and changes the active session on both desktop and mobile clients. The resulting official CLI replay rebuilds the ledger and is broadcast in order. Both clients clear the previous timeline only after the session-loading boundary is accepted.

After replay completes, desktop and mobile settle at the newest content. If the user has deliberately scrolled away from the bottom after completion, subsequent live messages show a newest-message control instead of forcing the viewport downward.

### Runtime State Recovery

The runtime snapshot continues to restore state that does not belong in the transcript ledger:

- active model, mode, and permission mode;
- task state and queued prompts;
- recoverable canceled prompt;
- pending permission, folder trust, and plan approval interactions;
- avatars and connection status.

Pending interactions are deduplicated using their existing request or stable tool identifiers.

## Failure Handling

- If a sync request names a stale session, the server returns a structured stale-session error and the phone refreshes runtime state before retrying.
- If a chunk is missing or out of order, the phone retains the currently rendered content and offers a visible Retry sync action.
- If the connection drops during synchronization, reconnect starts a fresh synchronization generation; partially applied entries are deduplicated.
- If the event ledger is unavailable, the interface explains that complete content is not yet available and allows the user to explicitly reload the selected conversation. It must not silently show an apparently complete but partial timeline.
- Raw JSON, protocol envelopes, API keys, and authentication tokens never appear as primary user-facing error text.

## Component Boundaries

- `desktop/src/renderer/index.html`, `renderer.js`, and `styles.css`: desktop IDE shell, workspace tree, persistence, responsive behavior, and glass timeline styling.
- `desktop/src/main.js`: session lifecycle integration and routing of normalized ledger events.
- A small session-ledger policy module under `desktop/src/`: sequence assignment, bounded storage, snapshot/chunk creation, and deduplication contracts.
- `desktop/src/control-server.js`: authenticated targeted sync messages and payload-size enforcement.
- `desktop/src/mobile/app.js`: synchronization state machine, live-event buffering, deduplication, retry behavior, and final scroll positioning.
- Desktop and mobile HTML/CSS: visible synchronization and retry states without raw transport details.

## Testing Strategy

### Desktop

- Workspace rows render as expandable tree nodes with nested conversations.
- Expanded workspaces and collapsed sidebar state persist independently.
- Low-frequency features remain reachable from settings or the command menu.
- Welcome and active layouts remain mutually exclusive.
- Themes, custom backgrounds, attachments, queued prompts, permission prompts, and plan approval dialogs survive layout changes.
- Visual QA covers 1440x900, a narrow desktop window, an expanded tree, and a collapsed icon rail.

### Mobile and iPad

- A phone connecting after multiple turns receives all earlier user messages, assistant content, tool steps, attachments, and terminal states.
- Refresh and disconnect/reconnect do not duplicate entries.
- Live updates arriving during chunked synchronization appear once and in order.
- Missing and repeated chunks produce retry behavior rather than a partial success state.
- Historical conversation switching replaces the timeline and finishes at the bottom.
- Manual upward scrolling is respected after replay.
- Phone, iPad portrait, and iPad landscape layouts remain usable during synchronization and approval dialogs.

### Regression and Packaging

- Existing Node tests and backend smoke tests remain green.
- Electron screenshot QA covers desktop IDE states plus mobile initial sync and reconnect.
- The Windows package remains a frontend for the selected official Grok Build CLI and does not bundle a private backend executable.

## Non-Goals

- Rewriting the ACP client or replacing the official CLI.
- Creating a separate cloud relay or account synchronization service.
- Persisting an unlimited duplicate transcript database on the desktop.
- Changing mobile pairing, Tailscale addressing, or authentication rules.
- Making the mobile web interface visually identical to the desktop IDE shell.

## Acceptance Criteria

1. Desktop navigation behaves as an IDE project tree, with conversations owned by workspaces and stable collapsible navigation.
2. All existing themes and custom backgrounds work with the new shell, while the chat timeline and composer retain glass styling.
3. A newly connected or refreshed phone receives the complete active conversation rather than only future updates.
4. Mobile synchronization is ordered, chunked, reconnect-safe, deduplicated, and non-disruptive to an active desktop task.
5. Phones and iPads can switch conversations, view complete replayed content, and retain all existing control and approval workflows.
6. Automated tests, backend smoke tests, multi-viewport Electron QA, and Windows packaging pass before release.
