# Grok Usage Compatibility and Task Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept Grok/OpenAI-compatible Responses payloads with omitted token detail objects and make prompt start, completion, interruption, and failure visibly reliable on desktop, phone, and iPad.

**Architecture:** The Rust sampler normalizes only missing `usage` detail objects on its existing compatibility retry path. Electron owns a small, testable task lifecycle state machine; `main.js` broadcasts its events through IPC and the control server. Both renderers consume the same event and runtime snapshot to display a compact composer-adjacent status strip plus durable per-message progress state.

**Tech Stack:** Rust, serde_json, Node.js built-in test runner, Electron IPC, WebSocket control server, plain HTML/CSS/JavaScript, Lucide.

## Global Constraints

- Keep the ACP CLI backend, model/login configuration, prompt queue, remote pairing, permissions, themes, and iPad layout unchanged.
- Use page feedback only: no sound, Windows notification, or taskbar flashing.
- Token-detail defaults are `cached_tokens: 0` and `reasoning_tokens: 0`, only when those fields are absent.
- A task terminal state remains visible in the composer status strip for exactly 5,000 ms.
- A canceled task can never later transition to completed or failed.
- This workspace is not a valid Git repository; do not attempt commits.

---

### Task 1: Normalize Missing Responses Usage Details

**Files:**

- Modify: `crates/codegen/xai-grok-sampler/src/client.rs:117-255, 2750-3100`

**Interfaces:**

- Consumes: terminal streaming event JSON and non-streaming `rs::Response` JSON.
- Produces: `fill_missing_response_object_fields(response, requested_model)` that also makes omitted token-detail objects compatible with async-openai.

- [ ] **Step 1: Write failing regression tests**

Add two tests beside `deserialize_response_event_accepts_missing_output`: one `response.completed` fixture omitting both `input_tokens_details` and `output_tokens_details`, and one non-streaming body fixture with the same omissions. Keep aggregate fields present and assert the parsed usage exposes zeros:

```rust
assert_eq!(usage.input_tokens_details.cached_tokens, 0);
assert_eq!(usage.output_tokens_details.reasoning_tokens, 0);
```

- [ ] **Step 2: Run the focused tests and confirm they fail because `output_tokens_details` is missing**

Run:

```powershell
cargo test -p xai-grok-sampler deserialize_response_event_accepts_missing_usage_details -- --nocapture
```

Expected: a serialization failure naming `output_tokens_details` before the compatibility implementation exists.

- [ ] **Step 3: Implement the minimum compatibility normalization**

Extend `fill_missing_response_object_fields` so the existing stream and non-stream compatibility paths share this exact behavior:

```rust
if let Some(usage) = response.get_mut("usage").and_then(|value| value.as_object_mut()) {
    usage
        .entry("input_tokens_details")
        .or_insert_with(|| serde_json::json!({ "cached_tokens": 0 }));
    usage
        .entry("output_tokens_details")
        .or_insert_with(|| serde_json::json!({ "reasoning_tokens": 0 }));
}
```

- [ ] **Step 4: Run the focused sampler tests**

Run:

```powershell
cargo test -p xai-grok-sampler deserialize_response_event -- --nocapture
```

Expected: all `deserialize_response_event*` tests pass, including the new fixture.

### Task 2: Add a Testable Task Lifecycle State Machine

**Files:**

- Create: `desktop/src/task-lifecycle.js`
- Create: `desktop/test/task-lifecycle.test.js`

**Interfaces:**

- Produces: `TaskLifecycle` with `start(source)`, `complete(id)`, `fail(id)`, `interrupt()`, `snapshot()`, `isInterrupted(id)`, and `clear()`.
- Event shape: `{ id, state, source, timestamp }`, where state is `started`, `completed`, `interrupted`, or `failed`.
- Consumed by: `desktop/src/main.js`.

- [ ] **Step 1: Write failing lifecycle tests**

