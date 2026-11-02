const test = require("node:test");
const assert = require("node:assert/strict");
const { ConnectionGeneration } = require("../src/connection-generation");

test("a superseded connection generation cannot clean up the active connection", () => {
  const lifecycle = new ConnectionGeneration();
  const first = lifecycle.begin();
  const second = lifecycle.begin();

  assert.equal(lifecycle.isCurrent(first), false);
  assert.equal(lifecycle.isCurrent(second), true);
  assert.equal(lifecycle.invalidate(first), false);
  assert.equal(lifecycle.isCurrent(second), true);
  assert.equal(lifecycle.invalidate(second), true);
  assert.equal(lifecycle.isCurrent(second), false);
});

test("an explicit stop invalidates the current generation", () => {
  const lifecycle = new ConnectionGeneration();
  const current = lifecycle.begin();

  lifecycle.invalidateCurrent();

  assert.equal(lifecycle.isCurrent(current), false);
});
