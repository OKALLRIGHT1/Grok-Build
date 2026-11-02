const test = require("node:test");
const assert = require("node:assert/strict");
const {
  acceptChunk,
  acceptLive,
  beginSync,
  completeSync,
  createSyncState,
} = require("../src/mobile-session-sync-policy");

function entry(sequence, type = "agent-update") {
  return { sessionId: "s1", generation: 2, sequence, type, data: { sequence } };
}

test("mobile replay accepts ordered chunks and releases newer buffered live events", () => {
  const state = createSyncState();
  beginSync(state, { sessionId: "s1", generation: 2, chunkCount: 2 });
  assert.deepEqual(acceptChunk(state, { sessionId: "s1", generation: 2, index: 0, entries: [entry(1)] }), [entry(1)]);
  assert.equal(acceptLive(state, entry(3)), null);
  assert.deepEqual(acceptChunk(state, { sessionId: "s1", generation: 2, index: 1, entries: [entry(2)] }), [entry(2)]);
  assert.deepEqual(completeSync(state, { sessionId: "s1", generation: 2, lastSequence: 2 }), [entry(3)]);
});

test("mobile replay rejects out-of-order chunks and ignores duplicate entries after reconnect", () => {
  const state = createSyncState();
  beginSync(state, { sessionId: "s1", generation: 2, chunkCount: 1 });
  assert.throws(() => acceptChunk(state, { sessionId: "s1", generation: 2, index: 1, entries: [entry(1)] }), /顺序/);
  assert.deepEqual(acceptChunk(state, { sessionId: "s1", generation: 2, index: 0, entries: [entry(1)] }), [entry(1)]);
  assert.deepEqual(completeSync(state, { sessionId: "s1", generation: 2, lastSequence: 1 }), []);
  assert.equal(acceptLive(state, entry(1)), null);
  assert.deepEqual(acceptLive(state, entry(2)), entry(2));
});

test("mobile replay rejects stale session messages without clearing current state", () => {
  const state = createSyncState();
  beginSync(state, { sessionId: "s1", generation: 2, chunkCount: 1 });
  assert.throws(() => acceptChunk(state, { sessionId: "other", generation: 2, index: 0, entries: [] }), /会话已切换/);
});
