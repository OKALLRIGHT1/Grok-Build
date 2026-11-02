const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");

const mainPath = path.resolve(__dirname, "../src/main.js");
const mainRequire = createRequire(mainPath);

function harness(requestHook, env = process.env, isolated = true) {
  const instances = [];
  const handlers = new Map();
  const events = [];
  let ready;
  class FakeClient extends EventEmitter {
    constructor(command, args, options) {
      super();
      Object.assign(this, { command, args, options, calls: [], stops: 0 });
      instances.push(this);
    }
    start() { this.process = {}; }
    stop() { this.stops += 1; this.process = null; this.emit("exit", { code: 0 }); }
    notify() {}
    async request(method, params) {
      this.calls.push({ method, params });
      const response = await requestHook?.(method, params, this);
      if (response !== undefined) return response;
      if (method === "initialize") return { authMethods: [], _meta: { modelState: { currentModelId: "grok-build", models: [{ id: "grok-build", name: "Grok" }, { id: "other", name: "Other" }] } } };
      if (method === "session/new") return { sessionId: `session-${this.calls.length}`, models: { currentModelId: "grok-build", models: [{ id: "grok-build", name: "Grok" }, { id: "other", name: "Other" }] } };
      if (method === "session/load") return {};
      if (method === "x.ai/session/list") return { sessions: [] };
      return {};
    }
  }
  const electron = {
    app: { getVersion: () => "test", getPath: () => path.resolve(__dirname), on() {}, whenReady: () => ({ then(callback) { ready = callback; } }) },
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
  };
  const context = vm.createContext({
    require: (name) => name === "electron" ? electron : name === "./proxy-discovery" ? { discoverProxyEnvironment: async () => ({}) } : name === "./acp-client" ? { ...mainRequire(name), AcpClient: FakeClient } : mainRequire(name),
    __dirname: path.dirname(mainPath), process: { ...process, env }, console, setTimeout, clearTimeout, Buffer,
    events,
  });
  const source = fs.readFileSync(mainPath, "utf8");
  vm.runInContext(source + `
    resolveBackend = async () => ({ executablePath: 'official-grok.exe', version: '0.2.101', supportsIsolatedStdio: ${isolated} });
    getCustomModelStore = () => ({ environment: () => ({}), listProviders: () => [] });
    loadPreferredModelId = () => null;
    persistPreferredModelId = () => {};
    persistPermissionMode = () => {};
    emitBackendDiagnostic = () => {};
    send = (channel, data) => events.push({ channel, data });
    broadcastRuntime = () => {};
    createWindow = () => {};
    createTray = () => {};
    loadPermissionMode = () => 'ask';
    globalThis.connection = { ensureBackend, startAgent, stopAgent, closeWorkspace, connectionInfo, loadSession, handleControlAction, runtimeState };
  `, context, { filename: mainPath });
  return { ...context.connection, instances, events, handlers, launch: () => ready(), count: (method) => instances.flatMap((item) => item.calls).filter((call) => call.method === method).length };
}

test("app startup connects CLI without choosing or scanning a project", async () => {
  const app = harness();
  app.launch();
  await app.ensureBackend();
  const info = await app.startAgent();
  assert.equal(app.instances.length, 1);
  assert.equal(app.count("initialize"), 1);
  assert.equal(app.count("session/new"), 0);
  assert.equal(info.cliConnected, true);
  assert.equal(info.connected, false);
  assert.equal(info.workspace, null);
  assert.equal(info.status, "cli-ready");
});

test("background command failures preserve their source across the notification bridge", async () => {
  const app = harness();
  await app.ensureBackend();
  app.instances[0].emit("notification", {
    method: "_x.ai/task_completed",
    params: { update: { sessionUpdate: "task_completed", task_snapshot: {
      task_id: "chrome-qa", exit_code: 1, display_command: "chrome --headless=new",
      output: "DevTools listening on ws://127.0.0.1:9333\nchrome\\updater\\ipc: Access denied",
    } } },
  });
  const failure = app.events.find((event) => event.channel === "agent:turn-error");
  assert.equal(failure.data.source, "background-task");
  assert.match(failure.data.message, /退出码 1/);
  const status = app.events.find((event) => event.channel === "agent:task-status");
  assert.equal(status.data.source, "background");
  assert.equal(app.connectionInfo().cliConnected, true);
});

