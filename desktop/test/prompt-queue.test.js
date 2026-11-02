const test = require("node:test");
const assert = require("node:assert/strict");
const { PromptQueue } = require("../src/prompt-queue");

function prompt(text, attachments = []) {
  return { text, blocks: [{ type: "text", text }], attachments };
}

test("prompt queue assigns stable IDs and exposes sanitized defensive snapshots", () => {
  let nextId = 0;
  const queue = new PromptQueue({ createId: () => `prompt-${++nextId}`, now: () => 1234 });
  const queued = queue.enqueue(prompt("next", [{ name: "notes.txt", kind: "text", size: 5 }]), "desktop");

  assert.deepEqual(queued, {
    id: "prompt-1",
    text: "next",
    attachments: [{ name: "notes.txt", kind: "text", size: 5 }],
    source: "desktop",
    createdAt: 1234,
  });
  const snapshot = queue.list();
  snapshot[0].text = "changed";
  snapshot[0].attachments[0].name = "changed.txt";
  assert.equal(queue.list()[0].text, "next");
  assert.equal(queue.list()[0].attachments[0].name, "notes.txt");
});

test("prompt queue updates, removes, moves, and prioritizes by stable ID", () => {
  let nextId = 0;
  const queue = new PromptQueue({ createId: () => `prompt-${++nextId}`, now: () => 1 });
  const first = queue.enqueue(prompt("first"), "desktop");
  const second = queue.enqueue(prompt("second"), "mobile");
  const third = queue.enqueue(prompt("third"), "desktop");

  queue.update(second.id, prompt("edited"));
  queue.move(third.id, -1);
  assert.deepEqual(queue.list().map((item) => item.text), ["first", "third", "edited"]);
  queue.prioritize(second.id);
  assert.deepEqual(queue.list().map((item) => item.text), ["edited", "first", "third"]);
  queue.move(second.id, -10);
  assert.equal(queue.list()[0].id, second.id);
  queue.remove(first.id);
  assert.deepEqual(queue.list().map((item) => item.id), [second.id, third.id]);
});

test("takeNext returns the complete prompt while list omits prompt blocks", () => {
  const queue = new PromptQueue({ createId: () => "queued", now: () => 1 });
  queue.enqueue({
    text: "inspect",
    blocks: [{ type: "text", text: "inspect" }, { type: "image", data: "secret-base64" }],
    attachments: [{ name: "image.png", kind: "image", size: 12 }],
  }, "mobile");

  assert.equal(queue.list()[0].blocks, undefined);
  const next = queue.takeNext();
  assert.equal(next.prompt.blocks[1].data, "secret-base64");
  assert.deepEqual(queue.list(), []);
});

test("unknown queue IDs are rejected", () => {
  const queue = new PromptQueue();
  assert.throws(() => queue.update("missing", prompt("x")), /不存在|已开始/);
  assert.throws(() => queue.remove("missing"), /不存在|已开始/);
  assert.throws(() => queue.move("missing", 1), /不存在|已开始/);
  assert.throws(() => queue.prioritize("missing"), /不存在|已开始/);
});
