const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

class OfficialCliStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  get() {
    try {
      const value = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return typeof value?.executablePath === "string" && value.executablePath.trim()
        ? { executablePath: value.executablePath }
        : null;
    } catch {
      return null;
    }
  }

  save(value) {
    const executablePath = String(value?.executablePath || "").trim();
    if (!executablePath) throw new Error("官方 Grok Build 路径不能为空");
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify({ executablePath }, null, 2)}\n`, "utf8");
  }
}

function discoverOfficialCli(findExecutable) {
  const candidate = findExecutable?.("grok.exe");
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

async function runOfficialCli(command, args) {
  return execFileAsync(command, args, {
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 256 * 1024,
  });
}

async function validateOfficialCli(executablePath, { run = runOfficialCli } = {}) {
  const command = String(executablePath || "").trim();
  if (!command) throw new Error("请先选择官方 Grok Build CLI");

  let versionResult;
  try {
    versionResult = await run(command, ["version"]);
  } catch (error) {
    throw new Error(`无法启动官方 Grok Build CLI：${error.message}`);
  }
  const versionMatch = String(versionResult?.stdout || "").match(/\bgrok\s+([0-9][\w.-]*)\b/i);
  if (!versionMatch) throw new Error("所选文件不是受支持的官方 Grok Build CLI");

  let agentHelp;
  try {
    agentHelp = await run(command, ["agent", "stdio", "--help"]);
  } catch (error) {
    throw new Error(`该 Grok Build CLI 不支持 ACP 连接：${error.message}`);
  }
  if (!/\bstdio\b/i.test(String(agentHelp?.stdout || ""))) {
    throw new Error("该 Grok Build CLI 不支持 ACP stdio 连接");
  }
  let supportsIsolatedStdio = false;
  try {
    const agentOptions = await run(command, ["agent", "--help"]);
    supportsIsolatedStdio = /(?:^|\s)--no-leader(?:\s|$)/m.test(String(agentOptions?.stdout || ""));
  } catch {
    // Older CLIs keep their existing shared-leader connection behavior.
  }
  return { executablePath: command, version: versionMatch[1], supportsIsolatedStdio };
}

function parseUpdateStatus(stdout) {
  let value;
  try {
    value = JSON.parse(String(stdout || ""));
  } catch {
    throw new Error("无法解析官方更新结果");
  }
  if (!value || typeof value !== "object") throw new Error("无法解析官方更新结果");
  return {
    currentVersion: typeof value.currentVersion === "string" ? value.currentVersion : null,
    latestVersion: typeof value.latestVersion === "string" ? value.latestVersion : null,
    updateAvailable: value.updateAvailable === true,
    channel: typeof value.channel === "string" ? value.channel : null,
    installer: typeof value.installer === "string" ? value.installer : null,
    error: typeof value.error === "string" ? value.error.slice(0, 500) : null,
  };
}

module.exports = {
  OfficialCliStore,
  discoverOfficialCli,
  parseUpdateStatus,
  runOfficialCli,
  validateOfficialCli,
};
