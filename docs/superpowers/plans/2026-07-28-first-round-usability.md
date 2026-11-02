# First-Round Client Usability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve long-running Grok tasks on desktop and mobile with stable scrolling, lower rendering overhead, readable execution stages, actionable errors, clearer permission prompts, startup health feedback, and explicit queue/interrupt behavior.

**Architecture:** Add a browser/CommonJS `ux-policy.js` helper for deterministic interaction decisions and human-readable presentation. Desktop and mobile keep their existing ACP/WebSocket data paths, but consume the shared policy for scroll following, error descriptions, permission impact, connection health, and composer state. UI changes remain inside the existing renderer/mobile documents and styles; no Rust CLI or protocol behavior changes.

**Tech Stack:** Electron 40, Node.js test runner, HTML5 dialogs, vanilla JavaScript, CSS, existing Lucide/Marked/DOMPurify dependencies.

## Global Constraints

- Do not change the Rust CLI backend, ACP wire protocol, authentication flow, provider configuration format, pairing tokens, Tailscale addressing, or Android package.
- Preserve the existing prompt queue, interrupt action, attachments, session replay, model switching, themes, tray, and iPad panel behavior.
- Never force the conversation to the bottom while the user is reading older content.
- Streaming output must remain visible within 150 ms while reducing repeated Markdown and tool-result rendering.
- Raw backend errors and permission arguments must be available on demand but not be the primary user-facing copy.
- Desktop and mobile must expose equivalent core behavior, while startup health details remain desktop-focused.
- The workspace is not a valid Git repository, so commit and worktree steps are intentionally omitted.

---

### Task 1: Shared UX Policy

**Files:**
- Create: `desktop/src/ux-policy.js`
- Create: `desktop/test/ux-policy.test.js`
- Modify: `desktop/src/renderer/index.html`
- Modify: `desktop/src/mobile/index.html`
- Modify: `desktop/src/control-server.js`
- Modify: `desktop/test/control-server.test.js`

**Interfaces:**
- Produces: `isNearBottom(metrics, thresholdPx = 96) -> boolean`
- Produces: `describeError(value) -> { title, guidance, details, kind }`
- Produces: `describePermission(request) -> { level, label, summary, details }`
- Produces: `describeHealth(runtime) -> Array<{ id, label, state, detail }>`
- Produces: `describeComposer({ connected, busy, editing, hasContent }) -> { mode, hint, sendLabel, disabled }`
- Exposes browser global: `globalThis.GrokUxPolicy`

- [ ] **Step 1: Write failing policy tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const policy = require("../src/ux-policy");

test("conversation follow policy respects user scroll position", () => {
  assert.equal(policy.isNearBottom({ scrollTop: 800, clientHeight: 200, scrollHeight: 1050 }), true);
  assert.equal(policy.isNearBottom({ scrollTop: 400, clientHeight: 200, scrollHeight: 1050 }), false);
});

test("technical failures become actionable user copy", () => {
  const result = policy.describeError('serialization error: missing field `output`');
  assert.equal(result.kind, "serialization");
  assert.match(result.title, /响应格式/);
  assert.match(result.guidance, /重试|模型/);
  assert.match(result.details, /missing field/);
});

test("permission and composer states explain their impact", () => {
  assert.equal(policy.describePermission({ toolCall: { title: "删除文件", rawInput: "Remove-Item a.txt" } }).level, "high");
  assert.equal(policy.describeComposer({ connected: true, busy: true, editing: false, hasContent: true }).mode, "queue");
  assert.equal(policy.describeComposer({ connected: true, busy: true, editing: true, hasContent: true }).mode, "save");
});
```

- [ ] **Step 2: Run `C:\useful\nodejs\node.exe --test test/ux-policy.test.js` and verify RED because the module is absent.**

- [ ] **Step 3: Implement a UMD-style pure helper** using the existing `mobile-layout.js` wrapper pattern. Normalize non-string errors with safe JSON serialization, recognize serialization/auth/timeout/network/permission failures, classify destructive permission text (`delete`, `remove`, `write`, `move`, `删除`, `覆盖`) as high impact, and derive health rows for backend/workspace/account/model.

- [ ] **Step 4: Load `/ux-policy.js` before application scripts** in both documents and serve it from `ControlServer.allowedStaticFile()`.

- [ ] **Step 5: Extend the control-server page test** to fetch `/ux-policy.js` and assert it contains `GrokUxPolicy`.

- [ ] **Step 6: Run focused tests and verify GREEN.**

---

### Task 2: Smart Follow and Stream Rendering

**Files:**
- Modify: `desktop/src/renderer/index.html`
- Modify: `desktop/src/renderer/renderer.js`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/mobile/index.html`
- Modify: `desktop/src/mobile/app.js`
- Modify: `desktop/src/mobile/styles.css`
- Modify: `desktop/scripts/qa-desktop.js`

