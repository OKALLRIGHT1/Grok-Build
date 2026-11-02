const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, session, shell, Tray } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { AcpClient, authMethodId, requestDiagnostic, selectAuthMethod, serializeError } = require("./acp-client");
const { backgroundTaskFailure, fatalModelFailure, innerParams } = require("./agent-events");
const { normalizeBilling, normalizeModeState, normalizeModelState, normalizeSessionList, unwrapExtResult } = require("./agent-data");
const { AvatarStore } = require("./avatar-store");
const { ControlServer } = require("./control-server");
const { ConnectionGeneration } = require("./connection-generation");
const { proxyEnvironment, billingFailure } = require("./network-policy");
const { discoverProxyEnvironment } = require("./proxy-discovery");
const { cliConnectionPolicy } = require("./cli-connection-policy");
const { ModelConfigStore } = require("./model-config");
const { runModelProbe } = require("./model-probe");
const { OfficialCliStore, discoverOfficialCli, parseUpdateStatus, runOfficialCli, validateOfficialCli } = require("./official-cli");
const {
  automaticPermissionOption,
  normalizePermissionMode,
  normalizePermissionRequest,
  permissionOptionId,
  permissionResult,
} = require("./permission-policy");
const {
  isPlanApprovalMethod,
  normalizePlanApprovalRequest,
  planApprovalResult,
} = require("./plan-approval-policy");
const { buildPromptContent } = require("./prompt-content");
const { PromptQueue } = require("./prompt-queue");
const { PromptRecovery } = require("./prompt-recovery");
const { buildSessionMetadata, choosePreferredModel, mergeClientSettings } = require("./session-policy");
const { TaskLifecycle } = require("./task-lifecycle");
const { SessionLedger } = require("./session-ledger");

let mainWindow;
let client;
let sessionId;
let initializeResult;
let backendStartup = null;
let sessionTransitionInFlight = false;
let pendingPromptSession = null;
let promptPreparationEpoch = 0;
let backendCommand;
let backendVersion;
let backendConnection = cliConnectionPolicy(app.getVersion());
let controlServer;
let customModelStore;
let officialCliStore;
let avatarStore;
let tray;
let quitting = false;
let promptActive = false;
const promptQueue = new PromptQueue();
const promptRecovery = new PromptRecovery();
const taskLifecycle = new TaskLifecycle();
const sessionLedger = new SessionLedger();
const connectionGeneration = new ConnectionGeneration();
const clientsByGeneration = new Map();
const reverseRequests = new Map();
const planApprovalsById = new Map();
const planApprovalIdByToolCall = new Map();
const runtimeState = {
  workspace: null,
  cliConnected: false,
  status: "idle",
  busy: false,
  modelState: { currentModelId: null, reasoningEffort: null, models: [] },
  modeState: { currentModeId: null, modes: [] },
  permissionMode: "ask",
};
const BACKGROUND_POSITIONS = new Set([
  "left top", "center top", "right top",
  "left center", "center center", "right center",
  "left bottom", "center bottom", "right bottom",
]);

function clientSettingsPath() {
  return path.join(app.getPath("userData"), "client-settings.json");
}

function readClientSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(clientSettingsPath(), "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeClientSettings(updates) {
  const filePath = clientSettingsPath();
  const settings = mergeClientSettings(readClientSettings(), updates);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}

function loadPermissionMode() {
  return normalizePermissionMode(readClientSettings().permissionMode);
}

function persistPermissionMode(mode) {
  writeClientSettings({ permissionMode: mode });
}

function loadPreferredModelId() {
  return String(readClientSettings().preferredModelId || "").trim() || null;
}

function persistPreferredModelId(modelId) {
  writeClientSettings({ preferredModelId: String(modelId || "").trim() || null });
}

function notifyPermissionMode(acp = client) {
  if (!acp) return;
  const mode = runtimeState.permissionMode;
  acp.notify("x.ai/yolo_mode_changed", {
    ...backendConnection.sessionMeta,
    yolo_mode: mode === "always-approve",
    auto_mode: mode === "auto",
    permission_mode: mode,
  });
}

function backgroundPaths() {
  const directory = path.join(app.getPath("userData"), "appearance");
  return {
    directory,
    image: path.join(directory, "custom-background.jpg"),
    settings: path.join(directory, "background.json"),
  };
}

function readBackgroundConfig() {
  const paths = backgroundPaths();
  const defaults = { position: "center center", fit: "cover" };
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.settings, "utf8"));
    return {
      position: BACKGROUND_POSITIONS.has(parsed.position) ? parsed.position : defaults.position,
      fit: parsed.fit === "contain" ? "contain" : "cover",
    };
  } catch {
    return defaults;
  }
}

function writeBackgroundConfig(config) {
  const paths = backgroundPaths();
  fs.mkdirSync(paths.directory, { recursive: true });
  fs.writeFileSync(paths.settings, JSON.stringify(config, null, 2));
}

function getBackgroundSettings() {
  const paths = backgroundPaths();
  const config = readBackgroundConfig();
  if (!fs.existsSync(paths.image)) return { ...config, custom: false, dataUrl: null };
  const image = nativeImage.createFromPath(paths.image);
  if (image.isEmpty()) return { ...config, custom: false, dataUrl: null };
  return { ...config, custom: true, dataUrl: image.toDataURL() };
}

function getCustomModelStore() {
  if (customModelStore) return customModelStore;
  customModelStore = new ModelConfigStore({
    directory: path.join(app.getPath("userData"), "models"),
    configPath: path.join(app.getPath("home"), ".grok", "config.toml"),
    encrypt: (value) => {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows 安全存储当前不可用，无法保存 API Key");
      return safeStorage.encryptString(value).toString("base64");
    },
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
  });
  return customModelStore;
}

function getAvatarStore() {
  if (!avatarStore) {
    avatarStore = new AvatarStore({ directory: path.join(app.getPath("userData"), "avatars") });
  }
  return avatarStore;
}

function getOfficialCliStore() {
  if (!officialCliStore) {
    officialCliStore = new OfficialCliStore(path.join(app.getPath("userData"), "official-cli.json"));
  }
  return officialCliStore;
}

function findOfficialCliOnPath() {
  const names = process.platform === "win32" ? ["grok.exe", "grok"] : ["grok"];
  for (const directory of String(process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function chooseAvatar(role) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: role === "user" ? "选择你的头像" : "选择 AI 头像",
    properties: ["openFile"],
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
  });
  if (result.canceled) return null;
  const source = result.filePaths[0];
  if (fs.statSync(source).size > 30 * 1024 * 1024) throw new Error("头像原图不能超过 30 MB");
  let image = nativeImage.createFromPath(source);
  if (image.isEmpty()) throw new Error("无法读取所选头像图片");
  const size = image.getSize();
  const edge = Math.min(size.width, size.height);
  image = image.crop({
    x: Math.max(0, Math.floor((size.width - edge) / 2)),
    y: Math.max(0, Math.floor((size.height - edge) / 2)),
    width: edge,
    height: edge,
  }).resize({ width: 256, height: 256, quality: "best" });
  const avatars = getAvatarStore().set(role, image.toPNG());
  broadcastRuntime();
  return avatars;
}

async function chooseBackgroundImage() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择背景图片",
    properties: ["openFile"],
    filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
  });
  if (result.canceled) return null;
  const source = result.filePaths[0];
  if (fs.statSync(source).size > 30 * 1024 * 1024) throw new Error("背景图片不能超过 30 MB");
  let image = nativeImage.createFromPath(source);
  if (image.isEmpty()) throw new Error("无法读取所选图片");
  const size = image.getSize();
  const longest = Math.max(size.width, size.height);
  if (longest > 2560) {
    const scale = 2560 / longest;
    image = image.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: "best",
    });
  }
  const paths = backgroundPaths();
  fs.mkdirSync(paths.directory, { recursive: true });
  fs.writeFileSync(paths.image, image.toJPEG(90));
  const config = readBackgroundConfig();
  writeBackgroundConfig(config);
  return getBackgroundSettings();
}