Test these real state transitions using injected `createId` and `now`:

```js
const lifecycle = new TaskLifecycle({ createId: () => "turn-1", now: () => 42 });
assert.deepEqual(lifecycle.start("mobile"), {
  id: "turn-1", state: "started", source: "mobile", timestamp: 42,
});
assert.equal(lifecycle.interrupt().state, "interrupted");
assert.equal(lifecycle.complete("turn-1"), null);
assert.equal(lifecycle.fail("turn-1"), null);
```

Also cover idle cancel, duplicate terminal calls, a new turn after a prior terminal turn, and defensive snapshot cloning.

- [ ] **Step 2: Run the test and confirm module resolution fails**

Run:

```powershell
node --test desktop/test/task-lifecycle.test.js
```

Expected: failure because `../src/task-lifecycle` does not exist.

- [ ] **Step 3: Implement the minimal lifecycle class**

Use one active-or-last event field, returning `null` for invalid/duplicate terminal transitions:

```js
start(source) {
  this.current = { id: this.createId(), state: "started", source: String(source || "desktop"), timestamp: this.now() };
  return this.snapshot();
}

finish(id, state) {
  if (!this.current || this.current.id !== id || this.current.state !== "started") return null;
  this.current = { ...this.current, state, timestamp: this.now() };
  return this.snapshot();
}
```

Expose `complete`, `fail`, and `interrupt` as thin wrappers. `snapshot()` must return a shallow clone so renderer payload mutation cannot alter source state.

- [ ] **Step 4: Run the lifecycle test**

Run:

```powershell
node --test desktop/test/task-lifecycle.test.js
```

Expected: all lifecycle transition tests pass.

### Task 3: Broadcast Prompt Lifecycle From the Main Process

**Files:**

- Modify: `desktop/src/main.js:1-35, 186-231, 314-320, 799-854`
- Modify: `desktop/src/preload.js:80-105`
- Modify: `desktop/test/control-server.test.js`

**Interfaces:**

- Consumes: `TaskLifecycle` events.
- Produces: Electron `agent:task-status`, control-server `task-status`, and runtime `task` snapshot property.
- Renderer API: `window.grokDesktop.onTaskStatus(callback)`.
- Mobile wire event: `{ type: "task-status", data: { id, state, source, timestamp } }`.

- [ ] **Step 1: Add failing control-server/runtime contract tests**

Extend `desktop/test/control-server.test.js` with assertions that a runtime state may include a `task` object and that `task-status` is a recognized broadcast event. Add a source-contract assertion that preload exposes `onTaskStatus`.

- [ ] **Step 2: Run the focused Node tests and confirm the contract is absent**

Run:

```powershell
node --test desktop/test/control-server.test.js desktop/test/usability-contract.test.js
```

Expected: assertion failure for `task-status` or `onTaskStatus`.

- [ ] **Step 3: Wire lifecycle events through `main.js` and preload**

Import and instantiate the state machine beside `PromptQueue`. Add `task: taskLifecycle.snapshot()` to `runtimeSnapshot()` and map the IPC channel to the mobile event:

```js
function emitTaskStatus(event) {
  if (!event) return null;
  send("agent:task-status", event);
  broadcastRuntime();
  return event;
}
```

In `executePrompt`, emit `started` before `client.request`, `completed` only after a normal resolve, and `failed` only from a rejection that has not already been interrupted. In `cancelPrompt`, call `emitTaskStatus(taskLifecycle.interrupt())` before returning. In the ACP exit handler, call `emitTaskStatus(taskLifecycle.fail(taskLifecycle.snapshot()?.id))` before broadcasting disconnected status. Add this preload entry:

```js
onTaskStatus: (callback) => subscribe("agent:task-status", callback),
```

- [ ] **Step 4: Run focused Node tests**

Run:

```powershell
node --test desktop/test/task-lifecycle.test.js desktop/test/control-server.test.js
```

