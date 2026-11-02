# Shared Avatars, Prompt Recovery, and Model Checks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add synchronized local avatars, safe canceled-prompt recovery and historical prompt reuse, plus isolated fast and real checks for configured models.

**Architecture:** Focused CommonJS modules own avatar persistence, prompt recovery state, and protocol-specific model probes. Electron main process composes those modules and publishes only safe state through IPC/control-server snapshots; desktop and mobile renderers consume the same state.

**Tech Stack:** Electron 40, Node.js 22, vanilla JavaScript/HTML/CSS, WebSocket control server, Node test runner.

## Global Constraints

- Preserve ACP as the chat backend and do not switch or contaminate the active session during model checks.
- Keep login and third-party API models available together.
- Store avatars locally and use one user avatar plus one AI avatar globally across all models and clients.
- Preserve existing prompt queue, interruption, remote pairing, Tailscale, themes, and responsive iPad behavior.
- Never expose decrypted API keys outside the Electron main process.
- Real model checks must be explicitly selected and may consume only a minimal amount of credit.
- The workspace has no valid Git repository, so commit steps are intentionally omitted.

---

### Task 1: Avatar Store and Runtime Contract

**Files:**
- Create: `desktop/src/avatar-store.js`
- Create: `desktop/test/avatar-store.test.js`
- Modify: `desktop/src/main.js`
- Modify: `desktop/src/preload.js`

**Interfaces:**
- Produces: `new AvatarStore({ directory })`, `getAll()`, `set(role, pngBuffer)`, `reset(role)`.
- Produces IPC: `avatars:get`, `avatars:choose`, and `avatars:reset`.
- Runtime snapshot adds `avatars: { user: string|null, assistant: string|null }`.

- [ ] Write tests that reject unknown roles, persist bounded PNG buffers, return data URLs, and reset one role without changing the other.
- [ ] Run `node --test test/avatar-store.test.js` and verify failure because the module is absent.
- [ ] Implement the minimal filesystem store and rerun the focused test to green.
- [ ] Add main-process image selection/crop/resize, IPC handlers, preload methods, and runtime snapshot publication.
- [ ] Run the focused test and existing control-server tests.

### Task 2: Desktop and Mobile Avatar UI

**Files:**
- Modify: `desktop/src/renderer/index.html`
- Modify: `desktop/src/renderer/renderer.js`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/mobile/app.js`
- Modify: `desktop/src/mobile/styles.css`
- Modify: `desktop/test/usability-contract.test.js`

**Interfaces:**
- Consumes runtime `avatars` and desktop preload avatar methods.
- Produces `.message-avatar` image/fallback rendering on desktop and mobile/iPad.

- [ ] Extend contract tests for avatar controls and shared runtime avatar use.
- [ ] Run the contract test and verify the missing controls fail.
- [ ] Add compact appearance controls and message-avatar rendering with letter fallback.
- [ ] Apply runtime avatar changes to existing rendered messages without reloading.
- [ ] Run the contract and full Node test suites.

### Task 3: Canceled Prompt Recovery State

**Files:**
- Create: `desktop/src/prompt-recovery.js`
- Create: `desktop/test/prompt-recovery.test.js`
- Modify: `desktop/src/main.js`
- Modify: `desktop/src/preload.js`

**Interfaces:**
- Produces: `begin(prompt, source)`, `finish()`, `cancel({ recover })`, `summary()`, and `consume()`.
- Produces IPC/control action `prompt-recovery:consume` / `recover-prompt`.

- [ ] Write tests for active prompt capture, explicit-cancel recovery, queue interruption exclusion, one-shot consume, summaries without attachment payloads, and safe cloning.
- [ ] Run the focused test and verify failure because the module is absent.
- [ ] Implement the state object and rerun the focused test to green.
- [ ] Integrate begin/finish/cancel semantics into prompt execution and publish `recoverablePrompt` in runtime snapshots.
- [ ] Run prompt queue, prompt content, recovery, and control-server tests.

### Task 4: Composer Recovery and Historical Prompt Reuse

**Files:**
- Modify: `desktop/src/renderer/index.html`
- Modify: `desktop/src/renderer/renderer.js`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/mobile/index.html`
- Modify: `desktop/src/mobile/app.js`
- Modify: `desktop/src/mobile/styles.css`
- Modify: `desktop/test/usability-contract.test.js`

**Interfaces:**
- Consumes recovery summary/action and existing prompt history/rewind APIs.
- Produces edit actions for user messages, restore strips, and reliable current-session rewind-and-edit.

- [ ] Add failing contract assertions for desktop/mobile recovery strips and user-message edit behavior.
- [ ] Implement empty-composer automatic recovery while preserving non-empty drafts.
- [ ] Add edit controls to live and replayed user messages on desktop/mobile.
- [ ] Merge current-session prompt history with rewind points by index and add destructive confirmation before rewind-and-edit.
- [ ] Run focused and full Node tests.

### Task 5: Model Probe Policy and Provider Resolution

**Files:**
- Create: `desktop/src/model-probe.js`
- Create: `desktop/test/model-probe.test.js`
- Modify: `desktop/src/model-config.js`
- Modify: `desktop/test/model-config.test.js`

**Interfaces:**
- Produces: `buildQuickRequest(model)`, `buildRealRequest(model)`, `runModelProbe(model, mode, options)`, and sanitized result objects.
- Produces model-store method `resolveModel(providerId, modelId)` containing the decrypted key for main-process use only.

- [ ] Write model-store tests for exact provider/model resolution and missing-key failures.
- [ ] Write probe tests for all three protocols, endpoint normalization, minimal bodies, reachability/auth classification, response parsing, timeout, latency, and secret redaction.
- [ ] Run both focused tests and verify missing APIs fail.
- [ ] Implement minimal resolution and probe helpers using injected `fetch` and clock functions.
- [ ] Rerun focused tests and refactor only after green.

### Task 6: Model Check IPC and UI

**Files:**
- Modify: `desktop/src/main.js`
- Modify: `desktop/src/preload.js`
- Modify: `desktop/src/renderer/index.html`
- Modify: `desktop/src/renderer/renderer.js`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/test/usability-contract.test.js`

**Interfaces:**
- Produces IPC `models:check(providerId, modelId, mode)`.
- Produces structured dialog result with provider, model, mode, latency, status, summary, and technical details.

- [ ] Add failing contract assertions for a model check action, mode controls, credit warning, progress state, and technical details.
- [ ] Add guarded main-process IPC that resolves secrets internally and calls the isolated probe.
- [ ] Add model-row check buttons and a two-mode result dialog with explicit real-request warning.
- [ ] Prevent double submission and preserve the previous result until a new check starts.
- [ ] Run focused and full Node tests.

### Task 7: End-to-End Verification and Packaging

**Files:**
- Modify: `desktop/scripts/qa-desktop.js`
- Modify: `desktop/test/usability-contract.test.js`

**Interfaces:**
- QA covers avatar previews, recovery strips, user prompt edit action, model check modes/results, and iPad panel layout.

- [ ] Add failing QA contract assertions for the new desktop/mobile/iPad states.
- [ ] Extend Electron QA fixtures and screenshots for the new states.
- [ ] Run `npm test` and require all tests to pass.
- [ ] Run `npm run test:backend` and Electron desktop/mobile/iPad QA.
- [ ] Run `npm run dist:win`, inspect packaged ASAR contents, and calculate SHA-256 hashes for Setup and Portable artifacts.