function runtimeSnapshot() {
  let modelProviders = [];
  try {
    modelProviders = getCustomModelStore().listProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      modelIds: provider.models.map((model) => model.id),
    }));
  } catch {}
  return {
    appVersion: app.getVersion(),
    backendVersion: backendVersion || null,
    connectionMode: backendConnection.isolated ? "isolated-stdio" : "shared-stdio",
    workspace: runtimeState.workspace,
    workspaceName: runtimeState.workspace ? path.basename(runtimeState.workspace) : null,
    status: runtimeState.status,
    busy: runtimeState.busy,
    connected: Boolean(client && runtimeState.workspace && runtimeState.status === "ready"),
    cliConnected: runtimeState.cliConnected,
    sessionId: sessionId || null,
    modelState: runtimeState.modelState,
    modelProviders,
    modeState: runtimeState.modeState,
    permissionMode: runtimeState.permissionMode,
    avatars: getAvatarStore().getAll(),
    recoverablePrompt: promptRecovery.summary(),
    task: taskLifecycle.snapshot(),
    queueLength: promptQueue.list().length,
    promptQueue: promptQueue.list(),
    planApprovals: [...planApprovalsById.values()],
    control: controlServer?.info() || { running: false, connectedClients: 0 },
  };
}

function send(channel, payload) {
  const ledgerEntry = recordSessionEvent(channel, payload);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  const mobileChannels = {
    "agent:update": "agent-update",
    "agent:diagnostic": "diagnostic",
    "agent:permission": "permission",
    "agent:folder-trust": "folder-trust",
    "agent:plan-approval": "plan-approval",
    "agent:session-load-finished": "session-load-finished",
    "agent:turn-error": "turn-error",
    "agent:task-status": "task-status",
    "control:interaction-resolved": "interaction-resolved",
  };
  const mobileType = mobileChannels[channel];
  if (mobileType) controlServer?.broadcast(mobileType, ledgerEntry ? { entry: ledgerEntry, payload } : payload);
  return ledgerEntry;
}

function recordSessionEvent(channel, payload) {
  const type = {
    "agent:update": "agent-update",
    "agent:task-status": "task-status",
    "control:user-message": "user-message",
  }[channel];
  if (type && sessionId) sessionLedger.append(type, payload);
}

function emitTaskStatus(event) {
  if (!event) return null;
  send("agent:task-status", event);
  broadcastRuntime();
  return event;
}

function broadcastRuntime() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("control:runtime", runtimeSnapshot());
  controlServer?.broadcast("state", runtimeSnapshot());
}

function setAgentStatus(state, details) {
  runtimeState.status = state;
  send("agent:status", { state, details });
  broadcastRuntime();
}

function backendDiagnosticPath() {
  return path.join(app.getPath("userData"), "logs", "backend-lifecycle.log");
}

function emitBackendDiagnostic(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    const logPath = backendDiagnosticPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, line, "utf8");
  } catch {}
  send("agent:diagnostic", line);
}

function staleConnectionError(generation) {
  const error = new Error("Connection was superseded by a newer request");
  error.code = "STALE_CONNECTION";
  error.connectionGeneration = generation;
  error.connectionStale = true;
  return error;
}

function isCurrentConnection(generation, acp) {
  return connectionGeneration.isCurrent(generation) && (!acp || client === acp);
}

async function resolveBackend() {
  const saved = getOfficialCliStore().get()?.executablePath;
  const candidate = saved || discoverOfficialCli(() => findOfficialCliOnPath());
  if (!candidate) throw new Error("未检测到官方 Grok Build。请在账号与隐私中选择官方 grok.exe 后再连接。");
  const validated = await validateOfficialCli(candidate);
  return validated;
}

function wireClient(acp, generation) {
  acp.on("diagnostic", (message) => emitBackendDiagnostic(String(message).trimEnd()));
  acp.on("notification", (message) => {
    if (!isCurrentConnection(generation, acp)) return;
    const method = String(message.method || "").replace(/^_(?=x\.ai\/)/, "");
    if (method === "session/update" || method === "x.ai/session/update") {
      const params = innerParams(message.params);
      send("agent:update", params);
      stopFatalModelRetry(params);
    } else if (method === "x.ai/models/update") {
      runtimeState.modelState = normalizeModelState(message.params);
      send("agent:models", runtimeState.modelState);
      broadcastRuntime();
    } else if (method === "x.ai/session_notification") {
      const params = innerParams(message.params);
      if (params?.update?.sessionUpdate === "model_changed") {
        runtimeState.modelState = {
          ...runtimeState.modelState,
          currentModelId: params.update.model_id,
          reasoningEffort: params.update.reasoning_effort ?? null,
        };
        send("agent:models", runtimeState.modelState);
        broadcastRuntime();
      }
      send("agent:update", params);
      stopFatalModelRetry(params);
      const updateType = params?.update?.sessionUpdate;
      if (["subagent_spawned", "subagent_progress", "subagent_finished", "task_completed"].includes(updateType)) {
        send("agent:work-changed", { type: updateType });
      }
    } else if (method === "x.ai/task_completed") {
      const params = innerParams(message.params);
      send("agent:update", params);
      send("agent:work-changed", { type: "task_completed" });
      const failure = backgroundTaskFailure(params);
      if (failure) {
        send("agent:turn-error", { message: failure.message, source: "background-task" });
        emitTaskStatus({
          id: `background-${failure.taskId}`,
          state: "failed",
          source: "background",
          timestamp: Date.now(),
          message: failure.message,
        });
      }
    } else if (method.startsWith("x.ai/mcp/") || method.startsWith("x.ai/plugins/")) {
      send("agent:extensions-changed", { method });
    } else {
      send("agent:notification", message);
    }
  });
  acp.on("request", (message) => {
    if (!isCurrentConnection(generation, acp)) return;
    emitBackendDiagnostic(requestDiagnostic(message));
    const method = String(message.method || "").replace(/^_(?=x\.ai\/)/, "");
    reverseRequests.set(message.id, method);
    if (method === "session/request_permission") {
      const request = normalizePermissionRequest(message.params);
      emitBackendDiagnostic(`Permission request ${message.id}: ${request.toolCall?.title || request.toolCall?.tool || "protected tool"}; options: ${request.options.length}`);
      const option = automaticPermissionOption(request, runtimeState.permissionMode);
      if (option) {
        acp.respond(message.id, permissionResult(permissionOptionId(option)));
        emitBackendDiagnostic(`Permission request ${message.id} approved automatically with ${permissionOptionId(option)}`);
        reverseRequests.delete(message.id);
        return;
      }
      send("agent:permission", { id: message.id, ...request });
      return;
    }
    if (method === "x.ai/folder_trust/request") {
      send("agent:folder-trust", { id: message.id, ...message.params });
      return;
    }
    if (isPlanApprovalMethod(message)) {
      try {
        const request = normalizePlanApprovalRequest(message);
        const priorId = planApprovalIdByToolCall.get(request.toolCallId);
        if (priorId && priorId !== message.id) {
          reverseRequests.delete(priorId);
          planApprovalsById.delete(priorId);
        }
        const pending = { id: message.id, ...request, receivedAt: Date.now() };
        reverseRequests.set(message.id, "x.ai/exit_plan_mode");
        planApprovalsById.set(message.id, pending);
        planApprovalIdByToolCall.set(request.toolCallId, message.id);
        send("agent:plan-approval", pending);
        broadcastRuntime();
      } catch (error) {
        emitBackendDiagnostic(`Plan approval request ${message.id} rejected: ${error.message}`);
        acp.respondError(message.id, -32602, error.message);
        reverseRequests.delete(message.id);
      }
      return;
    }
    acp.respondError(message.id, -32601, `客户端暂不支持 ${method}`);
    reverseRequests.delete(message.id);
  });
  acp.on("exit", (details) => {
    if (!isCurrentConnection(generation, acp)) return;
    emitBackendDiagnostic(`Connection ${generation} backend exited: ${details.signal || details.code || "unknown"}${details.stopReason ? `; reason: ${details.stopReason}` : ""}`);
    const task = taskLifecycle.snapshot();
    emitTaskStatus(taskLifecycle.fail(task?.id));
    sessionId = undefined;
    initializeResult = undefined;
    runtimeState.cliConnected = false;
    runtimeState.busy = false;
    setAgentStatus("disconnected", details);
  });
}

