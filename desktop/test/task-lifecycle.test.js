const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TaskLifecycle } = require("../src/task-lifecycle");

test("task lifecycle emits a started event and a single completed terminal event", () => {
  const lifecycle = new TaskLifecycle({ createId: () => "turn-1", now: () => 42 });

  assert.deepEqual(lifecycle.start("mobile"), {
    id: "turn-1",
    state: "started",
    source: "mobile",
    timestamp: 42,
  });
  assert.deepEqual(lifecycle.complete("turn-1"), {
    id: "turn-1",
    state: "completed",
    source: "mobile",
    timestamp: 42,
  });
  assert.equal(lifecycle.complete("turn-1"), null);
});

test("task lifecycle keeps an interrupted task interrupted when a late request settles", () => {
  const lifecycle = new TaskLifecycle({ createId: () => "turn-1", now: () => 42 });
  lifecycle.start("desktop");

  assert.equal(lifecycle.interrupt().state, "interrupted");
  assert.equal(lifecycle.isInterrupted("turn-1"), true);
  assert.equal(lifecycle.complete("turn-1"), null);
  assert.equal(lifecycle.fail("turn-1"), null);
  assert.equal(lifecycle.snapshot().state, "interrupted");
});

test("task lifecycle ignores idle and duplicate terminal events and starts a fresh task", () => {
  let nextId = 0;
  const lifecycle = new TaskLifecycle({ createId: () => `turn-${++nextId}`, now: () => 42 });

  assert.equal(lifecycle.interrupt(), null);
  lifecycle.start("desktop");
  assert.equal(lifecycle.fail("turn-1").state, "failed");
  assert.equal(lifecycle.interrupt(), null);
  assert.equal(lifecycle.complete("turn-1"), null);
  assert.deepEqual(lifecycle.start("mobile"), {
    id: "turn-2",
    state: "started",
    source: "mobile",
    timestamp: 42,
  });
});

test("task lifecycle snapshots are defensive copies", () => {
  const lifecycle = new TaskLifecycle({ createId: () => "turn-1", now: () => 42 });
  const snapshot = lifecycle.start("desktop");
  snapshot.state = "failed";
  snapshot.source = "changed";

  assert.deepEqual(lifecycle.snapshot(), {
    id: "turn-1",
    state: "started",
    source: "desktop",
    timestamp: 42,
  });
});

test("main process broadcasts task lifecycle events to desktop and remote clients", () => {
  const root = path.resolve(__dirname, "..");
  const main = fs.readFileSync(path.join(root, "src", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "src", "preload.js"), "utf8");

  assert.match(main, /TaskLifecycle/);
  assert.match(main, /task:\s*taskLifecycle\.snapshot\(\)/);
  assert.match(main, /"agent:task-status"\s*:\s*"task-status"/);
  assert.match(main, /function emitTaskStatus\(event\)/);
  assert.match(preload, /onTaskStatus:\s*\(callback\)\s*=>\s*subscribe\("agent:task-status", callback\)/);
});
