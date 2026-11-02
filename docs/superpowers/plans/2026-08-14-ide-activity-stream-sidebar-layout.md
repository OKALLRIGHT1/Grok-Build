# IDE Activity Stream and Sidebar Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace desktop tool cards with a compact, grouped IDE activity stream and keep phone control plus backend connection visible while the workspace tree consumes the remaining sidebar height.

**Architecture:** Extend the existing shared `tool-presentation.js` module with pure tool classification and aggregation functions while preserving its current `format(update)` API for mobile. The desktop renderer owns stage boundaries and reconciles keyed activity rows inside one group per consecutive tool stage; CSS supplies the IDE timeline appearance and a single-flex-region sidebar.

**Tech Stack:** Electron 40, browser JavaScript, CommonJS/UMD shared modules, HTML/CSS, Node.js built-in test runner, electron-builder.

## Global Constraints

- Windows desktop renderer only; do not change Grok CLI protocol handling, tool execution, session persistence, or mobile synchronization.
- Normal chat messages, composer, themes, custom backgrounds, and avatars keep their glass styling.
- Main activity titles must not expose raw regular expressions, full paths, raw JSON, or unbounded CLI text.
- Completed activity groups collapse by default; running and failed groups expose active or failed rows.
- Failed operations never merge into successful rows and remain individually inspectable.
- Final answers remain outside activity groups and receive the existing `最终回答` label.
- Sidebar width defaults to `320px` and remains resizable from `280px` through `440px`.
- The workspace tree is the sidebar's only flexible scrolling region; phone control and backend status remain visible on short windows.
- Preserve desktop, phone, and iPad session rendering and interaction behavior.
- This checkout has no usable Git repository metadata, so each task ends with test evidence instead of a Git commit.

---

### Task 1: Tool classification and bounded titles

**Files:**
- Modify: `desktop/src/tool-presentation.js`
- Test: `desktop/test/tool-presentation.test.js`

**Interfaces:**
- Consumes: raw ACP tool update objects already accepted by `format(update)`.
- Produces: `describe(update) -> { category, target, title, mergeKey, icon }`, where `category` is one of `search|read|edit|terminal|other` and all display strings are bounded.
- Preserves: `format(update) -> { text, summary, collapsed }` for desktop and mobile consumers.

- [ ] **Step 1: Write failing classification tests**

Add tests that assert a `rg` title containing a raw regular expression is displayed as `搜索 renderer.js`, a Windows read path is displayed as `读取 renderer.js`, a diff is displayed as `修改 build_resume.py`, and an unknown title is whitespace-normalized and capped at 96 characters.

```js
const { describe, format } = require("../src/tool-presentation");

test("tool descriptions hide raw search expressions and full paths", () => {
  assert.deepEqual(describe({
    tool: "run_terminal_command",
    title: "rg -n \\\"workspace-tree-region|sidebar-spacer\\\" C:\\\\work\\\\renderer.js",
    rawInput: { command: "rg -n \\\"workspace-tree-region|sidebar-spacer\\\" C:\\\\work\\\\renderer.js" },
  }), {
    category: "search",
    target: "renderer.js",
    title: "搜索 renderer.js",
    mergeKey: "search:renderer.js",
    icon: "search",
  });
});

test("read and edit descriptions use file names", () => {
  assert.equal(describe({ title: "Read `C:\\\\work\\\\renderer.js`" }).title, "读取 renderer.js");
  assert.equal(describe({ rawInput: { file_path: "C:\\\\work\\\\build_resume.py" }, content: [{ type: "diff", oldText: "a", newText: "b" }] }).title, "修改 build_resume.py");
});

test("fallback tool descriptions stay bounded", () => {
  const result = describe({ title: `Unknown   ${"x".repeat(160)}` });
  assert.equal(result.category, "other");
  assert.ok(result.title.length <= 96);
  assert.doesNotMatch(result.title, /\\s{2,}/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/tool-presentation.test.js`

Expected: FAIL because `describe` is not exported.

- [ ] **Step 3: Implement minimal classification**

Add bounded whitespace normalization, path/file extraction, diff detection, command parsing for `rg|grep|findstr`, read/edit keyword recognition, terminal fallback purpose, and the `describe(update)` export. Keep raw arguments exclusively available to `format(update)` details.