async function stopAgent(updateStatus = true, options = {}) {
  const { expectedGeneration, reason = "client stop", invalidate = true } = options;
  if (expectedGeneration !== undefined && !connectionGeneration.isCurrent(expectedGeneration)) {
    emitBackendDiagnostic(`Skipped stale stop request for connection ${expectedGeneration}`);
    return false;
  }
  if (invalidate) {
    connectionGeneration.invalidateCurrent();
    backendStartup = null;
  }
  const task = taskLifecycle.snapshot();
  emitTaskStatus(taskLifecycle.fail(task?.id));
  reverseRequests.clear();
  promptQueue.clear();
  promptActive = false;
  promptRecovery.clear();
  sessionId = undefined;
  initializeResult = undefined;
  runtimeState.cliConnected = false;
  runtimeState.busy = false;
  runtimeState.modelState = { currentModelId: null, reasoningEffort: null, models: [] };
  runtimeState.modeState = { currentModeId: null, modes: [] };
  const previous = client;
  client = undefined;
  if (previous) {
    emitBackendDiagnostic(`Stopping backend: ${reason}`);
    previous.stop(reason);
    for (const [generation, candidate] of clientsByGeneration) {
      if (candidate === previous) clientsByGeneration.delete(generation);
    }
  }
  if (updateStatus) setAgentStatus("disconnected");
  return Boolean(previous);
}

async function startAgentOnce(generation) {
  setAgentStatus("connecting");
  const resolved = await resolveBackend();
  const command = resolved.executablePath;
  if (!connectionGeneration.isCurrent(generation)) throw staleConnectionError(generation);
  backendCommand = command;
  backendVersion = resolved.version;
  backendConnection = cliConnectionPolicy(app.getVersion(), resolved.supportsIsolatedStdio);
  emitBackendDiagnostic(`CLI connection: ${command}; CLI version=${backendVersion}; desktop version=${app.getVersion()}; mode=${backendConnection.isolated ? "isolated stdio, native CLI request identity" : "shared stdio, legacy client namespace"}`);
  let networkEnvironment = {};
  try {
    if (session?.defaultSession) {
      let proxyTimer;
      let resolved;
      try {
        resolved = await Promise.race([
          session.defaultSession.resolveProxy("https://cli-chat-proxy.grok.com/v1/billing?format=credits"),
          new Promise((resolve) => { proxyTimer = setTimeout(() => resolve("DIRECT"), 2500); }),
        ]);
      } finally {
        clearTimeout(proxyTimer);
      }
      networkEnvironment = proxyEnvironment(process.env, resolved);
    }
  } catch {
    emitBackendDiagnostic("System proxy could not be resolved; retaining the existing CLI network environment");
  }
  if (!Object.keys(networkEnvironment).length) {
    networkEnvironment = await discoverProxyEnvironment(process.env);
    if (Object.keys(networkEnvironment).length) emitBackendDiagnostic("Detected and validated a local proxy for CLI networking");
  }
  if (!connectionGeneration.isCurrent(generation)) throw staleConnectionError(generation);
  const acp = new AcpClient(command, backendConnection.args, {
    cwd: app.getPath("userData"),
    env: {
      ...process.env,
      ...networkEnvironment,
      ...getCustomModelStore().environment(),
    },
  });
  client = acp;
  clientsByGeneration.set(generation, acp);
  wireClient(acp, generation);
  acp.start();
  const initialized = await acp.request("initialize", backendConnection.initialize);
  if (!isCurrentConnection(generation, acp)) throw staleConnectionError(generation);
  initializeResult = initialized;

  const methodId = selectAuthMethod(initializeResult);
  if (methodId && methodId !== "grok.com" && methodId !== "oidc") {
    try {
      await acp.request("authenticate", { methodId });
    } catch (error) {
      send("agent:diagnostic", `自动登录失败: ${error.message}`);
    }
  }

  if (!isCurrentConnection(generation, acp)) throw staleConnectionError(generation);
  runtimeState.cliConnected = true;
  setAgentStatus("cli-ready");
  return acp;
}

async function connectBackend(reason) {
  const generation = connectionGeneration.begin();
  emitBackendDiagnostic(`Starting connection ${generation}: ${reason}`);
  try {
    await stopAgent(false, { reason: `${reason}: replace previous backend`, invalidate: false });
    if (!connectionGeneration.isCurrent(generation)) throw staleConnectionError(generation);
    return await startAgentOnce(generation);
  } catch (error) {
    const acp = clientsByGeneration.get(generation);
    const stale = error.connectionStale || !isCurrentConnection(generation, acp);
    error.connectionGeneration = generation;
    error.connectionStale = stale;
    if (stale) {
      emitBackendDiagnostic(`Connection ${generation} was superseded before it completed`);
    } else {
      await stopAgent(false, { expectedGeneration: generation, reason: `${reason}: startup failed` });
      emitBackendDiagnostic(`Connection ${generation} failed: ${error.message}`);
    }
    throw error;
  }
}

async function ensureBackend(reason = "connect CLI") {
  if (client && initializeResult && runtimeState.cliConnected) return client;
  if (backendStartup) return backendStartup;
  const attempt = connectBackend(reason);
  backendStartup = attempt;
  try {
    return await attempt;
  } finally {
    if (backendStartup === attempt) backendStartup = null;
  }
}

async function startAgent(cwd = null, reason = "open workspace", options = {}) {
  if (cwd && !path.isAbsolute(cwd)) throw new Error("请选择有效的工作目录");
  if (sessionTransitionInFlight || runtimeState.busy || promptActive || promptQueue.list().length || reverseRequests.size) {
    throw new Error("请等待当前任务或确认操作结束后再切换会话");
  }
  if (!cwd && !options.forceRestart) {
    await ensureBackend(reason);
    return connectionInfo();
  }
  sessionTransitionInFlight = true;
  try {
    if (options.forceRestart) await stopAgent(false, { reason });
    await ensureBackend(reason);
    if (!cwd || (!options.newSession && runtimeState.workspace === cwd && runtimeState.status === "ready")) {
      return connectionInfo();
    }
    sessionId = undefined;
    runtimeState.workspace = cwd;
    runtimeState.modelState = normalizeModelState(initializeResult.models, initializeResult._meta?.modelState);
    const preferred = choosePreferredModel(runtimeState.modelState.models, loadPreferredModelId());
    if (preferred) runtimeState.modelState.currentModelId = preferred;
    runtimeState.modeState = normalizeModeState(initializeResult.modes, initializeResult._meta?.modeState);
    promptRecovery.clear();
    setAgentStatus("ready");
    return connectionInfo({ requiresAuth: false });
  } finally {
    sessionTransitionInFlight = false;
  }
}

function closeWorkspace() {
  if (sessionTransitionInFlight || runtimeState.busy || promptActive || promptQueue.list().length || reverseRequests.size) {
    throw new Error("请等待当前任务或确认操作结束后再关闭项目");
  }
  sessionId = undefined;
  runtimeState.workspace = null;
  runtimeState.modelState = { currentModelId: null, reasoningEffort: null, models: [] };
  runtimeState.modeState = { currentModeId: null, modes: [] };
  promptRecovery.clear();
  setAgentStatus(runtimeState.cliConnected ? "cli-ready" : "idle");
  return connectionInfo();
}

function connectionInfo(extra = {}) {
  return {
    sessionId: sessionId || null,
    backend: backendCommand,
    backendVersion: backendVersion || null,
    connectionMode: backendConnection.isolated ? "isolated-stdio" : "shared-stdio",
    workspace: runtimeState.workspace,
    cliConnected: runtimeState.cliConnected,
    connected: Boolean(client && runtimeState.workspace && runtimeState.status === "ready"),
    status: runtimeState.status,
    authMethods: (initializeResult?.authMethods ?? []).map((method) => ({
      id: authMethodId(method),
      name: method.name ?? authMethodId(method),
      description: method.description ?? "",
    })).filter((method) => method.id),
    modeState: runtimeState.modeState,
    modelState: runtimeState.modelState,
    ...extra,
  };
}

async function createBackendSession(acp, cwd) {
  const preferredModelId = runtimeState.modelState.currentModelId || loadPreferredModelId();
  const reasoningEffort = runtimeState.modelState.reasoningEffort;
  const preferredModeId = runtimeState.modeState.currentModeId;
  const session = await acp.request("session/new", {
    cwd,
    mcpServers: [],
    _meta: buildSessionMetadata(runtimeState.permissionMode, preferredModelId, backendConnection.sessionMeta),
  });
  if (client !== acp || !runtimeState.cliConnected) throw staleConnectionError(connectionGeneration.current);
  const modelState = normalizeModelState(
    session.models,
    session._meta?.modelState,
    initializeResult.models,
    initializeResult._meta?.modelState,
  );
  const modeState = normalizeModeState(session.modes, session._meta?.modeState);
  const preferred = choosePreferredModel(modelState.models, preferredModelId);
  if (preferred && (modelState.currentModelId !== preferred || reasoningEffort)) {
    await acp.request("session/set_model", { sessionId: session.sessionId, modelId: preferred, ...(reasoningEffort ? { _meta: { reasoningEffort } } : {}) });
    if (client !== acp || !runtimeState.cliConnected) throw staleConnectionError(connectionGeneration.current);
    modelState.currentModelId = preferred;
    modelState.reasoningEffort = reasoningEffort || modelState.reasoningEffort;
  }
  if (preferredModeId && modeState.modes.some((mode) => mode.id === preferredModeId) && modeState.currentModeId !== preferredModeId) {
    await acp.request("session/set_mode", { sessionId: session.sessionId, modeId: preferredModeId });
    if (client !== acp || !runtimeState.cliConnected) throw staleConnectionError(connectionGeneration.current);
    modeState.currentModeId = preferredModeId;
  }
  sessionId = session.sessionId;
  runtimeState.workspace = cwd;
  runtimeState.modelState = modelState;
  runtimeState.modeState = modeState;
  promptRecovery.clear();
  sessionLedger.start(sessionId);
  notifyPermissionMode(acp);
  setAgentStatus("ready");
  return connectionInfo({ requiresAuth: false });
}

