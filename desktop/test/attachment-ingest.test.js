const test = require("node:test");
const assert = require("node:assert/strict");
const { filesFromDataTransfer, hasFiles } = require("../src/attachment-ingest");

test("recognizes protected file drags before the browser exposes file contents", () => {
  const protectedTransfer = { types: ["Files"], files: [], items: [{ kind: "file", getAsFile: () => null }] };
  assert.equal(hasFiles(protectedTransfer), true);
  assert.deepEqual(filesFromDataTransfer(protectedTransfer), []);
  assert.equal(hasFiles({ items: [{ kind: "file" }] }), true);
  assert.equal(hasFiles({ files: [{ name: "screenshot.png", size: 10 }] }), true);
  assert.equal(hasFiles({ types: ["text/plain"], items: [{ kind: "string" }] }), false);
  assert.equal(hasFiles(null), false);
});

test("uses dropped files when the data transfer already exposes files", () => {
  const files = [{ name: "design.png", size: 12 }, { name: "notes.md", size: 24 }];

  assert.deepEqual(filesFromDataTransfer({ files }), files);
});

test("extracts an image copied from the clipboard as a file", () => {
  const screenshot = { name: "clipboard.png", type: "image/png", size: 36 };
  const files = filesFromDataTransfer({
    files: [],
    items: [
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/png", getAsFile: () => screenshot },
    ],
  });

  assert.deepEqual(files, [screenshot]);
});

test("ignores clipboard data without files", () => {
  assert.deepEqual(filesFromDataTransfer({ items: [{ kind: "string", type: "text/plain" }] }), []);
});
