# Plan Approval and Adaptive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make official Grok Build plan approval work across desktop and mobile clients, and reorganize the UI into a focused new-task page and a dense execution page without changing the theme system.

**Architecture:** A small policy module owns `x.ai/exit_plan_mode` normalization and response serialization. The Electron main process owns pending approval identity, includes uncompleted approvals in the runtime snapshot, and broadcasts changes through existing desktop IPC and mobile WebSocket paths. A browser-loadable UMD layout policy is shared by both renderers and Node tests. Renderers add a dedicated plan-review modal plus a state-only layout marker that switches the existing conversation surface between welcome and active-task layouts.

**Tech Stack:** Electron 40, Node.js built-in test runner, vanilla browser JavaScript/CSS/HTML, WebSocket control server, official Grok Build ACP CLI.

## Global Constraints

- Preserve all existing themes, background image controls, avatars, custom model providers, pairing, and iPad panel persistence.
- Support direct and gateway-wrapped `x.ai/exit_plan_mode` requests.
- Never answer a plan approval while a modal is merely dismissed, while offline, or with blank revision feedback.
- Use `requestId` for the active ACP response and `toolCallId` for cross-client/replay identity.
- Keep phone single-column behavior and existing iPad landscape/portrait thresholds.
- Do not implement `x.ai/ask_user_question` in this change.
- Increase `desktop/package.json` version to `0.1.3` only after all tests and QA pass.
- This checkout has no usable Git repository metadata; record each completed task in this plan and use test output as the review checkpoint instead of making commits.

---

## File Structure

- `desktop/src/plan-approval-policy.js`: Pure protocol parsing, validation, and response serialization.
- `desktop/test/plan-approval-policy.test.js`: Unit tests for direct/wrapped request normalization and all response variants.
- `desktop/src/main.js`: ACP routing, pending request bookkeeping, runtime snapshot replay, IPC, mobile broadcasts, and first-answer-wins replies.
- `desktop/test/control-server.test.js`: WebSocket action concurrency regression coverage.
- `desktop/src/preload.js`: Minimal plan approval subscribe/reply bridge for the desktop renderer.
- `desktop/src/renderer/index.html`, `renderer.js`, `styles.css`: Desktop plan-review modal and state-adaptive desktop layout.
- `desktop/src/mobile/index.html`, `app.js`, `styles.css`: Mobile/iPad plan-review modal and state-adaptive central panel.
- `desktop/src/layout-policy.js`: UMD welcome/active layout decision helper for browser and Node tests.
- `desktop/test/layout-policy.test.js`: Layout policy and state preservation tests.
- `desktop/test/ux-policy.test.js`: DOM contract checks for the new modal and layout markers.
- `desktop/scripts/qa-desktop.js`: Desktop, phone, and iPad visual exercise cases.
- `desktop/package.json`: Release version after verification.

### Task 1: Plan Approval Protocol Policy

**Files:**

- Create: `desktop/src/plan-approval-policy.js`
- Create: `desktop/test/plan-approval-policy.test.js`

**Consumes:** JSON-RPC request envelopes or `params` values emitted by the ACP client.

**Produces:**

```js
normalizePlanApprovalRequest(value) // { sessionId, toolCallId, planContent }
planApprovalResult(outcome, feedback) // ACP response object
isPlanApprovalMethod(method) // boolean
```

- [ ] **Step 1: Write failing normalization and serialization tests.**

```js
const { normalizePlanApprovalRequest, planApprovalResult, isPlanApprovalMethod } = require("../src/plan-approval-policy");

test("wrapped plan approval unpacks the official extension payload", () => {
  const request = normalizePlanApprovalRequest({
    method: "_x.ai/exit_plan_mode",
    params: {
      method: "x.ai/exit_plan_mode",
      params: { sessionId: "s1", toolCallId: "t1", planContent: "# Plan" },
    },
  });
  assert.deepEqual(request, { sessionId: "s1", toolCallId: "t1", planContent: "# Plan" });
});

test("plan decisions serialize exactly as the official response type", () => {
  assert.deepEqual(planApprovalResult("approved"), { outcome: "approved" });
  assert.deepEqual(planApprovalResult("cancelled", "add tests"), { outcome: "cancelled", feedback: "add tests" });
  assert.deepEqual(planApprovalResult("abandoned"), { outcome: "abandoned" });
  assert.throws(() => planApprovalResult("cancelled", "  "), /feedback/i);
});
```