function requireSession() {
  if (!client || !sessionId || runtimeState.status !== "ready") throw new Error("请先连接工作目录");
  return { client, sessionId };
}

async function setSessionModel(modelId, reasoningEffort) {
  if (!client || !runtimeState.workspace || runtimeState.status !== "ready") throw new Error("请先连接工作目录");
  if (pendingPromptSession) throw new Error("正在准备任务，请稍后再修改模型");
  const model = runtimeState.modelState.models.find((item) => item.id === modelId);
  if (!model) throw new Error("所选模型不在当前模型目录中");
  const params = { sessionId, modelId };
  if (reasoningEffort) params._meta = { reasoningEffort };
  if (sessionId) await client.request("session/set_model", params);
  runtimeState.modelState = {
    ...runtimeState.modelState,
    currentModelId: modelId,
    reasoningEffort: reasoningEffort || model.meta?.reasoningEffort || null,
  };
  persistPreferredModelId(modelId);
  send("agent:models", runtimeState.modelState);
  broadcastRuntime();
  return runtimeState.modelState;
}

async function setSessionMode(modeId) {
  if (!client || !runtimeState.workspace || runtimeState.status !== "ready") throw new Error("请先连接工作目录");
  if (pendingPromptSession) throw new Error("正在准备任务，请稍后再修改运行模式");
  if (!runtimeState.modeState.modes.some((mode) => mode.id === modeId)) throw new Error("所选运行模式不可用");
  if (sessionId) await client.request("session/set_mode", { sessionId, modeId });
  runtimeState.modeState = { ...runtimeState.modeState, currentModeId: modeId };
  send("agent:modes", runtimeState.modeState);
  broadcastRuntime();
  return runtimeState.modeState;
}

async function fetchBilling() {
  const acp = await ensureBackend();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return normalizeBilling(await acp.request("x.ai/billing", {}));
    } catch (error) {
      const failure = billingFailure(error);
      if (attempt === 0 && failure.retryable && acp === client && runtimeState.cliConnected) continue;
      throw Object.assign(new Error(failure.message), { code: failure.code, data: { detail: failure.details } });
    }
  }
}

async function listSessions(query = "", options = {}) {
  const acp = await ensureBackend();
  if (options.scope === "projects") {
    try {
      // Local overview includes every project and does not require opening its session.
      return normalizeSessionList(await acp.request("x.ai/session_summaries/workspace_list", {}));
    } catch (error) {
      if (error.code !== -32601 && !/method.*not.*found|unsupported/i.test(error.message || "")) throw error;
    }
  }
  const response = await acp.request("x.ai/session/list", {
    query: String(query || "").trim() || undefined,
    limit: options.scope === "projects" ? 500 : 100,
  });
  return normalizeSessionList(response);
}

async function loadSession(target) {
  if (sessionTransitionInFlight || runtimeState.busy || promptActive || promptQueue.list().length || reverseRequests.size) {
    throw new Error("请等待当前任务或确认操作结束后再切换会话");
  }
  const id = String(target?.id || "").trim();
  const cwd = String(target?.cwd || runtimeState.workspace || "");
  if (!id || !path.isAbsolute(cwd)) throw new Error("会话信息无效");
  sessionTransitionInFlight = true;
  const acp = await ensureBackend().catch((error) => { sessionTransitionInFlight = false; throw error; });
  sessionLedger.start(id);
  runtimeState.busy = true;
  send("agent:session-loading", { sessionId: id, cwd });
  controlServer?.broadcast("session-loading", { sessionId: id, cwd });
  broadcastRuntime();
  try {
    const loaded = await acp.request("session/load", {
      sessionId: id,
      cwd,
      mcpServers: [],
      _meta: buildSessionMetadata(runtimeState.permissionMode, null, backendConnection.sessionMeta),
    });
    if (client !== acp || !runtimeState.cliConnected) throw staleConnectionError(connectionGeneration.current);
    sessionId = id;
    runtimeState.workspace = cwd;
    runtimeState.modelState = normalizeModelState(loaded.models, loaded._meta?.modelState, runtimeState.modelState);
    runtimeState.modeState = normalizeModeState(loaded.modes, loaded._meta?.modeState, runtimeState.modeState);
    send("agent:models", runtimeState.modelState);
    send("agent:modes", runtimeState.modeState);
    setAgentStatus("ready");
    return connectionInfo();
  } finally {
    sessionTransitionInFlight = false;
    runtimeState.busy = false;
    send("agent:session-load-finished", { sessionId: id, cwd });
    broadcastRuntime();
  }
}

async function sessionExtension(method, params = {}) {
  const active = requireSession();
  return unwrapExtResult(await active.client.request(method, params));
}

