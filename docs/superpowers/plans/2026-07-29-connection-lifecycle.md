# Connection Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent concurrent connection requests from terminating a newer Grok backend and expose backend lifecycle evidence.

**Architecture:** The renderer keeps a local connection-in-flight guard. The Electron main process assigns every backend start a generation and only the active generation may mutate global connection state or clean up a client. Lifecycle events are emitted through the existing diagnostic channel.

**Tech Stack:** Electron, Node.js `node:test`, ACP stdio backend.

## Global Constraints

- Keep ACP login/API configuration and remote-control behavior unchanged.
- Use the existing `agent:diagnostic` channel for visible diagnostics.
- Do not let a stale start request stop a newer client.

---

### Task 1: Regression Coverage

**Files:**
- Modify: `desktop/test/acp-client.test.js`
- Modify: `desktop/test/usability-contract.test.js`

- [ ] Add a failing test for intentional-stop metadata and lifecycle diagnostics.
- [ ] Add a failing source-level contract for a renderer connection guard and main-process generation ownership.
- [ ] Run `npm test` from `desktop` and confirm the new assertions fail before implementation.

### Task 2: Connection Ownership

**Files:**
- Modify: `desktop/src/acp-client.js`
- Modify: `desktop/src/main.js`
- Modify: `desktop/src/renderer/renderer.js`

- [ ] Add intentional-stop state and structured lifecycle diagnostics to `AcpClient`.
- [ ] Add main-process connection generation ownership and stale-request protection.
- [ ] Add the renderer in-flight guard and clear it only when the awaited request settles.
- [ ] Run the focused test suite and confirm it passes.

### Task 3: Release Verification

**Files:**
- Modify: `desktop/scripts/qa-desktop.js` only if the existing QA cannot exercise the guarded state.

- [ ] Run `npm test` and `npm run test:backend` from `desktop`.
- [ ] Run the Electron QA script and inspect the generated desktop and mobile screenshots.
- [ ] Build the Windows installer and portable package.
