# iPad Responsive Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a responsive Grok Remote layout that uses collapsible three-column navigation/chat/control panels on iPad landscape and edge drawers on iPad portrait while preserving the current phone workflow.

**Architecture:** Extract viewport classification, saved panel state, and session grouping into a browser/CommonJS helper so behavior can be tested without Electron. Restructure the existing mobile page around one shared pair of semantic side panels; CSS changes their presentation between overlay drawers and landscape grid columns, while `app.js` keeps one set of existing WebSocket actions and renderers.

**Tech Stack:** Electron 40, Node.js test runner, HTML5, CSS media queries, vanilla JavaScript, Lucide, existing WebSocket control server.

## Global Constraints

- Do not change the Rust CLI backend, ACP protocol, pairing flow, connection token, Tailscale behavior, Android package, desktop main UI, or model provider format.
- iPad landscape three-column mode requires viewport width `>= 980px`, height `>= 650px`, and landscape orientation.
- iPad portrait enhancements start at `700px`; narrower split-screen widths keep the phone presentation.
- First landscape state is `{ leftOpen: true, rightOpen: false }`, and later landscape changes persist in `localStorage`.
- Landscape side panel changes must not reconnect WebSocket, clear conversation state, remove attachments, or reset the prompt queue.
- The center chat column remains at least `480px` wide.
- Existing phone QA at `320x700` and `430x850` must remain valid.
- The workspace does not contain a valid Git repository, so commit steps are intentionally omitted.

---

### Task 1: Testable Mobile Layout Policy

**Files:**
- Create: `desktop/src/mobile-layout.js`
- Create: `desktop/test/mobile-layout.test.js`

**Interfaces:**
- Produces: `classifyViewport({ width, height }) -> "phone" | "tablet-portrait" | "tablet-landscape"`
- Produces: `readPanelState(storage) -> { leftOpen: boolean, rightOpen: boolean }`
- Produces: `writePanelState(storage, state) -> normalized state`
- Produces: `groupSessions(sessions) -> Array<{ key, label, sessions }>`
- Consumes: a Storage-compatible object with `getItem` and `setItem`.

- [ ] **Step 1: Write failing policy tests**

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyViewport, groupSessions, readPanelState, writePanelState,
} = require("../src/mobile-layout");

test("viewport policy separates phones from iPad portrait and landscape", () => {
  assert.equal(classifyViewport({ width: 430, height: 850 }), "phone");
  assert.equal(classifyViewport({ width: 932, height: 430 }), "phone");
  assert.equal(classifyViewport({ width: 768, height: 1024 }), "tablet-portrait");
  assert.equal(classifyViewport({ width: 1024, height: 768 }), "tablet-landscape");
});

test("panel state defaults, persists, and rejects malformed storage", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(readPanelState(storage), { leftOpen: true, rightOpen: false });
  assert.deepEqual(writePanelState(storage, { leftOpen: false, rightOpen: true }), { leftOpen: false, rightOpen: true });
  assert.deepEqual(readPanelState(storage), { leftOpen: false, rightOpen: true });
  values.set("grok-remote.ipad-panels", "not-json");
  assert.deepEqual(readPanelState(storage), { leftOpen: true, rightOpen: false });
});