function requiredText(value, label, maxLength = 2048) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label}不能为空`);
  if (text.length > maxLength) throw new Error(`${label}过长`);
  return text;
}

async function listMcpServers(cache = true) {
  const active = requireSession();
  return sessionExtension("x.ai/mcp/list", { sessionId: active.sessionId, cache: Boolean(cache) });
}

async function changeMcpServer(target) {
  const active = requireSession();
  return sessionExtension("x.ai/mcp/toggle", {
    session_id: active.sessionId,
    server_name: requiredText(target?.serverName, "MCP 服务名称", 240),
    enabled: Boolean(target?.enabled),
  });
}

async function changeMcpTool(target) {
  const active = requireSession();
  return sessionExtension("x.ai/mcp/toggle_tool", {
    session_id: active.sessionId,
    server_name: requiredText(target?.serverName, "MCP 服务名称", 240),
    tool_name: requiredText(target?.toolName, "工具名称", 240),
    enabled: Boolean(target?.enabled),
  });
}

async function saveMcpServer(settings) {
  const active = requireSession();
  const serverName = requiredText(settings?.serverName, "MCP 服务名称", 120);
  const params = { session_id: active.sessionId, server_name: serverName, enabled: true };
  if (settings?.type === "http") {
    const url = new URL(requiredText(settings.url, "MCP 地址", 2048));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("MCP 地址仅支持 HTTP 或 HTTPS");
    params.url = url.toString();
  } else {
    params.command = requiredText(settings?.command, "启动命令", 1024);
    params.args = Array.isArray(settings?.args)
      ? settings.args.map((item) => String(item)).filter(Boolean).slice(0, 100)
      : [];
  }
  return sessionExtension("x.ai/mcp/upsert", params);
}

async function deleteMcpServer(serverName) {
  const active = requireSession();
  return sessionExtension("x.ai/mcp/delete", {
    session_id: active.sessionId,
    server_name: requiredText(serverName, "MCP 服务名称", 240),
  });
}

async function triggerMcpAuth(serverName) {
  const active = requireSession();
  return sessionExtension("x.ai/mcp/auth_trigger", {
    session_id: active.sessionId,
    server_name: requiredText(serverName, "MCP 服务名称", 240),
  });
}

async function listSkills() {
  requireSession();
  return sessionExtension("x.ai/skills/config", { cwd: runtimeState.workspace });
}

async function changeSkill(action, payload = {}) {
  requireSession();
  const cwd = runtimeState.workspace;
  if (action === "toggle") {
    return sessionExtension("x.ai/skills/toggle", {
      cwd,
      name: requiredText(payload.name, "技能名称", 240),
      enabled: Boolean(payload.enabled),
    });
  }
  if (action === "add" || action === "remove") {
    return sessionExtension(`x.ai/skills/${action}`, {
      cwd,
      path: requiredText(payload.path, "技能路径", 2048),
    });
  }
  if (action === "reset") return sessionExtension("x.ai/skills/reset", { cwd });
  throw new Error("不支持的技能操作");
}

async function listPlugins() {
  const active = requireSession();
  return sessionExtension("x.ai/plugins/list", { sessionId: active.sessionId });
}

async function changePlugin(action, payload = {}) {
  const active = requireSession();
  const allowed = new Set(["reload", "add", "remove", "enable", "disable", "update", "uninstall"]);
  if (!allowed.has(action)) throw new Error("不支持的插件操作");
  const body = { type: action };
  if (action === "add" || action === "remove") body.path = requiredText(payload.path, "插件路径", 2048);
  if (["enable", "disable", "uninstall"].includes(action)) body.plugin_id = requiredText(payload.pluginId, "插件 ID", 512);
  if (action === "uninstall") body.confirmed = true;
  if (action === "update") body.plugin_id = payload.pluginId ? requiredText(payload.pluginId, "插件 ID", 512) : null;
  return sessionExtension("x.ai/plugins/action", { sessionId: active.sessionId, action: body });
}

async function listHooks() {
  const active = requireSession();
  return sessionExtension("x.ai/hooks/list", { sessionId: active.sessionId });
}

async function changeHook(action, payload = {}) {
  const active = requireSession();
  const allowed = new Set(["reload", "trust", "untrust", "add", "remove", "enable", "disable"]);
  if (!allowed.has(action)) throw new Error("不支持的 Hook 操作");
  const body = { type: action };
  if (action === "add" || action === "remove") body.path = requiredText(payload.path, "Hook 路径", 2048);
  if (action === "enable" || action === "disable") body.hook_name = requiredText(payload.hookName, "Hook 名称", 512);
  return sessionExtension("x.ai/hooks/action", { sessionId: active.sessionId, action: body });
}

async function listMarketplace() {
  const active = requireSession();
  return sessionExtension("x.ai/marketplace/list", { sessionId: active.sessionId });
}

async function changeMarketplace(action, payload = {}) {
  const active = requireSession();
  const allowed = new Set(["refresh", "install", "update", "uninstall", "add_source", "remove_source"]);
  if (!allowed.has(action)) throw new Error("不支持的插件市场操作");
  const body = { type: action };
  if (["install", "update", "uninstall"].includes(action)) {
    body.source_url_or_path = requiredText(payload.source, "市场来源", 2048);
    body.plugin_relative_path = requiredText(payload.pluginPath, "插件路径", 1024);
  } else if (action === "add_source") {
    body.url = requiredText(payload.url, "市场地址", 2048);
  } else if (action === "remove_source") {
    body.source_url_or_path = requiredText(payload.source, "市场来源", 2048);
  } else {
    body.source_url_or_path = payload.source ? requiredText(payload.source, "市场来源", 2048) : null;
  }
  return sessionExtension("x.ai/marketplace/action", { sessionId: active.sessionId, action: body });
}

async function listRunningWork() {
  const active = requireSession();
  const [tasks, subagents] = await Promise.all([
    sessionExtension("x.ai/task/list", { sessionId: active.sessionId }),
    sessionExtension("x.ai/subagent/list_running", { sessionId: active.sessionId }),
  ]);
  return { tasks: tasks?.tasks || [], subagents: subagents?.subagents || [] };
}

async function stopRunningWork(kind, id) {
  const active = requireSession();
  if (kind === "task") {
    return sessionExtension("x.ai/task/kill", {
      sessionId: active.sessionId,
      taskId: requiredText(id, "任务 ID", 512),
    });
  }
  if (kind === "subagent") {
    return sessionExtension("x.ai/subagent/cancel", { subagentId: requiredText(id, "子代理 ID", 512) });
  }
  throw new Error("不支持的运行项类型");
}

async function getAccountInfo() {
  const acp = await ensureBackend();
  return unwrapExtResult(await acp.request("x.ai/auth/info", {}));
}

async function setDataRetentionOptOut(enabled) {
  requireSession();
  return sessionExtension("x.ai/privacy/setCodingDataRetention", { codingDataRetentionOptOut: Boolean(enabled) });
}

async function getPromptHistory(currentOnly = false) {
  const active = requireSession();
  return sessionExtension("x.ai/prompt_history", {
    cwd: runtimeState.workspace,
    filter_session_id: currentOnly ? active.sessionId : null,
  });
}

async function shareCurrentSession() {
  const active = requireSession();
  return sessionExtension("x.ai/share_session", { session_id: active.sessionId });
}

async function logoutGrok() {
  requireSession();
  return sessionExtension("x.ai/auth/logout", { scope: null });
}

function projectRulesPath() {
  requireSession();
  return path.join(runtimeState.workspace, "AGENTS.md");
}

function readProjectRules() {
  const file = projectRulesPath();
  try {
    const stat = fs.statSync(file);
    if (stat.size > 1024 * 1024) throw new Error("AGENTS.md 超过 1 MB，无法在客户端内编辑");
    return { path: file, content: fs.readFileSync(file, "utf8"), exists: true };
  } catch (error) {
    if (error.code === "ENOENT") return { path: file, content: "", exists: false };
    throw error;
  }
}

function writeProjectRules(content) {
  const file = projectRulesPath();
  const value = String(content || "");
  if (Buffer.byteLength(value, "utf8") > 1024 * 1024) throw new Error("AGENTS.md 不能超过 1 MB");
  const temporary = `${file}.grok-desktop.tmp`;
  fs.writeFileSync(temporary, value, "utf8");
  fs.renameSync(temporary, file);
  return { path: file, content: value, exists: true };
}

async function currentSessionInfo() {
  const active = requireSession();
  return sessionExtension("x.ai/session/info", { sessionId: active.sessionId });
}

async function renameSession(target) {
  const id = String(target?.id || "").trim();
  const title = String(target?.title || "").trim();
  if (!id || !title) throw new Error("会话标题不能为空");
  return sessionExtension("x.ai/session/rename", {
    sessionId: id,
    title,
    cwd: target.cwd || runtimeState.workspace,
    kind: target.kind || "build",
  });
}

async function deleteSession(target) {
  const id = String(target?.id || "").trim();
  if (!id) throw new Error("会话 ID 无效");
  if (id === sessionId) throw new Error("不能删除当前正在使用的会话");
  return sessionExtension("x.ai/session/delete", {
    sessionId: id,
    cwd: target.cwd || runtimeState.workspace,
    kind: target.kind || "build",
  });
}

async function forkSession(target) {
  const id = String(target?.id || sessionId || "").trim();
  const cwd = String(target?.cwd || runtimeState.workspace || "");
  if (!id || !path.isAbsolute(cwd)) throw new Error("会话信息无效");
  return sessionExtension("x.ai/session/fork", {
    sourceSessionId: id,
    sourceCwd: cwd,
    newCwd: cwd,
    newModelId: target?.modelId || undefined,
    sessionKind: "fork",
  });
}

async function compactSession(userContext) {
  const active = requireSession();
  if (runtimeState.busy) throw new Error("请等待当前任务结束后再压缩上下文");
  runtimeState.busy = true;
  broadcastRuntime();
  try {
    return await sessionExtension("x.ai/compact_conversation", {
      sessionId: active.sessionId,
      userContext: String(userContext || "").trim() || null,
    });
  } finally {
    runtimeState.busy = false;
    broadcastRuntime();
  }
}

async function setPermissionMode(mode) {
  if (!client || !runtimeState.workspace || runtimeState.status !== "ready") throw new Error("请先连接工作目录");
  runtimeState.permissionMode = normalizePermissionMode(mode);
  if (runtimeState.permissionMode !== mode) throw new Error("权限模式无效");
  persistPermissionMode(mode);
  notifyPermissionMode();
  send("agent:permission-mode", { mode: runtimeState.permissionMode });
  broadcastRuntime();
  return { mode: runtimeState.permissionMode };
}

function preparePrompt(input) {
  const prompt = buildPromptContent(input);
  if (prompt.text.length > 100000) throw new Error("任务内容过长");
  if (!client || !runtimeState.workspace || runtimeState.status !== "ready") throw new Error("请先在电脑端连接工作目录");
  return prompt;
}

function announcePrompt(prompt, source) {
  const sharedMessage = { text: prompt.text, source, attachments: prompt.attachments };
  const ledgerEntry = send("control:user-message", sharedMessage);
  controlServer?.broadcast("user-message", ledgerEntry ? { entry: ledgerEntry, payload: sharedMessage } : sharedMessage);
}

function reportPromptError(error) {
  send("agent:turn-error", { message: error?.message || String(error) });
}

function stopFatalModelRetry(params) {
  const failure = fatalModelFailure(params);
  if (!failure || !client || !sessionId) return false;
  emitBackendDiagnostic(`Stopping fatal model retry: ${failure.details || failure.message}`);
  if (promptActive) cancelPrompt(false);
  else client.notify("session/cancel", { sessionId });
  reportPromptError(new Error(failure.message));
  return true;
}

async function executePrompt(prompt, source) {
  promptActive = true;
  runtimeState.busy = true;
  promptRecovery.begin(prompt, source);
  announcePrompt(prompt, source);
  const task = emitTaskStatus(taskLifecycle.start(source));
  try {
    const result = await client.request("session/prompt", {
      sessionId,
      prompt: prompt.blocks,
    });
    emitTaskStatus(taskLifecycle.complete(task.id));
    return result;
  } catch (error) {
    emitTaskStatus(taskLifecycle.fail(task.id));
    if (!taskLifecycle.isInterrupted(task.id)) throw error;
  } finally {
    promptRecovery.finish();
    promptActive = false;
    runtimeState.busy = false;
    broadcastRuntime();
    runNextQueuedPrompt();
  }
}

function runNextQueuedPrompt() {
  if (promptActive || runtimeState.busy) return;
  const next = promptQueue.takeNext();
  if (!next) return;
  broadcastRuntime();
  void executePrompt(next.prompt, next.source).catch(reportPromptError);
}

async function ensurePromptSession() {
  if (sessionId) return;
  if (!pendingPromptSession) {
    if (runtimeState.busy || sessionTransitionInFlight) throw new Error("当前正在更新设置，请稍后再试");
    const acp = client;
    const epoch = promptPreparationEpoch;
    runtimeState.busy = true;
    broadcastRuntime();
    const attempt = createBackendSession(acp, runtimeState.workspace).catch((error) => {
      if (client === acp && runtimeState.cliConnected && (/auth(?:entication)? required/i.test(error.message || "") || error.code === -32000)) {
        setAgentStatus("auth-required");
        error.code = "AUTH_REQUIRED";
      }
      throw error;
    }).then(() => {
      if (epoch !== promptPreparationEpoch) throw new Error("任务已取消，内容已保留");
    });
    pendingPromptSession = attempt;
    void attempt.finally(() => {
      if (pendingPromptSession !== attempt) return;
      pendingPromptSession = null;
      runtimeState.busy = false;
      broadcastRuntime();
    }).catch(() => {});
  }
  await pendingPromptSession;
}

async function acceptPrompt(input, source, options = {}) {
  const prompt = preparePrompt(input);
  await ensurePromptSession();
  if (promptActive) {
    const item = promptQueue.enqueue(prompt, source, { front: Boolean(options.interrupt) });
    broadcastRuntime();
    if (options.interrupt) cancelPrompt(false);
    return {
      accepted: true,
      queued: true,
      position: promptQueue.list().findIndex((queued) => queued.id === item.id) + 1,
      item,
    };
  }
  if (runtimeState.busy) throw new Error("当前正在切换会话或更新设置，请稍后再试");
  void executePrompt(prompt, source).catch(reportPromptError);
  return { accepted: true, queued: false, position: 0 };
}

function cancelPrompt(recover = false) {
  if (pendingPromptSession) promptPreparationEpoch += 1;
  emitTaskStatus(taskLifecycle.interrupt());
  if (client && sessionId) client.notify("session/cancel", { sessionId });
  for (const [id, method] of reverseRequests) {
    if (method !== "session/request_permission") continue;
    client?.respond(id, permissionResult(null));
    reverseRequests.delete(id);
    send("control:interaction-resolved", { id });
  }
  promptRecovery.cancel({ recover });
  broadcastRuntime();
  return promptRecovery.summary();
}

function updateQueuedPrompt(id, input) {
  const current = promptQueue.get(String(id || ""));
  const text = String(input?.text || "").trim();
  if (!text) throw new Error("待执行指令不能为空");
  const prompt = {
    ...current.prompt,
    text,
    blocks: [{ type: "text", text }, ...current.prompt.blocks.slice(1)],
  };
  const item = promptQueue.update(current.id, prompt);
  broadcastRuntime();
  return item;
}

function removeQueuedPrompt(id) {
  const item = promptQueue.remove(String(id || ""));
  broadcastRuntime();
  return item;
}

function moveQueuedPrompt(id, delta) {
  const item = promptQueue.move(String(id || ""), Number(delta));
  broadcastRuntime();
  return item;
}

function interruptQueuedPrompt(id) {
  const item = promptQueue.prioritize(String(id || ""));
  broadcastRuntime();
  if (promptActive) cancelPrompt(false);
  else runNextQueuedPrompt();
  return item;
}

function clearQueuedPrompts() {
  promptQueue.clear();
  broadcastRuntime();
  return {};
}

function replyPermission(id, optionId) {
  if (!client || reverseRequests.get(id) !== "session/request_permission") return false;
  client.respond(id, permissionResult(optionId));
  reverseRequests.delete(id);
  send("control:interaction-resolved", { id });
  return true;
}

function replyFolderTrust(id, trusted) {
  if (!client || reverseRequests.get(id) !== "x.ai/folder_trust/request") return false;
  client.respond(id, { outcome: trusted ? "trust" : "reject" });
  reverseRequests.delete(id);
  send("control:interaction-resolved", { id });
  return true;
}

function replyPlanApproval(id, outcome, feedback) {
  if (!client || reverseRequests.get(id) !== "x.ai/exit_plan_mode") return false;
  const pending = planApprovalsById.get(id);
  if (!pending) return false;
  client.respond(id, planApprovalResult(outcome, feedback));
  reverseRequests.delete(id);
  planApprovalsById.delete(id);
  planApprovalIdByToolCall.delete(pending.toolCallId);
  send("control:interaction-resolved", { id, toolCallId: pending.toolCallId });
  broadcastRuntime();
  return true;
}

async function handleControlAction(action, payload, socket) {
  switch (action) {
    case "session-sync-request": {
      const requestedSessionId = String(payload.sessionId || "");
      if (!sessionId || requestedSessionId !== sessionId) {
        const error = new Error("会话已切换，请重新同步");
        error.code = "STALE_SESSION";
        throw error;
      }
      const snapshot = sessionLedger.snapshot(sessionId);
      const chunks = sessionLedger.chunks(sessionId, 256 * 1024);
      if (!snapshot) return { sessionId, generation: null, chunkCount: 0 };
      controlServer?.send(socket, "session-sync-begin", {
        sessionId,
        generation: snapshot.generation,
        firstSequence: snapshot.firstSequence,
        lastSequence: snapshot.lastSequence,
        chunkCount: chunks.length,
      });
      for (let index = 0; index < chunks.length; index += 1) {
        controlServer?.send(socket, "session-sync-chunk", {
          sessionId,
          generation: snapshot.generation,
          index,
          entries: chunks[index].entries,
        });
      }
      controlServer?.send(socket, "session-sync-complete", {
        sessionId,
        generation: snapshot.generation,
        lastSequence: snapshot.lastSequence,
      });
      return { sessionId, generation: snapshot.generation, chunkCount: chunks.length };
    }
    case "prompt":
      return acceptPrompt(payload, "mobile", { interrupt: Boolean(payload.interrupt) });
    case "cancel":
      return cancelPrompt(true) || {};
    case "recover-prompt":
      return promptRecovery.consume() || {};
    case "prompt-queue-update":
      return updateQueuedPrompt(payload.id, payload);
    case "prompt-queue-remove":
      return removeQueuedPrompt(payload.id);
    case "prompt-queue-move":
      return moveQueuedPrompt(payload.id, payload.delta);
    case "prompt-queue-interrupt":
      return interruptQueuedPrompt(payload.id);
    case "prompt-queue-clear":
      return clearQueuedPrompts();
    case "new-session":
      if (!runtimeState.workspace) throw new Error("请先在电脑端选择工作目录");
      send("control:new-session", {});
      return startAgent(runtimeState.workspace, "mobile new session", { newSession: true });
    case "set-model":
      return setSessionModel(payload.modelId, payload.reasoningEffort || null);
    case "set-mode":
      return setSessionMode(payload.modeId);
    case "billing":
      return fetchBilling();
    case "list-sessions":
      return listSessions(payload.query || "");
    case "load-session":
      return loadSession({ id: payload.id, cwd: payload.cwd || runtimeState.workspace });
    case "list-running-work":
      return listRunningWork();
    case "stop-running-work":
      return stopRunningWork(payload.kind, payload.id);
    case "permission-reply":
      if (!replyPermission(payload.id, payload.optionId || null)) throw new Error("权限请求已失效");
      return {};
    case "folder-trust-reply":
      if (!replyFolderTrust(payload.id, Boolean(payload.trusted))) throw new Error("信任请求已失效");
      return {};
    case "plan-approval-reply":
      if (!replyPlanApproval(payload.id, payload.outcome, payload.feedback)) throw new Error("计划审批已失效");
      return {};
    case "ping":
      return { now: Date.now() };
    default:
      throw new Error(`不支持的手机操作: ${action}`);
  }
}

async function withQrCode(info) {
  if (!info?.pairUrl) return info;
  const endpoints = await Promise.all((info.endpoints || []).map(async (endpoint) => ({
    ...endpoint,
    qrDataUrl: endpoint.pairUrl ? await QRCode.toDataURL(endpoint.pairUrl, {
      width: 260,
      margin: 1,
      color: { dark: "#202422", light: "#00000000" },
    }) : "",
  })));
  return {
    ...info,
    endpoints,
    qrDataUrl: endpoints[0]?.qrDataUrl || "",
  };
}

async function emitControlInfo() {
  if (!controlServer) {
    send("control:info", { running: false, connectedClients: 0 });
    return;
  }
  send("control:info", await withQrCode(controlServer.info()));
  broadcastRuntime();
}

async function startControlServer() {
  if (!controlServer) {
    controlServer = new ControlServer({
      mobileRoot: path.join(__dirname, "mobile"),
      vendorRoot: path.join(app.getAppPath(), "node_modules"),
      sharedAssets: {
        wallpaper: path.join(__dirname, "renderer", "assets", "wallpaper.png"),
      },
      getSnapshot: runtimeSnapshot,
      onAction: handleControlAction,
    });
    for (const event of ["started", "stopped", "pairing-rotated", "pairing-consumed", "clients-changed"]) {
      controlServer.on(event, () => void emitControlInfo());
    }
  }
  const info = await controlServer.start(2420);
  return withQrCode(info);
}

async function stopControlServer() {
  await controlServer?.stop();
  return { running: false, connectedClients: 0 };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 840,
    minHeight: 620,
    backgroundColor: "#cfd7d5",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  mainWindow.once("ready-to-show", async () => {
    mainWindow.show();
    const screenshotPath = process.env.GROK_DESKTOP_SCREENSHOT;
    if (screenshotPath) {
      const image = await mainWindow.webContents.capturePage();
      fs.writeFileSync(screenshotPath, image.toPNG());
      app.quit();
    }
  });
  mainWindow.on("close", (event) => {
    if (!quitting && !process.env.GROK_DESKTOP_SCREENSHOT) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), "build", "icon.png"));
  tray = new Tray(icon.resize({ width: 20, height: 20 }));
  tray.setToolTip("Grok Build");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "打开 Grok Build", click: showMainWindow },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]));
  tray.on("double-click", showMainWindow);
}

async function officialCliStatus() {
  const saved = getOfficialCliStore().get()?.executablePath;
  const executablePath = saved || discoverOfficialCli(() => findOfficialCliOnPath());
  if (!executablePath) return { available: false, source: null, error: "未检测到官方 Grok Build" };
  try {
    const validated = await validateOfficialCli(executablePath);
    return {
      available: true,
      source: saved ? "selected" : "path",
      executablePath: validated.executablePath,
      version: validated.version,
    };
  } catch (error) {
    return { available: false, source: saved ? "selected" : "path", error: error.message };
  }
}

ipcMain.handle("workspace:choose", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择工作目录",
    properties: ["openDirectory", "createDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("official-cli:get", async () => ({ ok: true, data: await officialCliStatus() }));

ipcMain.handle("official-cli:choose", async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "选择官方 Grok Build CLI",
      properties: ["openFile"],
      filters: [{ name: "Grok Build", extensions: ["exe"] }],
    });
    if (result.canceled) return { ok: true, data: null };
    const validated = await validateOfficialCli(result.filePaths[0]);
    if (backendCommand && backendCommand !== validated.executablePath && client) {
      if (runtimeState.busy || sessionTransitionInFlight || promptActive || reverseRequests.size) throw new Error("请等待当前任务结束后再更换 CLI");
      await stopAgent(false, { reason: "change official CLI" });
    }
    getOfficialCliStore().save(validated);
    return { ok: true, data: { available: true, source: "selected", ...validated } };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("official-cli:test", async () => {
  try {
    const status = await officialCliStatus();
    if (!status.available) throw new Error(status.error);
    return { ok: true, data: status };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("official-cli:update-check", async () => {
  try {
    const command = await resolveBackend();
    const result = await runOfficialCli(command, ["update", "--check", "--json"]);
    const data = parseUpdateStatus(result.stdout);
    if (data.error) emitBackendDiagnostic(`Official CLI update check: ${data.error}`);
    return { ok: true, data };
  } catch (error) {
    emitBackendDiagnostic(`Official CLI update check failed: ${error.message}`);
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("official-cli:update-install", async (_event, confirmed) => {
  try {
    if (confirmed !== true) throw new Error("请先确认更新官方 Grok Build");
    const command = await resolveBackend();
    await stopAgent(false, { reason: "update official Grok Build" });
    runtimeState.workspace = null;
    setAgentStatus("idle");
    const result = await runOfficialCli(command, ["update"]);
    if (result.stderr) emitBackendDiagnostic(`Official CLI update: ${String(result.stderr).trim()}`);
    const validated = await validateOfficialCli(command);
    return { ok: true, data: { version: validated.version } };
  } catch (error) {
    emitBackendDiagnostic(`Official CLI update failed: ${error.message}`);
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("agent:start", async (_event, cwd, options = {}) => {
  try {
    return { ok: true, data: await startAgent(cwd || null, "desktop connect", { newSession: options?.newSession === true }) };
  } catch (error) {
    if (error.connectionStale) return { ok: false, stale: true, error: serializeError(error) };
    if (!runtimeState.cliConnected) setAgentStatus("error");
    return { ok: false, data: connectionInfo(), error: serializeError(error) };
  }
});

ipcMain.handle("agent:close-workspace", () => {
  try {
    return { ok: true, data: closeWorkspace() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("agent:stop", async () => {
  try {
    await stopAgent(false);
    runtimeState.workspace = null;
    setAgentStatus("idle");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("agent:prompt", async (_event, payload) => {
  try {
    return { ok: true, data: await acceptPrompt(payload, "desktop", { interrupt: Boolean(payload?.interrupt) }) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("prompt-queue:update", async (_event, id, payload) => {
  try {
    return { ok: true, data: updateQueuedPrompt(id, payload) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("prompt-queue:remove", async (_event, id) => {
  try {
    return { ok: true, data: removeQueuedPrompt(id) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("prompt-queue:move", async (_event, id, delta) => {
  try {
    return { ok: true, data: moveQueuedPrompt(id, delta) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("prompt-queue:interrupt", async (_event, id) => {
  try {
    return { ok: true, data: interruptQueuedPrompt(id) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("prompt-queue:clear", async () => {
  try {
    return { ok: true, data: clearQueuedPrompts() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("agent:cancel", async () => {
  try {
    return { ok: true, data: cancelPrompt(true) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("prompt-recovery:consume", () => ({ ok: true, data: promptRecovery.consume() }));

ipcMain.handle("agent:authenticate", async (_event, methodId) => {
  try {
    if (!client) throw new Error("Grok 后端未连接");
    const auth = await client.request("authenticate", { methodId });
    setAgentStatus(runtimeState.workspace ? "ready" : "cli-ready");
    return { ok: true, data: { ...connectionInfo(), auth } };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("appearance:set-theme", (_event, theme) => {
  if (theme !== "light" && theme !== "dark") return { ok: false };
  nativeTheme.themeSource = theme;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBackgroundColor(theme === "dark" ? "#191a1c" : "#fafafa");
  return { ok: true };
});

ipcMain.handle("agent:capabilities", () => ({
  ok: true,
  data: connectionInfo(),
}));
ipcMain.handle("agent:set-model", async (_event, modelId, reasoningEffort) => {
  try {
    return { ok: true, data: await setSessionModel(modelId, reasoningEffort) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:set-mode", async (_event, modeId) => {
  try {
    return { ok: true, data: await setSessionMode(modeId) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:billing", async () => {
  try {
    return { ok: true, data: await fetchBilling() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:list-sessions", async (_event, query, options) => {
  try {
    return { ok: true, data: await listSessions(query, { scope: options?.scope === "projects" ? "projects" : "all" }) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:load-session", async (_event, target) => {
  try {
    return { ok: true, data: await loadSession(target) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:session-info", async () => {
  try {
    return { ok: true, data: await currentSessionInfo() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:rename-session", async (_event, target) => {
  try {
    return { ok: true, data: await renameSession(target) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:delete-session", async (_event, target) => {
  try {
    return { ok: true, data: await deleteSession(target) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:fork-session", async (_event, target) => {
  try {
    return { ok: true, data: await forkSession(target) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:compact-session", async (_event, context) => {
  try {
    return { ok: true, data: await compactSession(context) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:rewind-points", async () => {
  try {
    const active = requireSession();
    return { ok: true, data: await sessionExtension("x.ai/rewind/points", { sessionId: active.sessionId }) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:rewind", async (_event, targetPromptIndex, mode) => {
  try {
    const active = requireSession();
    return { ok: true, data: await sessionExtension("x.ai/rewind/execute", {
      sessionId: active.sessionId,
      targetPromptIndex: Number(targetPromptIndex),
      mode: ["all", "conversation_only", "files_only"].includes(mode) ? mode : "all",
      force: false,
    }) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:flush-memory", async () => {
  try {
    const active = requireSession();
    return { ok: true, data: await sessionExtension("x.ai/memory/flush", { session_id: active.sessionId }) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:set-permission-mode", async (_event, mode) => {
  try {
    return { ok: true, data: await setPermissionMode(mode) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:list-mcp", async (_event, cache) => {
  try {
    return { ok: true, data: await listMcpServers(cache) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:toggle-mcp", async (_event, target) => {
  try {
    return { ok: true, data: await changeMcpServer(target) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:toggle-mcp-tool", async (_event, target) => {
  try {
    return { ok: true, data: await changeMcpTool(target) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:save-mcp", async (_event, settings) => {
  try {
    return { ok: true, data: await saveMcpServer(settings) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:delete-mcp", async (_event, serverName) => {
  try {
    return { ok: true, data: await deleteMcpServer(serverName) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:auth-mcp", async (_event, serverName) => {
  try {
    return { ok: true, data: await triggerMcpAuth(serverName) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:list-skills", async () => {
  try {
    return { ok: true, data: await listSkills() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:change-skill", async (_event, action, payload) => {
  try {
    return { ok: true, data: await changeSkill(action, payload) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:list-plugins", async () => {
  try {
    return { ok: true, data: await listPlugins() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:change-plugin", async (_event, action, payload) => {
  try {
    return { ok: true, data: await changePlugin(action, payload) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:list-hooks", async () => {
  try {
    return { ok: true, data: await listHooks() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:change-hook", async (_event, action, payload) => {
  try {
    return { ok: true, data: await changeHook(action, payload) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:list-marketplace", async () => {
  try {
    return { ok: true, data: await listMarketplace() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:change-marketplace", async (_event, action, payload) => {
  try {
    return { ok: true, data: await changeMarketplace(action, payload) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:list-running-work", async () => {
  try {
    return { ok: true, data: await listRunningWork() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:stop-running-work", async (_event, kind, id) => {
  try {
    return { ok: true, data: await stopRunningWork(kind, id) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:account-info", async () => {
  try {
    return { ok: true, data: await getAccountInfo() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:set-data-retention", async (_event, enabled) => {
  try {
    return { ok: true, data: await setDataRetentionOptOut(enabled) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:prompt-history", async (_event, currentOnly) => {
  try {
    return { ok: true, data: await getPromptHistory(currentOnly) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:share-session", async () => {
  try {
    return { ok: true, data: await shareCurrentSession() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:logout", async () => {
  try {
    return { ok: true, data: await logoutGrok() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:project-rules", () => {
  try {
    return { ok: true, data: readProjectRules() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("agent:save-project-rules", (_event, content) => {
  try {
    return { ok: true, data: writeProjectRules(content) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("models:list-providers", () => ({ ok: true, data: getCustomModelStore().listProviders() }));
ipcMain.handle("models:save-provider", async (_event, settings) => {
  try {
    const providers = getCustomModelStore().saveProvider(settings);
    return { ok: true, data: { providers } };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("models:remove-provider", async (_event, id) => {
  try {
    const providers = getCustomModelStore().removeProvider(String(id || ""));
    return { ok: true, data: { providers } };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("models:save-model", async (_event, providerId, settings) => {
  try {
    const providers = getCustomModelStore().saveModel(String(providerId || ""), settings);
    return { ok: true, data: { providers } };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("models:remove-model", async (_event, providerId, modelId) => {
  try {
    const providers = getCustomModelStore().removeModel(String(providerId || ""), String(modelId || ""));
    return { ok: true, data: { providers } };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("models:resolve-conflict", async (_event, modelId, action) => {
  try {
    const providers = getCustomModelStore().resolveConflict(String(modelId || ""), String(action || ""));
    return { ok: true, data: { providers } };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("models:apply", async () => {
  try {
    const providers = getCustomModelStore().listProviders();
    const reloaded = await startAgent(runtimeState.workspace, "apply model configuration", { forceRestart: true });
    return { ok: true, data: { providers, reloaded } };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("models:check", async (_event, providerId, modelId, mode) => {
  try {
    const model = getCustomModelStore().resolveModel(String(providerId || ""), String(modelId || ""));
    return { ok: true, data: await runModelProbe(model, mode === "real" ? "real" : "quick") };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("agent:permission-reply", async (_event, id, optionId) => replyPermission(id, optionId));
ipcMain.handle("agent:folder-trust-reply", async (_event, id, trusted) => replyFolderTrust(id, trusted));
ipcMain.handle("agent:plan-approval-reply", async (_event, id, outcome, feedback) => replyPlanApproval(id, outcome, feedback));

ipcMain.handle("control:start", async () => {
  try {
    return { ok: true, data: await startControlServer() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("control:stop", async () => {
  try {
    return { ok: true, data: await stopControlServer() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("control:rotate-pairing", async () => {
  try {
    if (!controlServer?.info().running) throw new Error("手机控制服务未启动");
    return { ok: true, data: await withQrCode(controlServer.rotatePairing()) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("control:status", async () => ({
  ok: true,
  data: controlServer ? await withQrCode(controlServer.info()) : { running: false, connectedClients: 0 },
}));

ipcMain.handle("background:get", () => ({ ok: true, data: getBackgroundSettings() }));
ipcMain.handle("background:choose", async () => {
  try {
    const settings = await chooseBackgroundImage();
    return { ok: true, data: settings };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("background:update", (_event, updates) => {
  const current = readBackgroundConfig();
  const next = {
    position: BACKGROUND_POSITIONS.has(updates?.position) ? updates.position : current.position,
    fit: updates?.fit === "contain" ? "contain" : updates?.fit === "cover" ? "cover" : current.fit,
  };
  writeBackgroundConfig(next);
  return { ok: true, data: getBackgroundSettings() };
});
ipcMain.handle("background:reset", () => {
  const paths = backgroundPaths();
  if (fs.existsSync(paths.image)) fs.unlinkSync(paths.image);
  if (fs.existsSync(paths.settings)) fs.unlinkSync(paths.settings);
  return { ok: true, data: getBackgroundSettings() };
});

ipcMain.handle("avatars:get", () => ({ ok: true, data: getAvatarStore().getAll() }));
ipcMain.handle("avatars:choose", async (_event, role) => {
  try {
    return { ok: true, data: await chooseAvatar(String(role || "")) };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});
ipcMain.handle("avatars:reset", (_event, role) => {
  try {
    const avatars = getAvatarStore().reset(String(role || ""));
    broadcastRuntime();
    return { ok: true, data: avatars };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
});

ipcMain.handle("app:copy", (_event, text) => {
  clipboard.writeText(String(text || ""));
  return true;
});
ipcMain.handle("app:open-external", async (_event, url) => {
  if (typeof url !== "string" || !/^https:\/\//i.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

app.whenReady().then(() => {
  runtimeState.permissionMode = loadPermissionMode();
  createWindow();
  createTray();
  void ensureBackend("app startup").catch((error) => {
    if (!error.connectionStale) setAgentStatus("error", error.message);
  });
});
app.on("before-quit", () => {
  quitting = true;
  void stopAgent(false);
  void stopControlServer();
});
app.on("window-all-closed", () => {});
app.on("activate", () => {
  showMainWindow();
});
