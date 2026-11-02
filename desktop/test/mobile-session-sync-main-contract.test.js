const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.join(__dirname, "..");

test("main process records sessions and serves a targeted mobile session sync", () => {
  const main = fs.readFileSync(path.join(desktopRoot, "src", "main.js"), "utf8");
  const server = fs.readFileSync(path.join(desktopRoot, "src", "control-server.js"), "utf8");

  assert.match(main, /SessionLedger/);
  assert.match(main, /case "session-sync-request"/);
  assert.match(main, /"session-sync-begin"/);
  assert.match(main, /"session-sync-chunk"/);
  assert.match(main, /"session-sync-complete"/);
  assert.match(main, /handleControlAction\(action, payload, socket\)/);
  assert.match(server, /this\.onAction\(message\.action, message\.payload \|\| \{\}, socket\)/);
  assert.match(server, /send\(socket, type, data\)/);
});