**Interfaces:**
- Produces DOM IDs: `jump-to-latest`, `mobile-jump-to-latest`
- Produces renderer state: `autoFollow: boolean`, `hasUnseenUpdates: boolean`
- Consumes: `GrokUxPolicy.isNearBottom()`

- [ ] **Step 1: Add failing QA source assertions** for both jump buttons and for calls to `GrokUxPolicy.isNearBottom`.

- [ ] **Step 2: Verify QA assertions fail before implementation.**

- [ ] **Step 3: Add a floating latest button** above each composer. On conversation scroll, set `autoFollow` from current metrics. New output scrolls only when `autoFollow` is true; otherwise it reveals the latest button without moving the viewport. Clicking the button restores follow mode and scrolls to the bottom.

- [ ] **Step 4: Change stream rendering cadence** from 50 ms to 100 ms for Markdown/thought output and 120 ms for tool presentation. Finalization still flushes immediately, keeping visible latency below 150 ms.

- [ ] **Step 5: Reset follow state** when creating/loading/clearing a conversation, but do not reset it for tool updates or panel resize.

- [ ] **Step 6: Run Electron QA at desktop, phone, iPad portrait, and iPad landscape sizes.** Assert the latest button is hidden at the bottom, appears after simulating an upward scroll plus a new update, and does not overlap the composer.

---

### Task 3: Turn Timeline and Completion Summary

**Files:**
- Modify: `desktop/src/renderer/renderer.js`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/mobile/app.js`
- Modify: `desktop/src/mobile/styles.css`
- Modify: `desktop/scripts/qa-desktop.js`

**Interfaces:**
- Each assistant turn owns one `.turn-progress` element with states `responding`, `tools`, `complete`, `failed`.
- Existing tool cards and final answer stay inside the same assistant turn.

- [ ] **Step 1: Add failing QA assertions** that a representative assistant turn contains one progress row, tool cards before `.final-answer`, and a completed state after `turn_completed`.

- [ ] **Step 2: Verify RED.**

- [ ] **Step 3: Add the progress row in `ensureAssistant()`** with concise copy: `正在响应`, `正在执行工具`, `正在整理结果`, `回答完成`, or `执行失败`.

- [ ] **Step 4: Update stage transitions** from thought/message/tool/final/error events. Keep thoughts visually subdued, tool results collapsed by default, and add a small `最终回答` label only when a tool-using turn ends with assistant text.

- [ ] **Step 5: Run QA and visually inspect the tool-results desktop and mobile captures.**

---

### Task 4: Actionable Error Cards

**Files:**
- Modify: `desktop/src/renderer/renderer.js`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/mobile/app.js`
- Modify: `desktop/src/mobile/styles.css`
- Modify: `desktop/scripts/qa-desktop.js`

**Interfaces:**
- Consumes: `GrokUxPolicy.describeError()`
- Produces: dismissible `.error-card` with summary, guidance, collapsed details, and copy action.

- [ ] **Step 1: Add failing QA assertions** that a serialization failure renders readable summary/guidance, keeps raw text inside a closed `details`, and contains copy/dismiss controls.

- [ ] **Step 2: Verify RED.**

- [ ] **Step 3: Replace `showError()` banners** with structured cards. Deduplicate by normalized technical details, set the current assistant turn to failed, and never print raw JSON as the headline.

- [ ] **Step 4: Add a retry action only where a concrete retry callback exists** (`connectAgent`, billing refresh, session refresh); keep generic errors to copy/dismiss so the UI never promises a retry it cannot perform.

- [ ] **Step 5: Run QA and focused Node tests.**

---

### Task 5: Permission and Startup Health UX

