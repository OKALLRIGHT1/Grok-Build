const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPromptContent } = require("../src/prompt-content");

test("prompt content builds text, image, and embedded file ACP blocks", () => {
  const result = buildPromptContent({
    text: "检查附件",
    attachments: [
      { name: "shot.png", mimeType: "image/png", kind: "image", data: Buffer.from("png").toString("base64") },
      { name: "notes.txt", mimeType: "text/plain", kind: "text", content: "hello" },
      { name: "data.bin", mimeType: "application/octet-stream", kind: "file", data: Buffer.from([1, 2]).toString("base64") },
    ],
  });
  assert.equal(result.text, "检查附件");
  assert.deepEqual(result.blocks.map((block) => block.type), ["text", "image", "resource", "resource"]);
  assert.equal(result.blocks[1].mimeType, "image/png");
  assert.equal(result.blocks[2].resource.text, "hello");
  assert.equal(result.blocks[3].resource.blob, "AQI=");
  assert.deepEqual(result.attachments.map((item) => item.kind), ["image", "text", "file"]);
});

test("prompt content supports attachment-only prompts and rejects invalid payloads", () => {
  const onlyFile = buildPromptContent({
    attachments: [{ name: "a.md", mimeType: "text/markdown", kind: "text", content: "# title" }],
  });
  assert.equal(onlyFile.text, "请分析这些附件。");
  assert.throws(() => buildPromptContent({ text: "" }), /不能为空/);
  assert.throws(() => buildPromptContent({
    text: "x",
    attachments: [{ name: "bad.bin", kind: "file", data: "not-base64" }],
  }), /格式无效/);
});
