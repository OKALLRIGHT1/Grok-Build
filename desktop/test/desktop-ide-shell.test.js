const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");

test("desktop navigation exposes an IDE workspace tree with persistent sizing", () => {
  const html = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "renderer.js"), "utf8");
  const styles = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "styles.css"), "utf8");

  assert.match(html, /id="workspace-tree"/);
  assert.match(html, /id="sidebar-resize-handle"/);
  assert.match(html, /id="sessions-button"/);
  assert.match(html, /class="sidebar-footer"/);
  assert.doesNotMatch(html, /class="sidebar-spacer"/);
  assert.match(html, /id="client-version">v0\.1\.17</);
  assert.match(renderer, /className = "workspace-tree-node"/);
  assert.match(renderer, /grok-desktop\.workspace-tree-state/);
  assert.match(renderer, /grok-desktop\.sidebar-width/);
  assert.match(renderer, /Math\.min\(440, Math\.max\(280, width\)\) : 320/);
  assert.match(renderer, /Math\.min\(440, Math\.max\(280, Number\(width\) \|\| 320\)\)/);
  assert.match(renderer, /function renderWorkspaceTree\(\)/);
  assert.match(renderer, /function toggleWorkspaceTreeNode\(workspace\)/);
  assert.doesNotMatch(renderer, /if \(state\.workspace\) await connectAgent\(\);/);
  assert.match(renderer, /catch \(error\) \{\s+const message = error instanceof Error \? error\.message : "无法连接到 Grok 后端";\s+setStatus\("error"\);\s+showError\(message, \{ retry: connectAgent \}\);/);
  assert.match(styles, /--sidebar-width:\s*320px/);
  assert.match(styles, /minmax\(280px, var\(--sidebar-width\)\)/);
  assert.match(styles, /max-width:\s*440px/);
  assert.match(styles, /grid-template-columns: 48px 6px minmax\(0, 1fr\)/);
  assert.match(styles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.workspace-tree-region\s*\{[^}]*flex:\s*1 1 auto/s);
  assert.match(styles, /\.workspace-tree\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.sidebar-footer\s*\{[^}]*flex:\s*0 0 auto/s);
  assert.match(styles, /\.sidebar-more \.feature-nav\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /\.workspace-session-list/);
  assert.match(styles, /min-height: 46px/);
});

test("desktop assistant tools render as grouped IDE activity rows", () => {
  const renderer = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "renderer.js"), "utf8");
  const styles = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "styles.css"), "utf8");

  assert.match(renderer, /function ensureActivityGroup\(assistant\)/);
  assert.match(renderer, /function renderActivityGroup\(group\)/);
  assert.match(renderer, /root\.className = "activity-group"/);
  assert.match(renderer, /rowElement\.className = `activity-row/);
  assert.match(renderer, /rowElement\.dataset\.rowKey = row\.key/);
  assert.match(renderer, /GrokToolPresentation\.upsertActivity/);
  assert.match(renderer, /assistant\.activeActivityGroup = null/);
  assert.doesNotMatch(renderer, /card\.className = "tool-card"/);

  assert.match(styles, /\.activity-group\s*\{/);
  assert.match(styles, /\.activity-group-summary\s*\{/);
  assert.match(styles, /\.activity-row\s*\{/);
  assert.match(styles, /\.activity-row\.failed/);
  assert.match(styles, /min-height:\s*32px/);
  assert.match(styles, /text-overflow:\s*ellipsis/);
  assert.doesNotMatch(styles, /\.tool-card\s*\{/);
});