- [ ] **Step 2: Run the new test and verify it fails because the module is missing.**

Run: `node --test desktop/test/plan-approval-policy.test.js`

Expected: `MODULE_NOT_FOUND` for `../src/plan-approval-policy`.

- [ ] **Step 3: Implement the minimal pure policy module.**

```js
const PLAN_APPROVAL_METHOD = "x.ai/exit_plan_mode";

function unwrap(value) {
  const outer = value && typeof value === "object" ? value : {};
  if (outer.params && typeof outer.params === "object") {
    return outer.params.method && outer.params.params ? outer.params.params : outer.params;
  }
  return outer;
}

function normalizePlanApprovalRequest(value) {
  const request = unwrap(value);
  const sessionId = request.sessionId ?? request.session_id;
  const toolCallId = request.toolCallId ?? request.tool_call_id;
  if (!sessionId || !toolCallId) throw new Error("Plan approval request is missing sessionId or toolCallId");
  return { sessionId: String(sessionId), toolCallId: String(toolCallId), planContent: typeof request.planContent === "string" ? request.planContent : null };
}

function planApprovalResult(outcome, feedback) {
  if (outcome === "approved" || outcome === "abandoned") return { outcome };
  if (outcome === "cancelled" && typeof feedback === "string" && feedback.trim()) return { outcome, feedback: feedback.trim() };
  throw new Error("Cancelled plan approval requires non-empty feedback");
}

function isPlanApprovalMethod(method) {
  return String(method || "").replace(/^_/, "") === PLAN_APPROVAL_METHOD;
}

module.exports = { PLAN_APPROVAL_METHOD, isPlanApprovalMethod, normalizePlanApprovalRequest, planApprovalResult };
```

- [ ] **Step 4: Run the policy test and the existing permission policy test.**

Run: `node --test desktop/test/plan-approval-policy.test.js desktop/test/permission-policy.test.js`

Expected: all tests pass.

- [ ] **Step 5: Review checkpoint.**

Confirm that wrapper unwrapping is limited to one ACP extension envelope, `planContent` may be `null`, and no arbitrary outcome can reach the main process.

### Task 2: Main Process Routing and First-Answer-Wins Replies

**Files:**

- Modify: `desktop/src/main.js:44,267-286,381-410,1013-1126,1749-1750`
- Modify: `desktop/src/preload.js:73-104`
- Modify: `desktop/test/control-server.test.js`
- Create: `desktop/test/plan-approval-main-contract.test.js`

**Consumes:** `normalizePlanApprovalRequest`, `planApprovalResult`, existing `reverseRequests`, `send`, and the mobile `handleControlAction` protocol.

**Produces:**

```js
replyPlanApproval(id, outcome, feedback) // boolean
agent:plan-approval // desktop IPC event
plan-approval // mobile WebSocket event
plan-approval-reply // mobile control action
agent:plan-approval-reply // desktop IPC method
```

- [ ] **Step 1: Write the failing main-process contract tests.**

```js
test("main process exposes plan approval IPC and mobile routes", () => {
  const source = fs.readFileSync(path.join(desktopRoot, "src", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(desktopRoot, "src", "preload.js"), "utf8");
  assert.match(source, /x\.ai\/exit_plan_mode/);
  assert.match(source, /function replyPlanApproval\(id, outcome, feedback\)/);
  assert.match(source, /case "plan-approval-reply"/);
  assert.match(source, /"agent:plan-approval": "plan-approval"/);
  assert.match(preload, /replyPlanApproval: \(id, outcome, feedback\)/);
  assert.match(preload, /onPlanApproval:/);
});
```