```js
const MAX_TITLE_CHARS = 96;

function describe(update = {}) {
  const source = normalizedSource(update);
  const target = primaryTarget(update, source);
  const category = classify(update, source);
  const title = boundedTitle(displayVerb(category), target || concisePurpose(source));
  return { category, target, title, mergeKey: `${category}:${target || title}`, icon: CATEGORY_ICONS[category] };
}

return { describe, format };
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test test/tool-presentation.test.js`

Expected: all tool presentation tests PASS.

### Task 2: Activity aggregation and repeat handling

**Files:**
- Modify: `desktop/src/tool-presentation.js`
- Test: `desktop/test/tool-presentation.test.js`

**Interfaces:**
- Consumes: `describe(update)` from Task 1.
- Produces: `createActivityState() -> { operations: Map, order: string[] }`, `upsertActivity(state, id, update) -> state`, and `summarizeActivity(state) -> { total, represented, status, counts, label, rows }`.
- Row shape: `{ key, ids, count, category, title, icon, status, data }`; `data` is the newest merged tool payload used by `format(data)`.

- [ ] **Step 1: Write failing aggregation tests**

Cover three behaviors with real helper calls: four completed reads of the same file become one row with `count: 4`; a failed read after a successful read remains a separate failed row; updating an existing tool-call ID changes status without incrementing `total`. Assert a mixed group label equals `已完成 8 步：搜索 2、读取 5、修改 1`.

```js
const { createActivityState, upsertActivity, summarizeActivity } = require("../src/tool-presentation");

test("repeated equivalent reads merge into one activity row", () => {
  const state = createActivityState();
  for (let index = 0; index < 4; index += 1) {
    upsertActivity(state, `read-${index}`, { title: "Read `C:\\\\work\\\\chat_service.py`", status: "completed" });
  }
  const summary = summarizeActivity(state);
  assert.equal(summary.total, 4);
  assert.equal(summary.represented, 1);
  assert.equal(summary.rows[0].title, "读取 chat_service.py");
  assert.equal(summary.rows[0].count, 4);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test test/tool-presentation.test.js`

Expected: FAIL because the activity-state functions are not exported.

- [ ] **Step 3: Implement minimal aggregation**

Store updates by stable tool-call ID, preserve first-seen order, derive adjacent display rows from current operations, merge only equivalent non-failed terminal states, and calculate category counts and group status in priority order `failed > running > completed`.

```js
function createActivityState() {
  return { operations: new Map(), order: [] };
}

function upsertActivity(state, id, update) {
  if (!state.operations.has(id)) state.order.push(id);
  const previous = state.operations.get(id)?.data || {};
  state.operations.set(id, { id, data: { ...previous, ...update } });
  return state;
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node --test test/tool-presentation.test.js`

Expected: all tool presentation tests PASS with repeat counts, failures, and stable updates covered.

### Task 3: Desktop renderer activity-group DOM

**Files:**
- Modify: `desktop/src/renderer/renderer.js`
- Test: `desktop/test/desktop-ide-shell.test.js`
- Modify: `desktop/scripts/qa-desktop.js`

**Interfaces:**
- Consumes: `GrokToolPresentation.createActivityState`, `upsertActivity`, `summarizeActivity`, and `format`.
- Produces: `ensureActivityGroup(assistant)`, `renderActivityGroup(group)`, and `.activity-group[data-state]` DOM containing `.activity-summary`, `.activity-list`, and keyed `.activity-row[data-row-key]` nodes.
- Stage boundary: `appendAssistantText()` clears `assistant.activeActivityGroup` after tool output so the next tool starts a new group; consecutive tool calls reuse the current group.

- [ ] **Step 1: Write failing renderer contract assertions**

Update `desktop-ide-shell.test.js` to require `function ensureActivityGroup(assistant)`, `function renderActivityGroup(group)`, `.activity-group`, `.activity-row`, calls to `GrokToolPresentation.upsertActivity`, and absence of the old `card.className = "tool-card"` creation path.

- [ ] **Step 2: Run the renderer contract and verify RED**