test("desktop preserves CLI auth/profile environment and uses native metadata in a private worker", async () => {
  const env = { ...process.env, GROK_HOME: 'C:/qa/original-cli-home', XAI_API_KEY: 'qa-placeholder', GROK_CLIENT_VERSION: 'terminal-value' };
  const app = harness(undefined, env);
  await app.startAgent(path.resolve(__dirname));
  const worker = app.instances[0];
  assert.deepEqual(worker.args, ['agent', '--no-leader', 'stdio']);
  assert.equal(worker.options.env.GROK_HOME, env.GROK_HOME);
  assert.equal(worker.options.env.XAI_API_KEY, env.XAI_API_KEY);
  assert.equal(worker.options.env.GROK_CLIENT_VERSION, 'terminal-value');
  const initialize = worker.calls.find((call) => call.method === 'initialize').params;
  assert.equal(initialize.clientInfo.name, 'grok-build-desktop');
  assert.equal(initialize.clientInfo.version, 'test');
  assert.equal(initialize._meta, undefined);
  assert.equal(app.connectionInfo().backendVersion, '0.2.101');
  assert.equal(app.connectionInfo().connectionMode, 'isolated-stdio');
  await app.handlers.get('agent:prompt')(null, { text: 'Hello' });
  const created = worker.calls.find((call) => call.method === 'session/new').params;
  assert.equal(created._meta.clientIdentifier, undefined);
});

test("older shared-worker CLIs retain a scoped client namespace", async () => {
  const app = harness(undefined, process.env, false);
  await app.startAgent(path.resolve(__dirname));
  const worker = app.instances[0];
  assert.deepEqual(worker.args, ['agent', 'stdio']);
  assert.equal(worker.calls.find((call) => call.method === 'initialize').params._meta.clientIdentifier, 'grok-desktop');
  assert.equal(app.connectionInfo().connectionMode, 'shared-stdio');
});

test("switching projects and creating tasks reuse the initialized CLI", async () => {
  const app = harness();
  const alpha = path.resolve(__dirname, "alpha");
  const beta = path.resolve(__dirname, "beta");
  await app.startAgent();
  const first = await app.startAgent(alpha);
  assert.equal((await app.startAgent(alpha)).sessionId, first.sessionId);
  await app.startAgent(beta);
  const fresh = await app.startAgent(beta, "new task", { newSession: true });
  assert.equal(fresh.workspace, beta);
  assert.equal(fresh.connected, true);
  assert.equal(app.instances.length, 1);
  assert.equal(app.count("initialize"), 1);
  assert.equal(app.count("session/new"), 0);
  assert.equal(fresh.sessionId, null);
  assert.equal(app.instances[0].stops, 0);
});

test("closing the last project keeps CLI available for another project", async () => {
  const app = harness();
  await app.startAgent(path.resolve(__dirname));
  const closed = app.closeWorkspace();
  assert.equal(closed.workspace, null);
  assert.equal(closed.sessionId, null);
  assert.equal(closed.cliConnected, true);
  assert.equal(closed.connected, false);
  await app.startAgent(path.resolve(__dirname, "another"));
  assert.equal(app.instances.length, 1);
  assert.equal(app.instances[0].stops, 0);
});

test("first valid send creates one session and later messages reuse it", async () => {
  const app = harness();
  const cwd = path.resolve(__dirname);
  await app.startAgent(cwd);
  const prompt = app.handlers.get("agent:prompt");
  assert.equal((await prompt(null, { text: "" })).ok, false);
  assert.equal((await prompt(null, { text: "x".repeat(100001) })).ok, false);
  assert.equal(app.count("session/new"), 0);
  assert.equal((await prompt(null, { text: "First" })).ok, true);
  assert.equal(app.count("session/new"), 1);
  const id = app.connectionInfo().sessionId;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await prompt(null, { text: "Second" })).ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.count("session/new"), 1);
  assert.equal(app.count("session/prompt"), 2);
  assert.equal(app.connectionInfo().sessionId, id);
  await app.startAgent(cwd, "new task", { newSession: true });
  assert.equal(app.connectionInfo().sessionId, null);
  assert.equal(app.count("session/new"), 1);
});

