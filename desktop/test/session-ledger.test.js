const test = require("node:test");
const assert = require("node:assert/strict");
const { SessionLedger } = require("../src/session-ledger");

test("ledger assigns ordered session-scoped sequence numbers", () => {
  const ledger = new SessionLedger();
  ledger.start("s1");
  assert.deepEqual(ledger.append("agent-update", { text: "one" }), {
    sessionId: "s1",
    generation: 1,
    sequence: 1,
    type: "agent-update",
    data: { text: "one" },
  });
  assert.equal(ledger.append("agent-update", { text: "two" }).sequence, 2);
});

test("ledger chunks complete ordered snapshots under a byte budget", () => {
  const ledger = new SessionLedger();
  ledger.start("s1");
  ledger.append("agent-update", { text: "a".repeat(120) });
  ledger.append("task-status", { state: "started" });
  const chunks = ledger.chunks("s1", 180);
  assert.equal(chunks.flatMap((chunk) => chunk.entries).length, 2);
  assert.deepEqual(chunks.flatMap((chunk) => chunk.entries).map((entry) => entry.sequence), [1, 2]);
});

test("ledger removes dangerous keys before recording an event", () => {
  const ledger = new SessionLedger();
  ledger.start("s1");
  const entry = ledger.append("diagnostic", { text: "visible", apiKey: "secret", token: "secret" });
  assert.deepEqual(entry.data, { text: "visible" });
});

test("starting another session resets entries and increments generation", () => {
  const ledger = new SessionLedger();
  ledger.start("s1");
  ledger.append("agent-update", { text: "old" });
  ledger.start("s2");
  assert.deepEqual(ledger.snapshot("s2"), {
    sessionId: "s2", generation: 2, firstSequence: null, lastSequence: null, entries: [],
  });
  assert.equal(ledger.append("agent-update", { text: "new" }).sequence, 1);
});
