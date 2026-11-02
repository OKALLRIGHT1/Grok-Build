const test = require("node:test");
const assert = require("node:assert/strict");
const { proxyPorts, discoverProxyEnvironment } = require("../src/proxy-discovery");

const tasks = '"FlClashCore.exe","20236","Console","1","1,000 K"\n"other.exe","9000","Console","1","1,000 K"';
const sockets = ' TCP 0.0.0.0:1053 0.0.0.0:0 LISTENING 20236\n TCP 127.0.0.1:7890 0.0.0.0:0 LISTENING 20236\n TCP 198.18.0.1:56054 0.0.0.0:0 LISTENING 20236\n TCP 127.0.0.1:8888 0.0.0.0:0 LISTENING 9000';

test("only proxy-owned local listening ports are discovery candidates", () => {
  assert.deepEqual(proxyPorts(tasks, sockets), [7890, 1053]);
});

test("discovery validates a route before adding it to the CLI environment", async () => {
  const probed = [];
  const result = await discoverProxyEnvironment({}, {
    platform: "win32",
    execute: async (name) => ({ stdout: name === "tasklist.exe" ? tasks : sockets }),
    probe: async (port) => { probed.push(port); return port === 7890; },
  });
  assert.equal(result.HTTPS_PROXY, "http://127.0.0.1:7890");
  assert.deepEqual(probed, [7890, 1053]);
});

test("explicit proxy preferences are retained and failed probes never become a proxy", async () => {
  const skip = await discoverProxyEnvironment({ HTTPS_PROXY: "http://custom:1234" }, { platform: "win32", execute: () => { throw new Error("must not inspect processes"); } });
  assert.deepEqual(skip, {});
  const failed = await discoverProxyEnvironment({}, {
    platform: "win32", execute: async (name) => ({ stdout: name === "tasklist.exe" ? tasks : sockets }), probe: async () => false,
  });
  assert.deepEqual(failed, {});
});
