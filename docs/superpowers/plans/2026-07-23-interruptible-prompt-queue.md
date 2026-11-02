# Interruptible Prompt Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make prompts submitted during execution visible, editable, removable, reorderable, and able to interrupt the current turn safely.

**Architecture:** Move queue state into a focused `PromptQueue` module with stable IDs. The main process remains the single source of truth, exposes queue operations to Electron and mobile actions, and broadcasts the full sanitized queue in runtime snapshots.

**Tech Stack:** Node.js 22, Electron IPC, WebSocket control server, vanilla HTML/CSS/JavaScript, `node:test`.

## Global Constraints

- Ordinary send queues while busy; interruption must be an explicit action.
- Do not start the interrupting prompt until the current request has actually settled.
- Clear composer content only after the computer acknowledges receipt.
- Desktop and mobile operate on one computer-owned queue.

---

### Task 1: Tested Prompt Queue Domain

**Files:**
- Create: `desktop/src/prompt-queue.js`
- Create: `desktop/test/prompt-queue.test.js`

**Interfaces:**
- Produces: `new PromptQueue({ createId, now })`.
- Produces: `enqueue(prompt, source, options)`, `list()`, `takeNext()`, `update(id, prompt)`, `remove(id)`, `move(id, delta)`, `prioritize(id)`, and `clear()`.

- [ ] Write failing tests for stable IDs, sanitized list output, update, delete, bounds-safe movement and prioritization.
- [ ] Run `C:\useful\nodejs\node.exe --test test/prompt-queue.test.js`; expect module-not-found failure.
- [ ] Implement the smallest queue class that passes the tests.
- [ ] Add tests for attachment metadata and defensive copies, then run the test file green.

### Task 2: Main Process Scheduling And APIs

**Files:**
- Modify: `desktop/src/main.js`
- Modify: `desktop/src/preload.js`

**Interfaces:**
- Consumes: `PromptQueue` from Task 1.
- Produces IPC/actions for `prompt-queue:update`, `prompt-queue:remove`, `prompt-queue:move`, `prompt-queue:interrupt`, and `prompt-queue:clear`.
- Extends runtime snapshot with `promptQueue` while retaining `queueLength` compatibility.

- [ ] Replace the array queue with `PromptQueue`; return the queued item from `acceptPrompt`.
- [ ] Make runtime snapshots include sanitized queue items and broadcast after every mutation.
- [ ] Implement edit/delete/move/clear for desktop IPC and mobile `handleControlAction`.
- [ ] Implement interrupt as prioritize plus cancel notification; let the existing `finally` path start the prioritized item only after settlement.
- [ ] Ensure stopping the agent clears the queue and ordinary cancel leaves it intact.
- [ ] Run Node syntax checks and all queue tests.

### Task 3: Desktop Queue Controls

**Files:**
- Modify: `desktop/src/renderer/index.html`
- Modify: `desktop/src/renderer/renderer.js`
- Modify: `desktop/src/renderer/styles.css`

**Interfaces:**
- Consumes runtime `promptQueue` and queue IPC methods.
- Produces a queue strip above the composer and an explicit interrupt-send button.

- [ ] Add a hidden queue region with list and clear action above the composer.
- [ ] Render summary, attachment count, edit, delete, move and interrupt icon actions for each item.
- [ ] Preserve composer text/attachments until `api.prompt` succeeds; restore them on failure without overwriting newer typing.
- [ ] Add explicit interrupt-send behavior while busy.
- [ ] Add compact responsive styles and tooltips for icon-only controls.

### Task 4: Mobile Queue Controls

**Files:**
- Modify: `desktop/src/mobile/index.html`
- Modify: `desktop/src/mobile/app.js`
- Modify: `desktop/src/mobile/styles.css`

**Interfaces:**
- Consumes runtime `promptQueue` and mobile queue actions.
- Produces the same queue operations and interrupt-send action on narrow screens.

- [ ] Render the synchronized queue above the mobile composer.
- [ ] Add edit, delete, movement and interrupt controls with touch-safe fixed sizes.
- [ ] Preserve composer input until action acknowledgement and restore on error.
- [ ] Keep queue controls usable without hidden gestures.

### Task 5: End-To-End Verification

**Files:**
- Test: `desktop/test/*.test.js`
- Verify: `desktop/scripts/qa-desktop.js`

- [ ] Run all desktop Node tests and backend smoke tests.
- [ ] Run Electron QA and verify a queued prompt remains visible and editable.
- [ ] Verify desktop and mobile receive identical queue snapshots through the control server.
- [ ] Verify interrupt sends exactly once after the active request settles.
