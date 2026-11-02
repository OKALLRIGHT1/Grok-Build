const test = require("node:test");
const assert = require("node:assert/strict");
const { marked } = require("marked");
const { normalizeMarkdown } = require("../src/markdown-display");

marked.setOptions({ breaks: true, gfm: true });

test("repairs malformed model markdown without dropping text", () => {
  const source = [
    "| 字段 | experimental内容 |",
    "| --- | --- 并收 |",
    "| 类别 | A 结构套公开 API。 |",
    "",
    "###冗余（6已） |",
    "| 证据 | 文档 `delegate_session.py` |",
  ].join("\n");

  const normalized = normalizeMarkdown(source);
  const html = marked.parse(normalized);

  assert.match(normalized, /\| --- \| --- \|/);
  assert.match(normalized, /### 冗余（6已）/);
  assert.match(normalized, /- \*\*证据\*\*：文档/);
  assert.match(html, /<table>/);
  assert.match(html, /<h3>冗余（6已）<\/h3>/);
  assert.match(html, /并收/);
  assert.doesNotMatch(html, /###冗余/);
});

test("leaves valid tables, fenced code, and source directives unchanged", () => {
  const source = [
    "| 名称 | 状态 |",
    "| --- | --- |",
    "| Grok | 可用 |",
    "",
    "#include <stdio.h>",
    "",
    "```md",
    "###不要修复",
    "| --- | --- 损坏 |",
    "```",
  ].join("\n");

  assert.equal(normalizeMarkdown(source), source);
});

