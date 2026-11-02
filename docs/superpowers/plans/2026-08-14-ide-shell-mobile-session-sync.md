# IDE Shell and Mobile Session Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the desktop navigation into a theme-aware IDE project tree while allowing mobile browsers to restore a complete active conversation safely after connecting or reconnecting.

**Architecture:** A pure session-ledger module records sanitized renderer events with stable per-session sequence numbers and produces bounded chunks. The main process records the same normalized updates it broadcasts today, exposes an authenticated targeted WebSocket sync action, and never reloads the CLI to satisfy a phone. The desktop renderer builds an expandable workspace tree from existing sessions; the mobile renderer applies a snapshot/replay state machine and buffers live events until sync completes.

**Tech Stack:** Electron 40, Node built-in test runner, vanilla HTML/CSS/JavaScript, WebSocket control server, official Grok Build ACP CLI.

## Global Constraints

- Preserve ACP, model, permission, folder trust, plan approval, attachment, prompt queue, background, avatar, and theme behavior.
- Keep chat messages and composer glass-styled; only the information architecture becomes IDE-like.
- Theme controls all shell colors; no permanently fixed dark sidebar.
- A phone synchronization must not load, stop, or interrupt the official CLI session.
- Do not emit API keys, auth tokens, permission secrets, or raw diagnostics in ledger data or user-facing errors.
- Keep existing phone and iPad panel modes and paired-control authentication.
- This checkout lacks usable Git metadata; record completion in this plan and use test output instead of commits.

---

### Task 1: Pure Session Ledger

**Files:**
- Create: `desktop/src/session-ledger.js`
- Create: `desktop/test/session-ledger.test.js`

**Consumes:** A session ID and sanitized event values.

**Produces:** `SessionLedger`, with `start(sessionId)`, `append(type, data)`, `snapshot(sessionId)`, `chunks(sessionId, maxBytes)`, and `clear(sessionId)`.

- [ ] **Step 1: Write failing ledger tests.**

```js
const { SessionLedger } = require("../src/session-ledger");

test("ledger assigns ordered session-scoped sequence numbers", () => {
  const ledger = new SessionLedger();
  ledger.start("s1");
  assert.deepEqual(ledger.append("agent-update", { text: "one" }), {
    sessionId: "s1", generation: 1, sequence: 1, type: "agent-update", data: { text: "one" },
  });
  assert.equal(ledger.append("agent-update", { text: "two" }).sequence, 2);
});

test("ledger chunks complete ordered snapshots under a byte budget", () => {
  const ledger = new SessionLedger();
  ledger.start("s1");
  ledger.append("agent-update", { text: "a".repeat(120) });
  ledger.append("task-status", { state: "started" });
  const chunks = ledger.chunks("s1", 180);
  assert.equal(chunks.flatMap((chunk) => chunk.entries).length, 2);
  assert.deepEqual(chunks.flatMap((chunk) => chunk.entries).map((entry) => entry.sequence), [1, 2]);
});

test("ledger removes dangerous keys before recording an event", () => {
  const ledger = new SessionLedger();
  ledger.start("s1");
  const entry = ledger.append("diagnostic", { text: "visible", apiKey: "secret", token: "secret" });
  assert.deepEqual(entry.data, { text: "visible" });
});
```

- [ ] **Step 2: Run the test and verify module-not-found failure.**

Run: `node --test desktop/test/session-ledger.test.js`

- [ ] **Step 3: Implement the minimal ledger.**

```js
class SessionLedger {
  constructor({ maxEntries = 1200 } = {}) {
    this.maxEntries = maxEntries;
    this.current = null;
  }

  start(sessionId) {
    const generation = this.current?.sessionId === sessionId ? this.current.generation : (this.current?.generation || 0) + 1;
    this.current = { sessionId: String(sessionId), generation, entries: [], nextSequence: 1 };
    return this.snapshot(sessionId);
  }

  append(type, data) { /* sanitize deep values, append, and trim oldest entries */ }
  snapshot(sessionId) { /* return { sessionId, generation, firstSequence, lastSequence, entries } */ }
  chunks(sessionId, maxBytes) { /* return ordered arrays whose JSON byte size is <= maxBytes */ }
  clear(sessionId) { if (this.current?.sessionId === sessionId) this.current = null; }
}
```

Sanitization drops `apiKey`, `api_key`, `token`, `authorization`, `secret`, and values nested beneath those keys. Keep only JSON-safe objects, arrays, strings, numbers, booleans, and null.

- [ ] **Step 4: Run the ledger test.**