Add a control-server test matching the existing permission concurrency test: leave a `prompt` action unresolved, submit `plan-approval-reply`, and assert that it returns before the prompt completes.

- [ ] **Step 2: Run the new tests and verify the route assertions fail.**

Run: `node --test desktop/test/plan-approval-main-contract.test.js desktop/test/control-server.test.js`

Expected: contract failure because no plan approval route exists.

- [ ] **Step 3: Add pending approval state and ACP request routing.**

At module scope add `const planApprovalsById = new Map();` and `const planApprovalIdByToolCall = new Map();`. Import the policy helpers. Extend `runtimeSnapshot()` with `planApprovals: [...planApprovalsById.values()]` so a mobile client that refreshes receives the still-pending request in its first `state` event. In `wireClient` request handling, place the branch before the unknown-method response:

```js
if (isPlanApprovalMethod(message.method)) {
  const request = normalizePlanApprovalRequest(message);
  const priorId = planApprovalIdByToolCall.get(request.toolCallId);
  if (priorId && priorId !== message.id) {
    reverseRequests.delete(priorId);
    planApprovalsById.delete(priorId);
  }
  const pending = { id: message.id, ...request, receivedAt: Date.now() };
  reverseRequests.set(message.id, "x.ai/exit_plan_mode");
  planApprovalsById.set(message.id, pending);
  planApprovalIdByToolCall.set(request.toolCallId, message.id);
  send("agent:plan-approval", pending);
  return;
}
```

Do not clear `planApprovalIdByToolCall` merely because an ACP transport closes. When a replayed request arrives, replace its live `requestId` while retaining the stable `toolCallId`. Clear all pending plan state only when the user deliberately starts a different session or the current session changes.

- [ ] **Step 4: Add one guarded reply path and transport adapters.**

```js
function replyPlanApproval(id, outcome, feedback) {
  if (!client || reverseRequests.get(id) !== "x.ai/exit_plan_mode") return false;
  const pending = planApprovalsById.get(id);
  if (!pending) return false;
  client.respond(id, planApprovalResult(outcome, feedback));
  reverseRequests.delete(id);
  planApprovalsById.delete(id);
  planApprovalIdByToolCall.delete(pending.toolCallId);
  send("control:interaction-resolved", { id, toolCallId: pending.toolCallId });
  return true;
}
```

Add `agent:plan-approval` to `mobileChannels`, `plan-approval-reply` to `handleControlAction`, `agent:plan-approval-reply` to IPC handlers, and `replyPlanApproval` / `onPlanApproval` to preload. Treat policy validation errors as action errors so the renderer can keep the modal open and display a retry message. When a mobile socket receives a runtime `state`, it must call the same plan display function for the first item in `runtime.planApprovals`; the live event and snapshot path must deduplicate by `toolCallId`.

- [ ] **Step 5: Make cancellation and session changes safe.**

Keep `cancelPrompt` restricted to permission requests. Add a helper that emits `interaction-resolved` with both identifiers when explicitly discarding a plan due to new-session/session-load replacement. Never send `abandoned` implicitly.

- [ ] **Step 6: Run the focused test set.**

Run: `node --test desktop/test/plan-approval-policy.test.js desktop/test/plan-approval-main-contract.test.js desktop/test/control-server.test.js`

Expected: all tests pass, including the action submitted while a prompt is running.

- [ ] **Step 7: Review checkpoint.**

Confirm that only `replyPlanApproval` calls `client.respond` for plan requests, the first valid reply deletes the live id, and unknown methods still receive `-32601`.

### Task 3: Desktop Plan Review Modal

**Files:**

