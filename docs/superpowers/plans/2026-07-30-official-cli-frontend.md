# Official CLI Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Windows app into an Electron frontend that requires a user-installed official Grok Build CLI and exposes safe manual CLI updates.

**Architecture:** A new main-process backend manager persists only a selected executable path, validates it through child-process calls, and owns update execution. The preload surface exposes narrow IPC methods to desktop renderer settings; the renderer never receives raw command output. Packaging removes the Rust/backend staging step and bundled executable.

**Tech Stack:** Electron 40, Node.js child process APIs, native Electron dialog/shell, Node test runner, Electron Builder.

## Global Constraints

- Never launch `resources/bin/grok.exe`, Rust build output, or a bundled backend fallback.
- Use only a user-selected executable or `grok.exe` resolved from `PATH`.
- Call the official CLI's `version`, `agent stdio --help`, `update --check --json`, and `update` commands; do not download a binary in Electron.
- Do not expose executable paths or raw update output to the mobile protocol.
- Preserve current custom API-key environment injection when starting `agent stdio`.

---

### Task 1: Backend manager and unit tests

**Files:**
- Create: `desktop/src/official-cli.js`
- Create: `desktop/test/official-cli.test.js`
- Modify: `desktop/src/main.js`

**Interfaces:**
- Produces `OfficialCliStore`, `validateOfficialCli(path)`, and `parseUpdateStatus(stdout)`.
- `main.js` consumes the manager to resolve the selected executable and run updates.

- [ ] **Step 1: Write failing tests**

Cover: empty store has no backend; `PATH` discovery returns `grok.exe`; validation rejects missing/non-zero `version` or missing `stdio` command; successful validation returns `{ path, version }`; JSON update output is reduced to `currentVersion`, `latestVersion`, `updateAvailable`, `channel`, `installer`, and `error`; malformed JSON rejects safely.

- [ ] **Step 2: Run focused test and verify failure**

Run: `$env:ELECTRON_RUN_AS_NODE='1'; & '.\\node_modules\\electron\\dist\\electron.exe' --test test\\official-cli.test.js`

Expected: failure because `official-cli.js` does not exist.

- [ ] **Step 3: Implement the minimal manager**

Persist `{ executablePath }` in `app.getPath('userData')`; invoke `execFile` with a timeout and hidden window; parse a `grok <version>` result and `agent stdio --help`; accept only absolute existing paths or the literal `grok.exe` discovered through PATH. Store only after a successful validation.

- [ ] **Step 4: Remove fallback selection from main process**

Replace `backendCandidates()`/`resolveBackend()` with the manager's saved/discovered official candidate. `startAgentOnce` must fail with a specific official-CLI-required error when no validated backend exists.

- [ ] **Step 5: Run focused tests**

Run the command in step 2. Expected: all official CLI tests pass.

### Task 2: Restricted IPC and update lifecycle

**Files:**
- Modify: `desktop/src/main.js`
- Modify: `desktop/src/preload.js`
- Test: `desktop/test/official-cli.test.js`

**Interfaces:**
- Renderer calls `getOfficialCli`, `chooseOfficialCli`, `testOfficialCli`, `checkOfficialCliUpdate`, and `installOfficialCliUpdate`.
- Every handler returns `{ ok, data }` or `{ ok: false, error }` using existing IPC error conventions.

- [ ] **Step 1: Extend failing tests**

Add assertions that update checks execute `update --check --json`, installer output is sanitized, and install stops the active ACP client before launching `update`. Assert no mobile message type carries an executable path or update output.

- [ ] **Step 2: Run focused test and verify failure**

Run the command from Task 1 step 2. Expected: new IPC/update assertions fail.

- [ ] **Step 3: Implement IPC**

Use `dialog.showOpenDialog` with `grok.exe` filtering for selection. Map check output through `parseUpdateStatus`. On install, require a renderer confirmation flag, call `stopAgent`, run the selected CLI with `update`, capture diagnostic output to the lifecycle log, validate the executable again, and return only a sanitized result.

- [ ] **Step 4: Expose only explicit methods in preload**

Add the five methods to `window.grokDesktop`; do not alter the mobile WebSocket API.

- [ ] **Step 5: Run focused tests**

Run the command from Task 1 step 2. Expected: all tests pass.

### Task 3: Desktop settings and connection states

**Files:**
- Modify: `desktop/src/renderer/index.html`
- Modify: `desktop/src/renderer/renderer.js`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/test/usability-contract.test.js`
- Modify: `desktop/scripts/qa-desktop.js`

**Interfaces:**
- Settings UI consumes the five preload methods.
- It displays a sanitized `OfficialCliStatus` object only.

- [ ] **Step 1: Write failing UI contract tests**

Require IDs for CLI path/version/status, choose/test/check-update/install-update controls, an update confirmation dialog, and an official installer link. Require renderer calls to the new preload APIs and QA coverage for the missing-backend and update states.

- [ ] **Step 2: Run focused UI test and verify failure**

Run: `$env:ELECTRON_RUN_AS_NODE='1'; & '.\\node_modules\\electron\\dist\\electron.exe' --test test\\usability-contract.test.js`

Expected: missing controls and renderer integrations.

- [ ] **Step 3: Implement the settings section**

Add a compact account-settings block with selected official CLI status, choose, validate, check update, and install update commands. Disable install when no update is available. Present missing/incompatible/update errors as user copy, keep technical output in diagnostics, and open `https://x.ai/cli` using the existing external-link IPC.

- [ ] **Step 4: Implement confirmation and state refresh**

Show a modal confirmation before installation. After selection, validation, or update, refresh the settings status and render disconnected state until the user reconnects.

- [ ] **Step 5: Extend Electron QA**

Stub official-CLI IPC results; capture the settings screen; assert no-backend copy, successful selected status, update availability, and confirmation behavior.

- [ ] **Step 6: Run focused UI and Electron QA**

Run the focused test then `.\\node_modules\\.bin\\electron.cmd .\\scripts\\qa-desktop.js`. Expected: pass and produce nonblank captures.

### Task 4: Remove bundled backend and verify packages

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/README.md`
- Modify: `desktop/test/usability-contract.test.js`
- Delete: `desktop/scripts/stage-backend.ps1`

- [ ] **Step 1: Write the failing packaging contract**

Assert `dist:win` does not call `stage:backend`, Electron Builder has no `extraResources` entry for `bin/grok.exe`, and README states that official Grok Build must be installed separately.

- [ ] **Step 2: Run the focused contract test and verify failure**

Run the command from Task 3 step 2. Expected: legacy staging/bundling assertions fail.

- [ ] **Step 3: Remove staging and bundled executable configuration**

Set `dist:win` directly to Electron Builder, remove `stage:backend`, `extraResources`, and the staging script. Update user documentation with installation, executable selection, connection, and manual update guidance.

- [ ] **Step 4: Run complete verification**

Run all Node tests and Electron QA. Build using `npm run dist:win`. Verify `dist\\win-unpacked\\resources\\bin\\grok.exe` does not exist and that both Windows artifacts exist.