Expected: state transitions and control-server contracts pass without duplicate terminal events.

### Task 4: Render Task Feedback on Desktop, Phone, and iPad

**Files:**

- Modify: `desktop/src/renderer/index.html:160-205`
- Modify: `desktop/src/renderer/renderer.js:35-80, 650-675, 2600-2670`
- Modify: `desktop/src/renderer/styles.css:879-905, 1047-1155`
- Modify: `desktop/src/mobile/index.html:110-155`
- Modify: `desktop/src/mobile/app.js:40-80, 260-330, 830-850, 990-1030`
- Modify: `desktop/src/mobile/styles.css:528-550, 709-835`
- Modify: `desktop/test/usability-contract.test.js`

**Interfaces:**

- Consumes: `onTaskStatus` IPC event, mobile `task-status` WebSocket event, and `runtime.task`.
- Produces: composer-adjacent `#task-status` / `#mobile-task-status` with `data-state`, an icon, and a label.
- In-message progress adds `interrupted` alongside existing `complete` and `failed` states.

- [ ] **Step 1: Write failing renderer contract tests**

Extend `usability-contract.test.js` to require desktop `task-status`, mobile `mobile-task-status`, both lifecycle subscription strings, and `interrupted` in both `setTurnProgress` label maps.

- [ ] **Step 2: Run renderer contract tests and confirm the new controls are missing**

Run:

```powershell
node --test desktop/test/usability-contract.test.js
```

Expected: missing task-status IDs and task lifecycle subscription assertions.

- [ ] **Step 3: Add compact accessible markup and CSS**

Place a hidden `role="status"` strip immediately above each composer. Its dynamic state maps to Lucide `loader-circle`, `circle-check`, `square`, and `triangle-alert`; avoid text buttons. Style it as a single-line, constrained-width glass control with blue/green/amber/red states. Keep the terminal strip for 5,000 ms, and add `.turn-progress.interrupted .turn-progress-dot` amber styling.

- [ ] **Step 4: Add shared renderer behavior**

In each renderer, implement `renderTaskStatus(task)` that clears a prior hide timer, updates `data-state`, swaps the Lucide icon and Chinese label, calls `lucide.createIcons`, and schedules hiding for `5_000 - (Date.now() - task.timestamp)` on terminal states. Handle both live task events and runtime snapshots. Update `setTurnProgress` with `interrupted: "任务已中断"`; terminal events update the active assistant progress when it exists, without creating an empty assistant message.

- [ ] **Step 5: Run renderer tests**

Run:

```powershell
node --test desktop/test/usability-contract.test.js desktop/test/mobile-layout.test.js
```

Expected: desktop, phone, and iPad structure contracts pass.

### Task 5: Verify Integrated Behavior and Package Windows Clients

**Files:**

- Modify only if automated QA snapshots or contract selectors require a minimal update: `desktop/scripts/qa-desktop.js`

- [ ] **Step 1: Run all desktop unit and contract tests**

Run:

```powershell
node --test desktop/test/*.test.js
```

Expected: every Node test passes.

- [ ] **Step 2: Run Rust sampler regression coverage**

Run:

```powershell
cargo test -p xai-grok-sampler deserialize_response_event -- --nocapture
```

Expected: all focused Responses compatibility tests pass.

- [ ] **Step 3: Run backend and Electron visual smoke checks**

Run:

```powershell
npm --prefix desktop run test:backend
.\node_modules\.bin\electron.cmd .\scripts\qa-desktop.js
```

Expected: backend smoke plus desktop, mobile, and iPad screenshots complete without blank or overlapping task status controls.

- [ ] **Step 4: Build installable Windows artifacts**

Run:

```powershell
npm --prefix desktop run dist:win
```

Expected: `desktop/dist/Grok-Build-Setup-0.1.0-x64.exe` and `desktop/dist/Grok-Build-Portable-0.1.0-x64.exe` are created.