- Modify: `desktop/src/renderer/index.html:749-781`
- Modify: `desktop/src/renderer/renderer.js:16-110,1250-1325,2888-2901`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/test/ux-policy.test.js`

**Consumes:** `api.onPlanApproval`, `api.replyPlanApproval`, and `interaction-resolved` payload `{ id, toolCallId }`.

**Produces:** A modal with `showPlanApproval`, `submitPlanApproval`, and `hidePlanApproval` behavior.

- [ ] **Step 1: Write failing desktop UI contract tests.**

```js
test("desktop UI includes a dedicated plan approval dialog", () => {
  const html = fs.readFileSync(path.join(rendererRoot, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(rendererRoot, "renderer.js"), "utf8");
  assert.match(html, /id="plan-approval-dialog"/);
  assert.match(html, /id="plan-approval-content"/);
  assert.match(html, /id="plan-approval-feedback"/);
  assert.match(html, /id="approve-plan"/);
  assert.match(html, /id="revise-plan"/);
  assert.match(html, /id="abandon-plan"/);
  assert.match(js, /function showPlanApproval\(request\)/);
});
```

- [ ] **Step 2: Run the contract test and verify it fails.**

Run: `node --test desktop/test/ux-policy.test.js`

Expected: missing plan approval dialog assertion.

- [ ] **Step 3: Add the dialog markup.**

Add a sibling of the permission dialog:

```html
<dialog id="plan-approval-dialog" class="modal plan-approval-modal">
  <form method="dialog" class="modal-body plan-approval-body">
    <div class="modal-copy">
      <p class="eyebrow">计划审批</p>
      <h2>确认下一步执行方案</h2>
      <p id="plan-approval-session" class="permission-status"></p>
      <article id="plan-approval-content" class="plan-approval-content"></article>
      <label class="field-label" for="plan-approval-feedback">修改意见</label>
      <textarea id="plan-approval-feedback" placeholder="说明需要调整的内容"></textarea>
      <p id="plan-approval-status" class="permission-status"></p>
    </div>
    <div class="modal-actions plan-approval-actions">
      <button id="abandon-plan" class="danger-command" type="button">放弃计划</button>
      <button id="revise-plan" class="secondary-command" type="button">提出修改意见</button>
      <button id="approve-plan" class="primary-command" type="button">批准并执行</button>
    </div>
  </form>
</dialog>
```

- [ ] **Step 4: Implement renderer state and replies.**

Add `pendingPlanApproval: null` to `state`, DOM references to `elements`, then implement:

```js
function showPlanApproval(request) {
  state.pendingPlanApproval = request;
  elements.planApprovalSession.textContent = request.workspaceName || request.sessionId;
  elements.planApprovalContent.innerHTML = renderMarkdown(request.planContent || "# 未提供计划内容");
  elements.planApprovalFeedback.value = "";
  elements.planApprovalStatus.textContent = "请选择批准、提出修改意见或放弃计划";
  elements.planApprovalDialog.showModal();
}

async function submitPlanApproval(outcome) {
  const pending = state.pendingPlanApproval;
  if (!pending) return;
  const feedback = elements.planApprovalFeedback.value.trim();
  if (outcome === "cancelled" && !feedback) {
    elements.planApprovalStatus.textContent = "请先填写修改意见";
    return;
  }
  const response = await api.replyPlanApproval(pending.id, outcome, feedback);
  if (!response) return showTurnError("计划审批已失效，请等待重新同步");
}
```

Use the existing sanitized Markdown path rather than raw HTML. Disable all three action buttons while a reply is pending, restore them on failure, and close only after a successful reply or matching `interaction-resolved`. The dialog `cancel` handler must `preventDefault()` and only hide the dialog; it must not call `submitPlanApproval`.

- [ ] **Step 5: Add CSS with stable scrolling and action sizing.**

```css
.plan-approval-modal { width: min(760px, calc(100vw - 32px)); }
.plan-approval-body { max-height: min(820px, calc(100dvh - 32px)); }
.plan-approval-content { max-height: min(48dvh, 480px); overflow: auto; padding: 14px; border: 1px solid var(--line); border-radius: 8px; background: rgb(255 255 255 / 30%); }
.plan-approval-actions { grid-template-columns: auto auto minmax(150px, 1fr); }
```

Use existing CSS variables for all colors. Ensure long code blocks and tables scroll inside the preview rather than expanding the dialog.

- [ ] **Step 6: Run desktop UI contract tests.**

Run: `node --test desktop/test/ux-policy.test.js desktop/test/plan-approval-main-contract.test.js`

Expected: all tests pass.

### Task 4: Mobile and iPad Plan Review Modal

**Files:**

- Modify: `desktop/src/mobile/index.html:173-199`
- Modify: `desktop/src/mobile/app.js:16-95,266-316,1143-1211,1388-1403`
- Modify: `desktop/src/mobile/styles.css`
- Modify: `desktop/test/ux-policy.test.js`

**Consumes:** mobile WebSocket event `plan-approval`, action `plan-approval-reply`, and `interaction-resolved` `{ id, toolCallId }`.

**Produces:** `showPlanApproval` and a safe fixed action area for phone and iPad.

- [ ] **Step 1: Add failing mobile UI contract assertions.**

```js
assert.match(mobileHtml, /id="mobile-plan-approval-dialog"/);
assert.match(mobileHtml, /id="mobile-plan-approval-content"/);
assert.match(mobileJs, /case "plan-approval":/);
assert.match(mobileJs, /sendAction\("plan-approval-reply"/);
```

- [ ] **Step 2: Run the contract test and verify it fails.**

Run: `node --test desktop/test/ux-policy.test.js`

Expected: missing mobile plan approval markup assertion.

- [ ] **Step 3: Add a separate mobile modal and state.**

```html
<dialog id="mobile-plan-approval-dialog" class="modal mobile-plan-approval-modal">
  <div class="modal-content mobile-plan-approval-content">
    <p class="eyebrow">计划审批</p>
    <h2>确认执行方案</h2>
    <article id="mobile-plan-approval-content" class="plan-approval-content"></article>
    <textarea id="mobile-plan-approval-feedback" placeholder="输入修改意见"></textarea>
    <p id="mobile-plan-approval-status" class="permission-status"></p>
    <div class="modal-actions mobile-plan-approval-actions">
      <button id="mobile-abandon-plan" class="danger-button" type="button">放弃计划</button>
      <button id="mobile-revise-plan" class="secondary-button" type="button">要求修改</button>
      <button id="mobile-approve-plan" class="primary-button" type="button">批准执行</button>
    </div>
  </div>
</dialog>
```

Add `pendingPlanApproval` to mobile state. In the socket message switch call `showPlanApproval(data)` for `plan-approval`; in `interaction-resolved` close it when either id or toolCallId matches. Use `renderMarkdown` and DOMPurify exactly as existing message rendering does.

- [ ] **Step 4: Add reply controls and cancellation behavior.**

```js
async function replyPlanApproval(outcome) {
  const pending = state.pendingPlanApproval;
  const feedback = elements.planApprovalFeedback.value.trim();
  if (outcome === "cancelled" && !feedback) return setPlanApprovalStatus("请填写修改意见");
  await sendAction("plan-approval-reply", { id: pending.id, outcome, feedback });
}
```

Disable controls during send. On error retain the modal and re-enable controls. Intercept dialog cancel to close visually without sending an outcome. Do not change iPad panel open/closed state when the dialog opens.

- [ ] **Step 5: Add viewport-safe CSS.**

```css
.mobile-plan-approval-modal { width: min(100%, 720px); max-width: 100%; }
.mobile-plan-approval-content { max-height: calc(100dvh - 24px); }
.mobile-plan-approval-content .plan-approval-content { min-height: 180px; max-height: calc(100dvh - 330px); overflow: auto; }
.mobile-plan-approval-actions { position: sticky; bottom: 0; padding-bottom: max(10px, env(safe-area-inset-bottom)); }
```

Verify the three controls wrap into a vertical stack under the existing phone breakpoint, but stay in one row on iPad landscape.

- [ ] **Step 6: Run mobile contracts.**

Run: `node --test desktop/test/ux-policy.test.js desktop/test/control-server.test.js`

Expected: all tests pass.

### Task 5: Pure Desktop Layout State Policy

**Files:**

- Create: `desktop/src/layout-policy.js`
- Create: `desktop/test/layout-policy.test.js`

**Consumes:** Current message count and task activity; it must not read or write the DOM.

**Produces:**

```js
conversationLayout({ messageCount, busy, queueLength }) // "welcome" | "active"
```

- [ ] **Step 1: Write a failing state policy test.**

```js
const { conversationLayout } = require("../src/layout-policy");

test("new task stays welcome until a message, task, or queue exists", () => {
  assert.equal(conversationLayout({ messageCount: 0, busy: false, queueLength: 0 }), "welcome");
  assert.equal(conversationLayout({ messageCount: 1, busy: false, queueLength: 0 }), "active");
  assert.equal(conversationLayout({ messageCount: 0, busy: true, queueLength: 0 }), "active");
  assert.equal(conversationLayout({ messageCount: 0, busy: false, queueLength: 1 }), "active");
});
```

- [ ] **Step 2: Run the new policy test and verify the missing-module failure.**

Run: `node --test desktop/test/layout-policy.test.js`

Expected: `MODULE_NOT_FOUND` for `../src/layout-policy`.

- [ ] **Step 3: Implement the pure policy.**

```js
(function exposeLayoutPolicy(global) {
  function conversationLayout({ messageCount = 0, busy = false, queueLength = 0 } = {}) {
    return Number(messageCount) > 0 || Boolean(busy) || Number(queueLength) > 0 ? "active" : "welcome";
  }
  const api = { conversationLayout };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.GrokLayoutPolicy = api;
}(typeof globalThis === "undefined" ? this : globalThis));
```

- [ ] **Step 4: Run the policy test.**

Run: `node --test desktop/test/layout-policy.test.js`

Expected: all tests pass.

### Task 6: Desktop Welcome and Execution Layout

**Files:**

- Modify: `desktop/src/renderer/index.html:14-225`
- Modify: `desktop/src/renderer/renderer.js:16-110,1200-1325,2821-2917`
- Modify: `desktop/src/renderer/styles.css:122-175,692-755,1136-1410`
- Modify: `desktop/test/ux-policy.test.js`

**Consumes:** `conversationLayout`, existing `clearConversation`, `createMessage`, task status, prompt queue, attachments, and theme variables.

**Produces:** Root `data-conversation-layout="welcome|active"`, an adaptive central content width, and a compact left navigation hierarchy.

- [ ] **Step 1: Write failing layout DOM and policy integration tests.**

```js
test("desktop renderer declares welcome and active layout hooks", () => {
  const html = fs.readFileSync(path.join(rendererRoot, "index.html"), "utf8");
  const js = fs.readFileSync(path.join(rendererRoot, "renderer.js"), "utf8");
  assert.match(html, /data-conversation-layout="welcome"/);
  assert.match(html, /class="welcome-shortcuts"/);
  assert.match(js, /conversationLayout\(/);
  assert.match(js, /document\.documentElement\.dataset\.conversationLayout/);
});
```

- [ ] **Step 2: Run the UI test and verify it fails.**

Run: `node --test desktop/test/ux-policy.test.js desktop/test/layout-policy.test.js`

Expected: layout hook assertion failure.

- [ ] **Step 3: Add non-marketing welcome markup and preserve existing composer controls.**

Wrap the existing empty state content in a `welcome-stage`. Replace the large diagnostic card with compact status rows that remain available through settings. Add no more than three command buttons in `welcome-shortcuts`; each must call an existing user action such as choosing a workspace, opening history, or opening the model configuration. Do not duplicate a model selector or add a second composer.

Load `../layout-policy.js` before `renderer.js` in the desktop HTML and `/layout-policy.js` before `app.js` in the mobile HTML; extend the control-server static routing only if its existing root module mapping does not already expose that file. Set `data-conversation-layout="welcome"` on the central workspace root in markup. Add an `updateConversationLayout()` renderer function:

```js
function updateConversationLayout() {
  const messageCount = elements.messageList.children.length;
  const layout = conversationLayout({ messageCount, busy: state.busy, queueLength: state.queueLength });
  document.documentElement.dataset.conversationLayout = layout;
}
```

Call it after conversation clear/create, runtime updates, queue rendering, and task-status updates. It must not modify `elements.input.value`, `state.attachments`, or `state.promptQueue`.

- [ ] **Step 4: Add adaptive CSS.**

Use selectors on the root layout state:

```css
:root[data-conversation-layout="welcome"] .conversation { display: grid; place-items: center; }
:root[data-conversation-layout="welcome"] .composer-band { padding-bottom: clamp(22px, 7vh, 72px); }
:root[data-conversation-layout="welcome"] .composer { width: min(680px, 100%); }
:root[data-conversation-layout="active"] .composer { width: min(920px, 100%); }
:root[data-conversation-layout="active"] .message-list { width: min(920px, 100%); margin: 0 auto; }
```

Keep the existing glass variables. The welcome stage should have no floating outer card; only the composer and optional shortcut cards are framed. On the active state remove oversized empty-state spacing and keep tool output scrollable within the main timeline.

- [ ] **Step 5: Reorganize left navigation without removing features.**

Move the existing recent-session list under the workspace list and label it as recent conversations. Retain access to model/API, billing, extensions, task monitor, account/privacy, and settings through a compact secondary menu. Add an icon-only collapse control with `title`, `aria-controls`, and locally persisted state. In collapsed mode hide text labels but preserve click targets and tooltip names.

- [ ] **Step 6: Run desktop logic and contract tests.**

Run: `node --test desktop/test/layout-policy.test.js desktop/test/ux-policy.test.js desktop/test/session-policy.test.js`

Expected: all tests pass.

- [ ] **Step 7: Review checkpoint.**

Manually verify with the dev app that switching welcome/active state does not clear draft text, attachments, a queued instruction, or the current background/theme.

### Task 7: Mobile and iPad Layout Adaptation

**Files:**

- Modify: `desktop/src/mobile/index.html`
- Modify: `desktop/src/mobile/app.js`
- Modify: `desktop/src/mobile/styles.css`
- Modify: `desktop/test/mobile-layout.test.js`

**Consumes:** Existing `GrokMobileLayout` pane rules and the same `conversationLayout` decision copied as a small browser-compatible function or exposed through `layout-policy.js`.

**Produces:** A modest phone welcome state and unchanged iPad drawer/three-column semantics.

- [ ] **Step 1: Write failing preservation tests.**

```js
test("layout policy keeps existing iPad panels while conversation state changes", () => {
  const panels = { leftOpen: true, rightOpen: false };
  assert.equal(conversationLayout({ messageCount: 0 }), "welcome");
  assert.deepEqual(panels, { leftOpen: true, rightOpen: false });
  assert.equal(conversationLayout({ messageCount: 1 }), "active");
  assert.deepEqual(panels, { leftOpen: true, rightOpen: false });
});
```

- [ ] **Step 2: Run tests and verify the browser layout helper is not yet wired.**

Run: `node --test desktop/test/mobile-layout.test.js`

Expected: failing import or missing conversation layout assertion.

- [ ] **Step 3: Add the minimal mobile state marker.**

Use `data-conversation-layout` on the mobile app root and `GrokLayoutPolicy.conversationLayout(...)` rather than duplicating the decision. Recompute after user messages, agent updates, runtime snapshots, prompt queue changes, and reset conversation. On every runtime snapshot, surface `runtime.planApprovals[0]` when it exists and differs from the current approval by `toolCallId`. Do not alter `state.layoutMode`, `state.landscapePanels`, or `state.drawerOpen`.

- [ ] **Step 4: Add responsive CSS.**

On phone welcome state, move the greeting/input upward within the existing central column without introducing desktop-sized blank space. On active state retain the current fixed composer. On iPad center column, allow the compact welcome layout but keep existing grid tracks and all left/right panel controls unchanged.

- [ ] **Step 5: Run mobile-layout and UI contracts.**

Run: `node --test desktop/test/mobile-layout.test.js desktop/test/ux-policy.test.js`

Expected: all tests pass.

### Task 8: End-to-End QA, Release Version, and Packaging

**Files:**

- Modify: `desktop/scripts/qa-desktop.js`
- Modify: `desktop/package.json`
- Generated after verification: `desktop/qa-desktop-plan-approval.png`, `desktop/qa-mobile-plan-approval.png`, `desktop/qa-ipad-plan-approval.png`, Windows installer and portable executable in `desktop/dist`

**Consumes:** All preceding features.

**Produces:** Repeatable screenshot QA that exercises desktop/mobile/iPad plan approvals and both desktop layout states.

- [ ] **Step 1: Add failing QA assertions before release version changes.**

Extend the QA fixture to inject a plan-approval event with a long Markdown plan. Assert that desktop renders the dialog, feedback validation prevents empty revision, and a selected response closes the dialog. Add screenshot cases for desktop welcome, desktop active, phone approval, iPad portrait approval, and iPad landscape approval.

- [ ] **Step 2: Run the QA script and verify the new case fails before the feature is complete.**

Run: `.\\node_modules\\.bin\\electron.cmd .\\scripts\\qa-desktop.js`

Expected: failure at missing plan approval UI or missing layout state.

- [ ] **Step 3: Complete fixture support and run all desktop tests.**

Run: `npm test`

Expected: every Node test passes with no skipped plan/layout cases.

- [ ] **Step 4: Run backend smoke and visual QA.**

Run: `npm run test:backend`

Expected: backend smoke passes.

Run: `.\\node_modules\\.bin\\electron.cmd .\\scripts\\qa-desktop.js`

Expected: QA succeeds and emits all required screenshots.

Inspect screenshots at `1440x900`, `390x844`, `768x1024`, `1024x768`, and `1366x1024`; verify no blank viewport, clipping, overlap, inaccessible approval buttons, or damaged iPad panels.

- [ ] **Step 5: Set release version and build Windows artifacts.**

Change `desktop/package.json` version from `0.1.2` to `0.1.3` only after all tests above pass.

Run: `npm run dist:win`

Expected: `desktop/dist/Grok-Build-Setup-0.1.3-x64.exe` and `desktop/dist/Grok-Build-Portable-0.1.3-x64.exe` exist.

- [ ] **Step 6: Verify artifact identity.**

Run: `Get-FileHash .\\dist\\Grok-Build-Setup-0.1.3-x64.exe,.\\dist\\Grok-Build-Portable-0.1.3-x64.exe -Algorithm SHA256 | Select-Object Path,Hash`

Expected: both files produce SHA-256 hashes. Launch the portable executable once and confirm the visible client version is `v0.1.3`.

## Plan Self-Review

Coverage mapping:

- Official protocol, exact outcomes, replay identity, and first-answer-wins are Tasks 1-2.
- Desktop and mobile/iPad approval UX, dismissal, feedback validation, and synchronization are Tasks 3-4.
- New-task/active-task hierarchy, sidebar density, theme preservation, and iPad panel preservation are Tasks 5-7.
- Automated tests, visual QA, package version, and Windows artifacts are Task 8.

The plan contains no deferred implementation placeholders. All response names are defined in Tasks 1-2 and consumed consistently by later tasks. The only intentionally excluded protocol is `x.ai/ask_user_question`, matching the approved scope.