**Files:**
- Modify: `desktop/src/renderer/index.html`
- Modify: `desktop/src/renderer/renderer.js`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/mobile/index.html`
- Modify: `desktop/src/mobile/app.js`
- Modify: `desktop/src/mobile/styles.css`
- Modify: `desktop/scripts/qa-desktop.js`

**Interfaces:**
- Consumes: `GrokUxPolicy.describePermission()` and `describeHealth()`.
- Produces DOM IDs: `startup-health`, `permission-risk`, `permission-target`, `mobile-permission-risk`, `mobile-permission-target`.

- [ ] **Step 1: Add failing QA assertions** for health rows and permission impact/target fields.

- [ ] **Step 2: Verify RED.**

- [ ] **Step 3: Add a compact startup health block** to the desktop empty state. Render backend, workspace, account/API, and model as ready/waiting/problem states. Hide the block once a conversation has content, while keeping the sidebar connection indicator unchanged.

- [ ] **Step 4: Present permission impact before raw arguments.** Show risk badge and human summary, place exact command/JSON in a collapsed `details`, disable buttons while submitting, and show `正在提交确认` until the backend acknowledges it.

- [ ] **Step 5: Mirror permission behavior on mobile** and show `等待你确认` in task state while the permission dialog is open.

- [ ] **Step 6: Run QA for disconnected, ready, and permission-pending states.**

---

### Task 6: Explicit Queue, Save, and Interrupt States

**Files:**
- Modify: `desktop/src/renderer/index.html`
- Modify: `desktop/src/renderer/renderer.js`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/src/mobile/index.html`
- Modify: `desktop/src/mobile/app.js`
- Modify: `desktop/src/mobile/styles.css`
- Modify: `desktop/scripts/qa-desktop.js`

**Interfaces:**
- Consumes: `GrokUxPolicy.describeComposer()`
- Produces DOM IDs: `composer-submit-mode`, `mobile-composer-submit-mode`, `cancel-queue-edit`, `mobile-cancel-queue-edit`.

- [ ] **Step 1: Add failing QA assertions** for normal `发送`, busy `加入待执行`, editing `保存修改`, and the visible queue-edit cancel action.

- [ ] **Step 2: Verify RED.**

- [ ] **Step 3: Render an explicit composer mode label** beside the workspace context. Keep the icon send button, but update its title/ARIA label and visual state from the policy.

- [ ] **Step 4: Add cancel-edit actions** that restore an empty draft without mutating the queued prompt. Keep the existing separate interrupt-send button and label it `打断并发送`.

- [ ] **Step 5: Show model/provider and attachment count on queued items** using the snapshot fields already available; omit unavailable metadata rather than inventing defaults.

- [ ] **Step 6: Run focused QA for normal, busy, queue-edit, and attachment queue states.**

---

### Task 7: Regression, Visual QA, and Windows Packaging

**Files:**
- Modify: `desktop/scripts/qa-desktop.js`
- Generate: `desktop/qa-desktop-usability.png`
- Generate: `desktop/qa-mobile-usability.png`
- Generate: Windows Setup and Portable artifacts under `desktop/dist/`

- [ ] **Step 1: Run all desktop Node tests** with PowerShell-expanded test paths and record exact pass/fail totals.

- [ ] **Step 2: Run Electron QA** at `320x700`, `430x850`, `768x1024`, `1024x768`, `1224x768`, and `1366x1024`.

- [ ] **Step 3: Inspect screenshots at original resolution** for clipping, overlap, unreadable text, accidental forced scrolling, and blank output.

- [ ] **Step 4: Run `npm run dist:win`** because packaged renderer/mobile assets changed.

- [ ] **Step 5: Verify ASAR contents** include `ux-policy.js` and updated renderer/mobile assets.

- [ ] **Step 6: Report artifact paths, sizes, SHA-256 hashes, timestamps, test count, QA exit code, and Authenticode status.**

## Deferred Roadmap

The navigation reorganization, persistent session sidebar, richer workspace management, provider presets, attachment drag/drop, paired-device management, terminology cleanup, accessibility controls, and additional theme controls remain separate P1/P2 projects. They are intentionally excluded from this first implementation to keep the ACP/runtime regression surface bounded.

## Execution Status

Completed on 2026-07-28. Tasks 1-7 were implemented inline in the current workspace using TDD. Final verification: 49 Node tests passed with 0 failures; Electron desktop/mobile/iPad QA exited with code 0; Setup and Portable packages were rebuilt; packaged ASAR contents include `src/ux-policy.js` and the updated renderer/mobile assets. The step checkboxes above are retained as the original execution checklist, while this status section records the completed run.