Run: `node --test desktop/test/session-ledger.test.js`

Expected: all ledger tests pass.

### Task 2: Main Process Recording and Targeted Sync

**Files:**
- Modify: `desktop/src/main.js`
- Modify: `desktop/src/control-server.js`
- Modify: `desktop/test/control-server.test.js`
- Create: `desktop/test/mobile-session-sync-main-contract.test.js`

**Consumes:** `SessionLedger`, existing `send`, `runtimeSnapshot`, and control-server authenticated actions.

**Produces:** `session-sync-request`, `session-sync-begin`, `session-sync-chunk`, and `session-sync-complete` messages targeted to one authenticated socket.

- [ ] **Step 1: Write failing main-process contract tests.**

Assert that `main.js` creates one ledger, starts it on new/load session boundaries, appends normalized `agent:update`, task status, and user message events, and handles `case "session-sync-request"`. Assert `control-server.js` exposes a targeted `send(socket, type, data)` method separate from `broadcast`.

- [ ] **Step 2: Run focused contract tests and verify the new assertions fail.**

Run: `node --test desktop/test/mobile-session-sync-main-contract.test.js desktop/test/control-server.test.js`

- [ ] **Step 3: Add targeted delivery in the control server.**

```js
send(socket, type, data) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify({ type, data }));
  return true;
}
```

Pass the authenticated socket to `onAction(action, payload, socket)` while retaining existing action behavior.

- [ ] **Step 4: Add ledger lifecycle and sync handling in `main.js`.**

Create `const sessionLedger = new SessionLedger();`. Start it after a session is created or immediately before a session replay begins. Record sanitized normalized messages before broadcasting them. In the control action handler, validate that requested `sessionId` equals `runtimeSnapshot().sessionId`; otherwise return `{ ok: false, error: { message: "会话已切换，请重新同步", code: "STALE_SESSION" } }`.

For a valid request, send:

```js
controlServer.send(socket, "session-sync-begin", {
  sessionId, generation: snapshot.generation,
  firstSequence: snapshot.firstSequence, lastSequence: snapshot.lastSequence,
  chunkCount: chunks.length,
});
for (let index = 0; index < chunks.length; index += 1) {
  controlServer.send(socket, "session-sync-chunk", { sessionId, generation: snapshot.generation, index, entries: chunks[index] });
}
controlServer.send(socket, "session-sync-complete", { sessionId, generation: snapshot.generation, lastSequence: snapshot.lastSequence });
```

Use a chunk size below `MAX_WS_PAYLOAD`, reserving protocol overhead. Do not call `loadSession` from this handler.

- [ ] **Step 5: Run focused tests.**

Run: `node --test desktop/test/session-ledger.test.js desktop/test/mobile-session-sync-main-contract.test.js desktop/test/control-server.test.js`

Expected: all pass.

### Task 3: Mobile Replay State Machine

**Files:**
- Modify: `desktop/src/mobile/app.js`
- Modify: `desktop/src/mobile/index.html`
- Modify: `desktop/src/mobile/styles.css`
- Create: `desktop/test/mobile-session-sync.test.js`

**Consumes:** initial `state`, live renderer events, and the targeted sync message sequence.

**Produces:** complete replay on connect, de-duplicated live updates, visible retry sync state, and stable bottom positioning.

- [ ] **Step 1: Write failing mobile protocol tests.**

Test a pure helper exported from a browser-compatible `mobile-session-sync-policy.js`: it accepts begin/chunk/complete messages, rejects out-of-order chunks, tracks `(sessionId, generation, sequence)`, and returns buffered events newer than completion. Include reconnect deduplication and stale-session retry cases.

- [ ] **Step 2: Implement the pure mobile sync policy and run its tests.**

```js
function createSyncState() { return { active: null, seen: new Set(), liveBuffer: [] }; }
function beginSync(state, data) { /* reset only for a new session/generation */ }
function acceptChunk(state, data) { /* require next index and return ordered entries */ }
function completeSync(state, data) { /* return buffered entries with larger sequence */ }
function acceptLive(state, entry) { /* buffer during sync or return an unseen entry */ }
```

Run: `node --test desktop/test/mobile-session-sync.test.js`

- [ ] **Step 3: Wire the WebSocket messages.**

On receiving `state`, request `session-sync-request` once per `(sessionId, generation)` after runtime rendering. On `session-sync-begin`, clear the message surface through the existing session-loading path. On each chunk, feed entries through the same message/update render path used for live `agent-update`. On complete, apply buffered events, call `settleConversationAtBottom()`, and clear the loading indicator.

