const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createActivityState,
  describe,
  format,
  summarizeActivity,
  upsertActivity,
} = require("../src/tool-presentation");

test("tool descriptions hide raw search expressions and full paths", () => {
  assert.deepEqual(describe({
    tool: "run_terminal_command",
    title: "rg -n \"workspace-tree-region|sidebar-spacer\" C:\\work\\renderer.js",
    rawInput: { command: "rg -n \"workspace-tree-region|sidebar-spacer\" C:\\work\\renderer.js" },
  }), {
    category: "search",
    target: "renderer.js",
    title: "搜索 renderer.js",
    mergeKey: "search:renderer.js",
    icon: "search",
  });
});

test("read and edit descriptions use file names", () => {
  assert.equal(describe({ title: "Read `C:\\work\\renderer.js`" }).title, "读取 renderer.js");
  assert.equal(describe({
    rawInput: { file_path: "C:\\work\\build_resume.py" },
    content: [{ type: "diff", oldText: "a", newText: "b" }],
  }).title, "修改 build_resume.py");
});

test("fallback tool descriptions stay normalized and bounded", () => {
  const result = describe({ title: `Unknown   ${"x".repeat(160)}` });
  assert.equal(result.category, "other");
  assert.ok(result.title.length <= 96);
  assert.doesNotMatch(result.title, /\s{2,}/);
});

test("malformed tool updates fall back to a single operation label", () => {
  assert.deepEqual(describe({}), {
    category: "other",
    target: "",
    title: "操作",
    mergeKey: "other:操作",
    icon: "wrench",
  });
});

test("explicit terminal tools keep terminal classification for non-search commands", () => {
  const result = describe({
    tool: "run_terminal_command",
    title: "PowerShell 检查 C:\\work\\missing-model.json",
    rawInput: { command: "Get-Content C:\\work\\missing-model.json" },
  });
  assert.equal(result.category, "terminal");
  assert.equal(result.title, "终端 missing-model.json");
});

test("repeated equivalent reads merge into one activity row", () => {
  const activity = createActivityState();
  for (let index = 0; index < 4; index += 1) {
    upsertActivity(activity, `read-${index}`, {
      title: "Read `C:\\work\\chat_service.py`",
      status: "completed",
    });
  }

  const summary = summarizeActivity(activity);
  assert.equal(summary.total, 4);
  assert.equal(summary.represented, 1);
  assert.equal(summary.rows[0].title, "读取 chat_service.py");
  assert.equal(summary.rows[0].count, 4);
  assert.deepEqual(summary.rows[0].ids, ["read-0", "read-1", "read-2", "read-3"]);
});

test("failed operations stay separate from successful merged rows", () => {
  const activity = createActivityState();
  upsertActivity(activity, "read-ok", { title: "Read `chat_service.py`", status: "completed" });
  upsertActivity(activity, "read-failed", { title: "Read `chat_service.py`", status: "failed", content: "Access denied" });

  const summary = summarizeActivity(activity);
  assert.equal(summary.total, 2);
  assert.equal(summary.represented, 2);
  assert.equal(summary.status, "failed");
  assert.deepEqual(summary.rows.map((row) => row.status), ["completed", "failed"]);
});

test("streaming updates keep a stable operation count and summarize categories", () => {
  const activity = createActivityState();
  upsertActivity(activity, "search-1", { title: "rg first src", status: "in_progress" });
  upsertActivity(activity, "search-1", { status: "completed", content: "one" });
  upsertActivity(activity, "search-2", { title: "rg second test", status: "completed" });
  for (let index = 0; index < 5; index += 1) {
    upsertActivity(activity, `read-${index}`, { title: `Read ` + "`C:\\work\\file.js`", status: "completed" });
  }
  upsertActivity(activity, "edit-1", {
    title: "Edit `C:\\work\\file.js`",
    rawInput: { file_path: "C:\\work\\file.js" },
    content: [{ type: "diff", oldText: "a", newText: "b" }],
    status: "completed",
  });

  const summary = summarizeActivity(activity);
  assert.equal(summary.total, 8);
  assert.equal(summary.status, "completed");
  assert.deepEqual(summary.counts, { search: 2, read: 5, edit: 1, terminal: 0, other: 0 });
  assert.equal(summary.label, "已完成 8 步：搜索 2、读取 5、修改 1");
});

test("edit tool results become a collapsed human-readable diff", () => {
  const result = format({
    title: "Edit `build_resume.py`",
    content: [{
      type: "diff",
      path: "C:/resume/build_resume.py",
      oldText: "SQLite",
      newText: "PyTorch",
      _meta: { details: [{ old_string: "SQLite", old_line: 100, new_string: "PyTorch", new_line: 100 }] },
    }],
  });

  assert.equal(result.summary, "build_resume.py · 1 处修改 · 第 100 行");
  assert.equal(result.collapsed, true);
  assert.match(result.text, /- SQLite/);
  assert.match(result.text, /\+ PyTorch/);
  assert.doesNotMatch(result.text, /old_string|new_string|_meta/);
});

test("long structured tool output is collapsed and extracts text blocks", () => {
  const result = format({
    content: [{ type: "content", content: { type: "text", text: "file output" } }],
    rawOutput: { type: "ReadFile", internal: true },
  });
  assert.equal(result.text, "file output");
  assert.equal(result.collapsed, true);
  assert.equal(result.summary, "查看详细结果");
});

test("very large outputs are bounded before rendering", () => {
  const result = format({ content: "x".repeat(30_000) });
  assert.ok(result.text.length < 17_000);
  assert.match(result.summary, /已截断/);
  assert.match(result.text, /已省略/);
});
