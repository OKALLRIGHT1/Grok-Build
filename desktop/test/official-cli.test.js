const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(desktopRoot, relative), "utf8");

const {
  OfficialCliStore,
  discoverOfficialCli,
  parseUpdateStatus,
  validateOfficialCli,
} = require("../src/official-cli");

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "grok-official-cli-")), "official-cli.json");
}

test("official CLI store persists only a validated executable path", () => {
  const filePath = tempFile();
  const store = new OfficialCliStore(filePath);

  assert.equal(store.get(), null);
  store.save({ executablePath: "C:\\Program Files\\Grok Build\\grok.exe" });
  assert.deepEqual(store.get(), { executablePath: "C:\\Program Files\\Grok Build\\grok.exe" });
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, "utf8")), {
    executablePath: "C:\\Program Files\\Grok Build\\grok.exe",
  });
});

test("official CLI discovery only accepts the PATH executable", () => {
  assert.equal(discoverOfficialCli(() => "C:\\Users\\me\\.local\\bin\\grok.exe"), "C:\\Users\\me\\.local\\bin\\grok.exe");
  assert.equal(discoverOfficialCli(() => null), null);
});

test("official CLI validation requires version output and ACP stdio support", async () => {
  const calls = [];
  const valid = await validateOfficialCli("C:\\grok.exe", {
    run: async (command, args) => {
      calls.push([command, args]);
      if (args[0] === "version") return { stdout: "grok 0.2.101\n", stderr: "" };
      return { stdout: "Run the agent over stdio\n", stderr: "" };
    },
  });

  assert.deepEqual(valid, { executablePath: "C:\\grok.exe", version: "0.2.101", supportsIsolatedStdio: false });
  assert.deepEqual(calls, [
    ["C:\\grok.exe", ["version"]],
    ["C:\\grok.exe", ["agent", "stdio", "--help"]],
    ["C:\\grok.exe", ["agent", "--help"]],
  ]);

  await assert.rejects(
    validateOfficialCli("C:\\grok.exe", { run: async () => ({ stdout: "not grok", stderr: "" }) }),
    /Grok Build CLI/i,
  );
});

test("CLI capability probing detects private stdio support without assuming it", async () => {
  const options = { run: async (_command, args) => ({ stdout: args[0] === 'version' ? 'grok 0.2.101' : args.length === 2 ? 'Options:\n  --no-leader   Start a new agent' : 'Run the agent over stdio' }) };
  assert.equal((await validateOfficialCli('grok.exe', options)).supportsIsolatedStdio, true);
});

test("official CLI update output is reduced to safe user-facing fields", () => {
  assert.deepEqual(parseUpdateStatus(JSON.stringify({
    currentVersion: "0.2.100",
    latestVersion: "0.2.101",
    updateAvailable: true,
    channel: "stable",
    installer: "npm",
    error: null,
    debugPath: "C:\\private\\trace.log",
  })), {
    currentVersion: "0.2.100",
    latestVersion: "0.2.101",
    updateAvailable: true,
    channel: "stable",
    installer: "npm",
    error: null,
  });
  assert.throws(() => parseUpdateStatus("not-json"), /无法解析官方更新结果/);
});

test("desktop only launches the selected official CLI and exposes update controls", () => {
  const main = read("src/main.js");
  const preload = read("src/preload.js");
  const html = read("src/renderer/index.html");
  const renderer = read("src/renderer/renderer.js");

  assert.match(main, /OfficialCliStore/);
  assert.match(main, /official-cli:choose/);
  assert.match(main, /official-cli:update-check/);
  assert.match(main, /official-cli:update-install/);
  assert.doesNotMatch(main, /resourcesPath, "bin", "grok\.exe"/);
  assert.match(preload, /getOfficialCli/);
  assert.match(preload, /chooseOfficialCli/);
  assert.match(preload, /checkOfficialCliUpdate/);
  assert.match(preload, /installOfficialCliUpdate/);
  for (const id of ["official-cli-path", "choose-official-cli", "check-official-cli-update", "install-official-cli-update", "official-cli-update-dialog"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(renderer, /api\.getOfficialCli/);
  assert.match(renderer, /api\.checkOfficialCliUpdate/);
  for (const id of ["settings-button", "settings-dialog", "settings-grok-build", "settings-appearance", "settings-workspaces", "settings-mobile", "settings-account", "settings-advanced", "open-official-cli-settings"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing #${id}`);
  }
  assert.match(renderer, /openSettings\("grok-build"\)/);
});

test("Windows packages contain only the frontend", () => {
  const packageJson = JSON.parse(read("package.json"));
  const readme = read("README.md");

  assert.doesNotMatch(packageJson.scripts["dist:win"], /stage:backend/);
  assert.equal(packageJson.build.extraResources, undefined);
  assert.match(readme, /official Grok Build/);
  assert.match(readme, /separately installed/);
});