Render a compact sync status above the timeline. When chunk ordering fails or the server returns `STALE_SESSION`, retain existing rendered entries and expose a Retry sync action. The action requests the current runtime session again.

- [ ] **Step 4: Run mobile tests and existing mobile layout tests.**

Run: `node --test desktop/test/mobile-session-sync.test.js desktop/test/mobile-layout.test.js desktop/test/ux-policy.test.js`

Expected: all pass.

### Task 4: Desktop IDE Navigation Shell

**Files:**
- Modify: `desktop/src/renderer/index.html`
- Modify: `desktop/src/renderer/renderer.js`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/test/ux-policy.test.js`
- Create: `desktop/test/desktop-ide-shell.test.js`

**Consumes:** existing workspace list, session list, theme state, settings actions, and sidebar persistence.

**Produces:** resizable IDE navigation, independent workspace expansion, nested conversation rows, top actions, and bottom service/settings controls.

- [ ] **Step 1: Write failing desktop DOM and persistence tests.**

Assert the sidebar has top action navigation, a `workspace-tree`, a `workspace-tree-node`, a nested `workspace-session-list`, and bottom service controls. Assert renderer source stores `grok-desktop.workspace-tree-state` and `grok-desktop.sidebar-width`, and CSS declares 220-360 pixel constraints plus a 48-pixel collapsed rail.

- [ ] **Step 2: Run tests and verify the contracts fail.**

Run: `node --test desktop/test/desktop-ide-shell.test.js desktop/test/ux-policy.test.js`

- [ ] **Step 3: Replace flat workspace/recent markup with an IDE shell.**

Keep existing IDs for action buttons so business event listeners continue to work. Add top action buttons for New task, Search, Automations, and Skills. Replace the separate workspace and recent-session blocks with one tree container. Keep account, remote control, and settings buttons at the bottom. Move provider, usage, extensions, and work monitor access into settings/command surfaces without removing IDs or handlers.

- [ ] **Step 4: Render nested sessions and persist tree state.**

Implement `loadWorkspaceTreeState`, `saveWorkspaceTreeState`, `toggleWorkspaceTreeNode`, and `renderWorkspaceTree`. Group sessions by normalized `cwd`; create a tree node for every remembered workspace even if it has no sessions. Expanded state defaults to true for the active workspace and false for inactive workspaces. Selecting a nested session calls the existing `loadSession` path.

- [ ] **Step 5: Add theme-aware IDE CSS.**

Use CSS variables for shell colors. The sidebar defaults to 268 pixels, has `min-width: 220px`, `max-width: 360px`, and a draggable resize handle. Collapsed mode uses a 48-pixel rail. Preserve rounded glass cards for chat message surfaces and the composer, but use compact tree rows and editor-style header spacing for navigation. Keep all desktop text within its grid tracks.

- [ ] **Step 6: Run desktop contract tests.**

Run: `node --test desktop/test/desktop-ide-shell.test.js desktop/test/ux-policy.test.js desktop/test/session-policy.test.js`

Expected: all pass.

### Task 5: End-to-End QA and Packaging

**Files:**
- Modify: `desktop/scripts/qa-desktop.js`
- Modify: `desktop/package.json`
- Generated: `desktop/qa-desktop-ide-shell.png`, `desktop/qa-mobile-session-sync.png`, Windows artifacts in `desktop/dist`

- [ ] **Step 1: Add visual and synchronization QA fixtures.**

Extend the desktop fixture with three workspaces, nested sessions, an expanded active workspace, a collapsed sidebar, and a custom theme/background. Add a mock mobile connection that receives pre-existing ledger entries followed by a live event before sync-complete; assert ordered, non-duplicated rendering and final bottom position.

- [ ] **Step 2: Run QA and inspect screenshots.**

Run: `.\node_modules\.bin\electron.cmd .\scripts\qa-desktop.js`

Expected: desktop 1440x900 IDE shell, narrow desktop, phone, iPad portrait, and iPad landscape screenshots have no overlap, clipping, blank view, or duplicate timeline entries.

- [ ] **Step 3: Run complete test and backend suites.**

Run: `npm test`

Run: `npm run test:backend`

Expected: all tests and backend smoke pass.

- [ ] **Step 4: Bump patch version and build.**

Raise the desktop version by one patch after all verification succeeds. Run `npm run dist:win`, then record SHA-256 hashes for the Setup and Portable artifacts. Verify the unpacked `app.asar` contains the new version and no backend executable.