Run: `node --test test/desktop-ide-shell.test.js`

Expected: FAIL because activity-group renderer functions and classes do not exist.

- [ ] **Step 3: Implement keyed activity-group rendering**

Replace per-call cards with one `details.activity-group` per stage. Use `data-row-key` to reuse rows across streaming updates; render the icon, single-line title, `xN` repeat badge, status, and nested details output. Automatically open running or failed groups, collapse completed groups in `finalizeAssistantTurn()`, and keep the final assistant content outside the group.

```js
function ensureActivityGroup(assistant) {
  if (assistant.activeActivityGroup) return assistant.activeActivityGroup;
  const root = document.createElement("details");
  root.className = "activity-group";
  const group = { root, state: GrokToolPresentation.createActivityState(), rows: new Map() };
  assistant.body.append(root);
  assistant.activeActivityGroup = group;
  assistant.activityGroups.push(group);
  return group;
}
```

- [ ] **Step 4: Expand Electron QA fixture coverage**

Change the desktop QA fixture to stream two searches, four reads of the same file, one edit, and one failed terminal operation across two progress stages. Assert main titles contain no regex/full path, the four reads render as one row with `x4`, the failed row is separate and expanded, two activity groups exist, and the final answer is a direct sibling after the last group.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `node --test test/tool-presentation.test.js test/desktop-ide-shell.test.js test/qa-desktop-contract.test.js`

Expected: all focused tests PASS.

### Task 4: IDE activity-stream visual styling

**Files:**
- Modify: `desktop/src/renderer/styles.css`
- Test: `desktop/test/desktop-ide-shell.test.js`

**Interfaces:**
- Consumes: Task 3 class names and `data-state` attributes.
- Produces: 30-34px `.activity-row` layout, thin `.activity-rail`, one glass-framed `.activity-group`, ellipsized human title, monospace raw details, running animation, and warning treatment for `.activity-row.failed`.

- [ ] **Step 1: Add failing CSS contract assertions**

Assert the stylesheet includes `.activity-group`, `.activity-group-summary`, `.activity-row`, `.activity-row.failed`, `min-height: 32px`, `text-overflow: ellipsis`, and no active `.tool-card` layout selector.

- [ ] **Step 2: Run the CSS contract and verify RED**

Run: `node --test test/desktop-ide-shell.test.js`

Expected: FAIL because the activity stream selectors do not exist.

- [ ] **Step 3: Replace card styling with the IDE timeline**

Implement one restrained glass group container, compact header, vertical rail, 32px rows, icon/state colors, repeat badge, and nested raw-output details. Keep monospace only on commands, paths, and raw output. Add narrow-width rules so the title ellipsizes rather than resizing or overflowing.

- [ ] **Step 4: Run the CSS contract and verify GREEN**

Run: `node --test test/desktop-ide-shell.test.js`

Expected: PASS.

### Task 5: Sidebar height allocation and pinned footer

**Files:**
- Modify: `desktop/src/renderer/index.html`
- Modify: `desktop/src/renderer/styles.css`
- Modify: `desktop/test/desktop-ide-shell.test.js`
- Modify: `desktop/scripts/qa-desktop.js`

**Interfaces:**
- Produces: `.sidebar-footer` wrapping diagnostic, phone control, and account rows; `.workspace-tree-region` is the only `flex: 1 1 auto` child; `.workspace-tree` is the internal scroller; `.sidebar-more .feature-nav` has bounded overflow.
- Updates: CSS variable `--sidebar-width: 320px`, grid minimum `280px`, and sidebar `max-width: 440px`.

- [ ] **Step 1: Add failing sidebar contract assertions**

Assert the HTML contains `.sidebar-footer` and no `.sidebar-spacer`; CSS sets `.workspace-tree-region` to `flex: 1 1 auto`, `.sidebar-footer` to `flex: 0 0 auto`, the workspace tree to `overflow-y: auto`, and the width contract to 320/280/440px.

- [ ] **Step 2: Run the sidebar contract and verify RED**

Run: `node --test test/desktop-ide-shell.test.js`

Expected: FAIL because `.sidebar-spacer` still exists and width values are 300/260/420px.

