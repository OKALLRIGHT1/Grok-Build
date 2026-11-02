const test = require("node:test");
const assert = require("node:assert/strict");
const { conversationLayout } = require("../src/layout-policy");

test("new task stays in welcome layout until a message, task, or queue exists", () => {
  assert.equal(conversationLayout({ messageCount: 0, busy: false, queueLength: 0 }), "welcome");
  assert.equal(conversationLayout({ messageCount: 1, busy: false, queueLength: 0 }), "active");
  assert.equal(conversationLayout({ messageCount: 0, busy: true, queueLength: 0 }), "active");
  assert.equal(conversationLayout({ messageCount: 0, busy: false, queueLength: 1 }), "active");
});

test("layout policy tolerates incomplete runtime state", () => {
  assert.equal(conversationLayout(), "welcome");
  assert.equal(conversationLayout({ messageCount: "2" }), "active");
});
