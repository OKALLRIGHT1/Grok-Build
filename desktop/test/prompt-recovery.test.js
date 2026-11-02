const test = require("node:test");
const assert = require("node:assert/strict");
const { PromptRecovery } = require("../src/prompt-recovery");

function prompt(text = "检查这个文件") {
  return {
    text,
    attachments: [{ name: "report.png", kind: "image", data: "large-base64" }],
    blocks: [{ type: "text", text }, { type: "image", data: "large-base64" }],
  };
}

test("explicit cancel makes the active prompt recoverable with a lightweight summary", () => {
  const recovery = new PromptRecovery({ createId: () => "recovery-1" });
  recovery.begin(prompt(), "desktop");

  const recovered = recovery.cancel({ recover: true });

  assert.equal(recovered.id, "recovery-1");
  assert.equal(recovered.text, "检查这个文件");
  assert.deepEqual(recovery.summary(), {
    id: "recovery-1",
    text: "检查这个文件",
    source: "desktop",
    attachments: [{ name: "report.png", kind: "image" }],
  });
  assert.equal(JSON.stringify(recovery.summary()).includes("large-base64"), false);
});

test("queue interruption cancels without creating a recovery draft", () => {
  const recovery = new PromptRecovery();
  recovery.begin(prompt(), "mobile");

  assert.equal(recovery.cancel({ recover: false }), null);
  assert.equal(recovery.summary(), null);
  assert.equal(recovery.consume(), null);
});

test("consume is one-shot and returns an isolated clone", () => {
  const recovery = new PromptRecovery({ createId: () => "recovery-2" });
  const original = prompt("继续处理");
  recovery.begin(original, "desktop");
  original.attachments[0].data = "mutated-after-begin";
  recovery.cancel({ recover: true });

  const first = recovery.consume();
  first.attachments[0].data = "mutated-after-consume";

  assert.equal(first.blocks[1].data, "large-base64");
  assert.equal(recovery.consume(), null);
  assert.equal(recovery.summary(), null);
});

test("a completed prompt is not recoverable and queued work cannot erase a canceled draft", () => {
  const recovery = new PromptRecovery({ createId: () => "recovery-3" });
  recovery.begin(prompt("first"), "desktop");
  recovery.cancel({ recover: true });
  recovery.begin(prompt("second"), "desktop");
  assert.equal(recovery.summary().text, "first");

  recovery.finish();
  assert.equal(recovery.summary().text, "first");
});