test("sessions group by workspace path without dropping current metadata", () => {
  const groups = groupSessions([
    { id: "a", cwd: "C:/work/alpha", title: "Alpha", modelId: "m1" },
    { id: "b", cwd: "C:/work/beta", title: "Beta", modelId: "m2" },
    { id: "c", cwd: "C:/work/alpha", title: "Again", modelId: "m3" },
    { id: "d", title: "Loose" },
  ]);
  assert.deepEqual(groups.map((group) => [group.key, group.label, group.sessions.map((item) => item.id)]), [
    ["C:/work/alpha", "alpha", ["a", "c"]],
    ["C:/work/beta", "beta", ["b"]],
    ["__other__", "其他会话", ["d"]],
  ]);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run from `desktop`:

```powershell
C:\useful\nodejs\node.exe --test test/mobile-layout.test.js
```

Expected: FAIL because `../src/mobile-layout` does not exist.

- [ ] **Step 3: Implement the policy module**

Use the existing browser/CommonJS wrapper pattern from `tool-presentation.js`. Define constants `PANEL_STATE_KEY = "grok-remote.ipad-panels"` and `DEFAULT_PANEL_STATE`. Classify landscape only when `width >= 980`, `height >= 650`, and `width > height`; classify portrait when `width >= 700` and `height >= width`. Parse storage defensively and only accept literal booleans. Group sessions in insertion order by normalized `cwd`, using the final path segment as the label and `__other__` for missing paths.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the same Node command. Expected: 3 tests pass, 0 fail.

---

### Task 2: Shared Responsive Panel Structure and Styling

**Files:**
- Modify: `desktop/src/mobile/index.html`
- Modify: `desktop/src/mobile/styles.css`
- Modify: `desktop/src/control-server.js`
- Modify: `desktop/test/control-server.test.js`

**Interfaces:**
- Consumes: existing IDs `sessions`, `controls`, `new-session`, `mobile-model`, `mobile-mode`, `mobile-usage`, `mobile-work`.
- Produces: `navigation-panel`, `controls-panel`, `panel-backdrop`, `close-navigation`, `close-controls`, `panel-new-session`, `mobile-sessions`.

- [ ] **Step 1: Extend the served-page test before changing HTML**

Add assertions after fetching `/`:

```js
assert.match(pageBody, /id="navigation-panel"/);
assert.match(pageBody, /id="controls-panel"/);
assert.match(pageBody, /id="panel-backdrop"/);
assert.match(pageBody, /src="\/mobile-layout\.js"/);
assert.doesNotMatch(pageBody, /id="controls-dialog"/);
const layoutScript = await fetch(`${origin}/mobile-layout.js`);
assert.equal(layoutScript.status, 200);
assert.match(await layoutScript.text(), /GrokMobileLayout/);
```

- [ ] **Step 2: Run the control-server test and verify RED**

```powershell
C:\useful\nodejs\node.exe --test test/control-server.test.js
```

Expected: FAIL because the new panel IDs and script are absent.

- [ ] **Step 3: Restructure the mobile document**

Inside `#app-view`, keep the header, then add a `#workspace-shell` grid containing:

```html
<aside id="navigation-panel" class="side-panel navigation-panel glass-panel" aria-label="工作区与会话">
  <div class="panel-heading">
    <div><p class="eyebrow">工作区与会话</p><strong id="navigation-workspace">未选择工作区</strong></div>
    <button id="close-navigation" class="icon-button panel-close" type="button" title="收起会话栏"><i data-lucide="panel-left-close"></i></button>
  </div>
  <button id="panel-new-session" class="secondary-button full" type="button"><i data-lucide="square-pen"></i>新建对话</button>
  <div id="mobile-sessions" class="mobile-resource-list session-groups"></div>
  <button id="mobile-refresh-sessions" class="secondary-button full" type="button"><i data-lucide="refresh-cw"></i>刷新会话</button>
</aside>
<section class="chat-column" aria-label="当前对话"></section>
<aside id="controls-panel" class="side-panel controls-panel glass-panel" aria-label="模型与任务控制"></aside>
```

Move the existing `#conversation` and `.composer-wrap` nodes, with their complete existing children unchanged, into `.chat-column` in that order. Move the existing controls heading, `#mobile-model`, `#mobile-mode`, usage panel, and work panel into `#controls-panel`; remove the sessions control tab and remove `#controls-dialog`. Add `#panel-backdrop` after the grid. Load `/mobile-layout.js` before `/app.js`.

Add `"/mobile-layout.js": path.join(path.dirname(this.mobileRoot), "mobile-layout.js")` to `ControlServer.allowedStaticFile()` so the CSP-compliant external helper is served by the paired control origin.

- [ ] **Step 4: Add base drawer CSS and landscape grid CSS**

Base/phone/portrait behavior uses fixed panels with transforms and a backdrop. Add `@media (min-width: 980px) and (min-height: 650px) and (orientation: landscape)` to reset panels to static grid children and drive column tracks from `.left-open` and `.right-open` classes. At `980px..1179px`, use `220px/240px`; at `1180px+`, use `260px/300px`. Closed tracks are `48px`. Keep `.chat-column { min-width: 480px; }` only in landscape media so phone widths remain fluid.

- [ ] **Step 5: Run the focused server test and verify GREEN**

Expected: control-server tests pass with the new semantic panel structure.

---

### Task 3: Panel Interaction, Persistence, and Grouped Sessions

**Files:**
- Modify: `desktop/src/mobile/app.js`
- Modify: `desktop/src/mobile/index.html`

**Interfaces:**
- Consumes: `globalThis.GrokMobileLayout` from Task 1.
- Produces internal functions: `updateLayoutMode()`, `setPanelOpen(side, open, trigger)`, `closeDrawer()`, `renderPanelState()`, `renderSessionGroups(sessions)`.

- [ ] **Step 1: Add a failing integration assertion to QA setup**

Before implementation, extend the mobile QA JavaScript to assert the default policy script exposes `GrokMobileLayout`, and that a `1024x768` view receives `tablet-landscape` with left open/right closed after initialization. Run QA and confirm it fails before wiring `app.js`.

- [ ] **Step 2: Wire layout state into `app.js`**

Update the global declaration to include `GrokMobileLayout`. Initialize:

```js
layoutMode: GrokMobileLayout.classifyViewport({ width: innerWidth, height: innerHeight }),
landscapePanels: GrokMobileLayout.readPanelState(localStorage),
drawerOpen: null,
panelTrigger: null,
```

`renderPanelState()` sets `data-layout`, `left-open`, `right-open`, panel `aria-hidden`, trigger `aria-expanded`, backdrop visibility, and Lucide open/close icons. In landscape, changes update `landscapePanels` and call `writePanelState`; in phone/portrait, at most one drawer is open and saved landscape state remains untouched.

- [ ] **Step 3: Wire controls and focus behavior**

- `#sessions` opens left and refreshes sessions.
- `#controls` opens right and refreshes the selected right tab.
- close buttons and backdrop close the current panel.
- `Escape` closes only overlay drawers.
- opening an overlay stores the trigger and focuses the first enabled control.
- closing restores focus to the trigger.
- `resize` calls `updateLayoutMode()` without touching socket, messages, attachments, or queue state.
- `#new-session` and `#panel-new-session` share one `createNewSession()` handler.

- [ ] **Step 4: Render grouped sessions**

Replace the flat session loop with `GrokMobileLayout.groupSessions(result.sessions)`. Render each group as a heading plus existing `mobileRow` entries. On successful `load-session`, close the left panel only when mode is not `tablet-landscape`. Keep current-row highlighting and disabled current action.

- [ ] **Step 5: Run all Node tests**

```powershell
$tests = Get-ChildItem test -Filter *.test.js | Select-Object -ExpandProperty FullName
C:\useful\nodejs\node.exe --test $tests
```

Expected: all tests pass with no failures.

---

### Task 4: iPad Visual QA and Packaging

**Files:**
- Modify: `desktop/scripts/qa-desktop.js`
- Generate: `desktop/qa-ipad-portrait-left.png`
- Generate: `desktop/qa-ipad-landscape-default.png`
- Generate: `desktop/qa-ipad-pro-three-column.png`
- Generate: Windows Setup and Portable artifacts under `desktop/dist/`

**Interfaces:**
- Consumes: final mobile HTML/CSS/layout module.
- Produces: deterministic screenshots and DOM dimension assertions.

- [ ] **Step 1: Add iPad capture states**

Load `mobile-layout.js` and `app.js` dependencies in the mobile QA window. Populate representative session groups, model selectors, usage, tasks, message timeline, queue, and composer. Capture:

```text
768x1024  -> left overlay open
1024x768  -> left open, right closed
1366x1024 -> left open, right open
```

For each view, assert the conversation and composer rectangles do not overlap, the center column is at least `480px` in landscape, and visible panels remain within the viewport. Confirm PNG images are non-empty and contain varying pixel data.

- [ ] **Step 2: Run Electron QA**

```powershell
.\node_modules\.bin\electron.cmd .\scripts\qa-desktop.js
```

Expected: exit 0 and all phone/iPad/desktop screenshots are generated.

- [ ] **Step 3: Inspect all new iPad screenshots**

Use image inspection at original detail for the three iPad files. Verify no clipped controls, overlapping text, hidden composer, blank panels, or incoherent nested cards. If any issue exists, return to the relevant CSS/JS task and rerun QA.

- [ ] **Step 4: Run final regression verification**

Run all desktop Node tests again, then run Electron QA again. Record exact pass count and exit codes.

- [ ] **Step 5: Build Windows clients**

No Rust rebuild is required because this feature changes only packaged web assets. From `desktop`:

```powershell
C:\useful\nodejs\npm.cmd run dist:win
```

Expected: new `Grok-Build-Setup-0.1.0-x64.exe` and `Grok-Build-Portable-0.1.0-x64.exe` with timestamps later than the mobile source changes.

- [ ] **Step 6: Verify deliverables**

Compute SHA-256 for both artifacts and report paths, sizes, timestamps, test counts, QA screenshots, and the unsigned Authenticode status. State that iPad consumes the updated page from the newly installed computer client and does not require an iPad package.
