const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { AcpClient, selectAuthMethod } = require("../src/acp-client");
const { cliConnectionPolicy } = require("../src/cli-connection-policy");
const { validateOfficialCli } = require("../src/official-cli");

const backend = process.env.GROK_DESKTOP_AGENT || path.resolve(__dirname, "../../target/release/xai-grok-pager.exe");
const workspace = path.resolve(__dirname, "../..");
const smokeWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "grok-desktop-smoke-"));
let client;

async function main() {
  const validated = await validateOfficialCli(backend);
  const policy = cliConnectionPolicy("desktop-smoke", validated.supportsIsolatedStdio);
  client = new AcpClient(backend, policy.args, {
    cwd: workspace,
    env: { ...process.env, GROK_HOME: path.join(smokeWorkspace, ".grok") },
  });
  client.on("request", (message) => {
    const method = String(message.method || "").replace(/^_(?=x\.ai\/)/, "");
    if (method === "x.ai/folder_trust/request") client.respond(message.id, { outcome: "trust" });
    else if (method === "session/request_permission") client.respond(message.id, { outcome: { outcome: "cancelled" } });
    else client.respondError(message.id, -32601, `smoke client does not support ${method}`);
  });
  client.start();
  let timeout;
  const result = await Promise.race([
    client.request("initialize", policy.initialize),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error("ACP initialize timed out")), 30000);
    }),
  ]).finally(() => clearTimeout(timeout));
  assert.ok(result && typeof result === "object");
  assert.ok(Array.isArray(result.authMethods), "initialize response must advertise authMethods");
  async function checkedRequest(method, params) {
    try {
      return await client.request(method, params);
    } catch (error) {
      error.message = `${method}: ${error.message}`;
      throw error;
    }
  }
  const authInfo = await checkedRequest("x.ai/auth/info", {});
  const skillsResponse = await checkedRequest("x.ai/skills/config", { cwd: workspace });
  const promptHistory = await checkedRequest("x.ai/prompt_history", { cwd: workspace });
  assert.ok(authInfo && typeof authInfo === "object", "auth info extension must respond");
  assert.ok(skillsResponse && typeof skillsResponse === "object", "skills extension must respond");
  assert.ok(promptHistory && Array.isArray(promptHistory.prompts), "prompt history extension must return prompts");
  const methodId = selectAuthMethod(result);
  if (methodId && !["grok.com", "oidc"].includes(methodId)) await client.request("authenticate", { methodId });
  if (authInfo.methodId) {
    const session = await checkedRequest("session/new", { cwd: smokeWorkspace, mcpServers: [] });
    assert.ok(session.sessionId, "session/new must return a session ID");
    const sessionId = session.sessionId;
    const checks = await Promise.all([
      checkedRequest("x.ai/mcp/list", { sessionId, cache: true }),
      checkedRequest("x.ai/plugins/list", { sessionId }),
      checkedRequest("x.ai/hooks/list", { sessionId }),
      checkedRequest("x.ai/task/list", { sessionId }),
      checkedRequest("x.ai/subagent/list_running", { sessionId }),
    ]);
    assert.equal(checks.length, 5);
    process.stdout.write(`ACP session and extensions OK (${result.authMethods.length} auth methods)\n`);
  } else {
    process.stdout.write(`ACP initialize and public extensions OK; session checks require login (${result.authMethods.length} auth methods)\n`);
  }
}

main()
  .finally(() => {
    client?.stop();
    fs.rmSync(smokeWorkspace, { recursive: true, force: true });
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