- [ ] **Step 3: Implement the single-flex-region sidebar**

Remove `.sidebar-spacer`, wrap the diagnostic panel, remote-control row, and account row in `.sidebar-footer`, prevent fixed navigation and footer rows from shrinking, bound the expanded More Features list, and let the workspace tree shrink and scroll first.

- [ ] **Step 4: Add short-window Electron geometry checks**

Resize the desktop content to `1100x640` and assert the workspace tree has `overflowY: auto`, `.remote-control-row` and `.account-row` have positive rectangles fully inside the sidebar, the footer does not overlap navigation, and the workspace region is taller than its previous half-height allocation. Save `qa-desktop-sidebar-short.png`.

- [ ] **Step 5: Run focused contract tests and verify GREEN**

Run: `node --test test/desktop-ide-shell.test.js test/qa-desktop-contract.test.js`

Expected: PASS.

### Task 6: Full regression, visual QA, versioning, and Windows packages

**Files:**
- Modify: `desktop/package.json`
- Modify: `desktop/package-lock.json`
- Modify: `desktop/src/renderer/index.html`
- Verify: `desktop/scripts/qa-desktop.js`
- Verify: `desktop/scripts/verify-package.js`

**Interfaces:**
- Produces: version `0.1.6`, `desktop/dist/Grok-Build-Setup-0.1.6-x64.exe`, and `desktop/dist/Grok-Build-Portable-0.1.6-x64.exe`.

- [ ] **Step 1: Run the complete Node test suite**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 2: Run the backend smoke test**

Run: `npm run test:backend`

Expected: exits `0` and reports a successful official CLI/backend smoke path.

- [ ] **Step 3: Run Electron desktop, phone, and iPad QA**

Run: `.\\node_modules\\.bin\\electron.cmd .\\scripts\\qa-desktop.js`

Expected: exits `0`, produces desktop activity/sidebar screenshots plus the existing phone and iPad screenshots, and reports no renderer exception or geometry failure.

- [ ] **Step 4: Inspect visual captures**

Open `desktop/qa-desktop-ide-shell.png`, `desktop/qa-desktop-sidebar-short.png`, and the activity-stream capture. Verify readable spacing, compact rows, no raw regex/full path in headings, visible phone/backend rows, no overlap, and a final answer below activity groups.

- [ ] **Step 5: Bump the desktop version consistently**

Set `desktop/package.json`, `desktop/package-lock.json`, and `desktop/src/renderer/index.html` to `0.1.6`, then rerun `npm test` to catch stale version contracts.

- [ ] **Step 6: Build setup and portable packages**

Run: `npm run dist:win`

Expected: exit `0` with both `Grok-Build-Setup-0.1.6-x64.exe` and `Grok-Build-Portable-0.1.6-x64.exe` in `desktop/dist`.

- [ ] **Step 7: Verify packaged renderer contents**

Run: `node scripts/verify-package.js`

Expected: exit `0`; packaged `app.asar` contains updated `renderer.js`, `styles.css`, `tool-presentation.js`, and version `0.1.6`.

- [ ] **Step 8: Record artifact hashes**

Run: `Get-FileHash .\\dist\\Grok-Build-Setup-0.1.6-x64.exe,.\\dist\\Grok-Build-Portable-0.1.6-x64.exe -Algorithm SHA256`

Expected: two SHA256 hashes, one for each distributable.

## Self-Review

- Spec coverage: Tasks 1-4 cover bounded titles, classification, repeat merging, failure isolation, stage boundaries, stable rows, collapsed completed groups, and a separate final answer. Task 5 covers the single flexible workspace tree, fixed navigation/footer, short-height behavior, and the 320/280-440px width contract. Task 6 covers desktop/mobile/iPad regressions and packaged renderer verification.
- Placeholder scan: no unresolved markers, deferred implementation, unnamed error handling, or unspecified test steps remain.
- Type consistency: `describe`, `createActivityState`, `upsertActivity`, and `summarizeActivity` are defined once in Tasks 1-2 and consumed with identical names in Task 3. DOM names are consistently `.activity-group`, `.activity-group-summary`, `.activity-list`, and `.activity-row` across renderer, CSS, tests, and QA.