test("simultaneous first sends share session preparation and queue the second message", async () => {
  let release;
  let finishPrompt;
  const app = harness((method) => {
    if (method === "session/new") return new Promise((resolve) => { release = resolve; });
    if (method === "session/prompt") return new Promise((resolve) => { finishPrompt = resolve; });
  });
  await app.startAgent(path.resolve(__dirname));
  const prompt = app.handlers.get("agent:prompt");
  const first = prompt(null, { text: "First" });
  const second = prompt(null, { text: "Second" });
  assert.equal(app.count("session/new"), 1);
  await assert.rejects(app.startAgent(path.resolve(__dirname, "other")), /等待/);
  release({ sessionId: "one-session" });
  const results = await Promise.all([first, second]);
  assert.equal(results[0].ok, true);
  assert.equal(results[1].data.queued, true);
  assert.equal(app.count("session/new"), 1);
  finishPrompt({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.count("session/prompt"), 2);
  finishPrompt({});
});

test("draft model, effort and permission selections do not create a session and apply on first send", async () => {
  const app = harness();
  await app.startAgent(path.resolve(__dirname));
  assert.equal((await app.handlers.get("agent:set-model")(null, "other", "high")).ok, true);
  assert.equal((await app.handlers.get("agent:set-permission-mode")(null, "always-approve")).ok, true);
  assert.equal(app.count("session/new"), 0);
  assert.equal(app.count("session/set_model"), 0);
  assert.equal((await app.handlers.get("agent:prompt")(null, { text: "Start" })).ok, true);
  const calls = app.instances[0].calls;
  const change = calls.find((call) => call.method === "session/set_model");
  assert.equal(change.params.modelId, "other");
  assert.equal(change.params._meta.reasoningEffort, "high");
  assert.equal(app.runtimeState.permissionMode, "always-approve");
});

test("cancelling first-send preparation does not send the pending message", async () => {
  let release;
  const app = harness((method) => {
    if (method === "session/new") return new Promise((resolve) => { release = resolve; });
  });
  await app.startAgent(path.resolve(__dirname));
  const first = app.handlers.get("agent:prompt")(null, { text: "Cancel me" });
  await app.handlers.get("agent:cancel")();
  release({ sessionId: "cancelled-draft" });
  assert.equal((await first).ok, false);
  assert.equal(app.count("session/prompt"), 0);
  assert.equal(app.runtimeState.busy, false);
});

test("mobile control sends the first message from a selected project without an existing session", async () => {
  const app = harness();
  await app.startAgent(path.resolve(__dirname));
  assert.equal(app.connectionInfo().connected, true);
  assert.equal(app.connectionInfo().sessionId, null);
  const result = await app.handleControlAction("prompt", { text: "Hello from phone" });
  assert.equal(result.accepted, true);
  assert.equal(app.count("session/new"), 1);
  assert.equal(app.count("session/prompt"), 1);
});

test("concurrent startup callers share a single initialize request", async () => {
  const app = harness();
  const clients = await Promise.all([app.ensureBackend(), app.ensureBackend(), app.ensureBackend()]);
  assert.equal(new Set(clients).size, 1);
  assert.equal(app.instances.length, 1);
  assert.equal(app.count("initialize"), 1);
});

test("a first-send preparation failure retains the selected project and CLI", async () => {
  let rejectProject = false;
  const app = harness((method) => {
    if (method === "session/new" && rejectProject) throw new Error("Project directory is unavailable");
  });
  const first = await app.startAgent(path.resolve(__dirname));
  rejectProject = true;
  const failed = await app.handlers.get("agent:prompt")(null, { text: "First message" });
  assert.equal(failed.ok, false);
  assert.match(failed.error.message, /unavailable/);
  const info = app.connectionInfo();
  assert.equal(info.sessionId, first.sessionId);
  assert.equal(info.workspace, first.workspace);
  assert.equal(info.cliConnected, true);
  assert.equal(info.connected, true);
  assert.equal(app.runtimeState.busy, false);
  assert.equal(app.instances[0].stops, 0);
});

test("authentication is handled on the existing connection", async () => {
  let needsAuth = true;
  const app = harness((method) => {
    if (method === "session/new" && needsAuth) throw Object.assign(new Error("Authentication required"), { code: -32000 });
    if (method === "authenticate") needsAuth = false;
  });
  const pending = await app.startAgent(path.resolve(__dirname));
  assert.equal(app.count("session/new"), 0);
  assert.equal(pending.cliConnected, true);
  const firstSend = await app.handlers.get("agent:prompt")(null, { text: "Hello" });
  assert.equal(firstSend.ok, false);
  assert.equal(firstSend.error.code, "AUTH_REQUIRED");
  const loggedIn = await app.handlers.get("agent:authenticate")(null, "grok.com");
  assert.equal(loggedIn.ok, true);
  assert.equal(loggedIn.data.connected, true);
  assert.equal(loggedIn.data.sessionId, null);
  assert.equal(app.count("session/new"), 1);
  assert.equal((await app.handlers.get("agent:prompt")(null, { text: "Hello" })).ok, true);
  assert.equal(app.count("session/new"), 2);
  assert.equal(app.instances.length, 1);
});

test("history can be resumed before opening a project, without creating a throwaway session", async () => {
  const app = harness();
  await app.ensureBackend();
  const resumed = await app.loadSession({ id: "existing-session", cwd: path.resolve(__dirname) });
  assert.equal(resumed.sessionId, "existing-session");
  assert.equal(resumed.connected, true);
  assert.equal(app.count("session/new"), 0);
  assert.equal(app.count("session/load"), 1);
  assert.equal(app.instances.length, 1);
});

test("active tasks block a project switch instead of terminating CLI", async () => {
  const app = harness();
  await app.startAgent(path.resolve(__dirname));
  app.runtimeState.busy = true;
  await assert.rejects(app.startAgent(path.resolve(__dirname, "another")), /等待/);
  assert.throws(() => app.closeWorkspace(), /等待/);
  assert.equal(app.instances[0].stops, 0);
});

test("configuration reload explicitly restarts CLI, and unexpected exits can reconnect", async () => {
  const app = harness();
  await app.startAgent(path.resolve(__dirname));
  await app.startAgent(path.resolve(__dirname), "apply models", { forceRestart: true });
  assert.equal(app.instances.length, 2);
  assert.equal(app.instances[0].stops, 1);
  app.instances[1].emit("exit", { code: 1 });
  assert.equal(app.connectionInfo().cliConnected, false);
  await app.startAgent(path.resolve(__dirname));
  assert.equal(app.instances.length, 3);
  assert.equal(app.connectionInfo().connected, true);
});

test("a stopped initialize cannot overwrite a newer CLI connection", async () => {
  let release;
  let firstInitialize = true;
  const app = harness((method) => {
    if (method === "initialize" && firstInitialize) {
      firstInitialize = false;
      return new Promise((resolve) => { release = resolve; });
    }
  });
  const old = app.ensureBackend();
  const rejected = assert.rejects(old, /superseded/);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  await app.stopAgent();
  const current = await app.ensureBackend();
  release({ authMethods: [{ id: "stale-auth" }] });
  await rejected;
  assert.equal(current, app.instances[1]);
  assert.equal(app.connectionInfo().cliConnected, true);
  assert.equal(app.connectionInfo().authMethods.length, 0);
});

test("project history is loaded across all workspaces without switching the active session", async () => {
  const app = harness((method) => {
    if (method === "x.ai/session_summaries/workspace_list") return { all_sessions: {
      "C:/alpha": [{ info: { id: "alpha-old" }, generated_title: "Alpha" }],
      "D:/beta": [{ info: { id: "beta-old" }, generated_title: "Beta" }],
    } };
  });
  const first = await app.startAgent(path.resolve(__dirname));
  const result = await app.handlers.get("agent:list-sessions")(null, "", { scope: "projects" });
  assert.equal(result.ok, true);
  assert.equal(result.data.sessions.length, 2);
  assert.equal(app.connectionInfo().sessionId, first.sessionId);
  assert.equal(app.count("session/new"), 0);
});

test("older CLIs use an unscoped history query as fallback", async () => {
  const app = harness((method) => {
    if (method === "x.ai/session_summaries/workspace_list") throw Object.assign(new Error("Method not found"), { code: -32601 });
  });
  await app.startAgent(path.resolve(__dirname));
  const result = await app.handlers.get("agent:list-sessions")(null, "", { scope: "projects" });
  assert.equal(result.ok, true);
  const request = app.instances[0].calls.find((call) => call.method === "x.ai/session/list");
  assert.equal(request.params.cwd, undefined);
});

test("billing retries a transient network failure and returns the real response", async () => {
  let requests = 0;
  const app = harness((method) => {
    if (method !== "x.ai/billing") return;
    requests += 1;
    if (requests === 1) throw new Error("error sending request for url");
    return { config: { creditUsagePercent: 42 }, subscription_tier: "SuperGrok" };
  });
  const result = await app.handlers.get("agent:billing")(null);
  assert.equal(result.data.usagePercent, 42);
  assert.equal(requests, 2);
});

test("billing login failures are actionable and do not enter a retry loop", async () => {
  const app = harness((method) => {
    if (method === "x.ai/billing") throw new Error("Authentication required to fetch billing data");
  });
  const result = await app.handlers.get("agent:billing")(null);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "BILLING_AUTH_REQUIRED");
  assert.equal(app.count("x.ai/billing"), 1);
});
