const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AvatarStore } = require("../src/avatar-store");

function temporaryStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "grok-avatar-store-"));
  return { directory, store: new AvatarStore({ directory }) };
}

test("avatar store persists global user and assistant PNG data URLs", () => {
  const { directory, store } = temporaryStore();
  const user = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  const assistant = Buffer.from([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);

  store.set("user", user);
  store.set("assistant", assistant);

  assert.deepEqual(store.getAll(), {
    user: `data:image/png;base64,${user.toString("base64")}`,
    assistant: `data:image/png;base64,${assistant.toString("base64")}`,
  });
  assert.deepEqual(fs.readFileSync(path.join(directory, "user.png")), user);
  assert.deepEqual(fs.readFileSync(path.join(directory, "assistant.png")), assistant);
});

test("avatar store rejects unknown roles, non-PNG data, and oversized output", () => {
  const { store } = temporaryStore();

  assert.throws(() => store.set("model", Buffer.from("no")), /头像类型/);
  assert.throws(() => store.set("user", Buffer.from("not png")), /PNG/);
  const oversized = Buffer.alloc(1024 * 1024 + 1, 1);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(oversized);
  assert.throws(() => store.set("user", oversized), /1 MB/);
});

test("reset removes one avatar without changing the other", () => {
  const { store } = temporaryStore();
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]);
  store.set("user", png);
  store.set("assistant", png);

  store.reset("user");

  assert.equal(store.getAll().user, null);
  assert.match(store.getAll().assistant, /^data:image\/png;base64,/);
});
