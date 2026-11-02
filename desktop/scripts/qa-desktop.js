const path = require("node:path");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { app, BrowserWindow, ipcMain } = require("electron");
const QRCode = require("qrcode");

if (process.env.GROK_DESKTOP_QA_PROFILE) {
  const qaProfile = path.resolve(process.env.GROK_DESKTOP_QA_PROFILE);
  fs.mkdirSync(qaProfile, { recursive: true });
  app.setPath("userData", qaProfile);
}

app.disableHardwareAcceleration();

const desktopRoot = path.resolve(__dirname, "..");
const outputRoot = process.argv[2] ? path.resolve(process.argv[2]) : desktopRoot;
const avatarDataUrl = () => `data:image/png;base64,${fs.readFileSync(path.join(desktopRoot, "build", "icon.png")).toString("base64")}`;

function assertCapture(image, name) {
  assert.equal(image.isEmpty(), false, `${name} capture must not be empty`);
  const bitmap = image.toBitmap();
  assert.ok(bitmap.length > 4_000, `${name} capture must contain pixels`);
  let varied = false;
  for (let index = 4; index < bitmap.length; index += Math.max(4, Math.floor(bitmap.length / 500 / 4) * 4)) {
    if (bitmap[index] !== bitmap[0] || bitmap[index + 1] !== bitmap[1] || bitmap[index + 2] !== bitmap[2]) {
      varied = true;
      break;
    }
  }
  assert.ok(varied, `${name} capture must not be a flat color`);
}

async function saveCapture(win, name) {
  const image = await win.webContents.capturePage();
  assertCapture(image, name);
  fs.writeFileSync(path.join(outputRoot, name), image.toPNG());
}

async function verifyMessageAlignment(win) {
  const layout = await win.webContents.executeJavaScript(`(() => {
    const bounds = (element) => element.getBoundingClientRect();
    return [...document.querySelectorAll('.message.user, .message.assistant')].map((message) => {
      const avatar = bounds(message.querySelector('.message-avatar'));
      const body = bounds(message.querySelector('.message-body, .message-main'));
      const row = bounds(message);
      const user = message.classList.contains('user');
      if (user && message.querySelector('.message-role')) throw new Error('User messages must not repeat the avatar label');
      if (user && !message.querySelector('.message-edit')) throw new Error('User message editing must remain available');
      return { user, aligned: user ? avatar.left >= body.right - 1 : avatar.right <= body.left + 1,
        inside: body.left >= row.left - 1 && body.right <= row.right + 1 && avatar.right <= row.right + 1,
        readable: getComputedStyle(message.querySelector('.message-content')).textAlign !== 'right' };
    });
  })()`);
  assert.ok(layout.some((item) => item.user) && layout.some((item) => !item.user), 'both message roles must be present');
  assert.ok(layout.every((item) => item.aligned && item.inside && item.readable), `Incorrect message alignment: ${JSON.stringify(layout)}`);
}

async function captureMessageAlignment(win, name) {
  await new Promise((resolve) => setTimeout(resolve, 180));
  await win.webContents.executeJavaScript(`(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    state.autoFollow = false;
    elements.conversation.scrollTop = 0;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const avatar = document.querySelector('.message.user .message-avatar').getBoundingClientRect();
    const viewport = elements.conversation.getBoundingClientRect();
    if (avatar.top < viewport.top || avatar.bottom > viewport.bottom) throw new Error('User avatar must be visible in the preview');
  })()`);
  await saveCapture(win, name);
}

async function verifyBackgroundErrorUi(win, mobile = false) {
  const params = { update: { sessionUpdate: "task_completed", task_snapshot: {
    task_id: "qa-chrome-updater", exit_code: 1, display_command: "chrome --headless=new",
    output: '\x1b[31;1mDevTools listening on ws://127.0.0.1:9333/devtools/browser/qa\x1b[0m\nERROR:chrome\\updater\\ipc\\update_service_dialer_win.cc:77 拒绝访问 (0x5)',
  } } };
  await win.webContents.executeJavaScript(`(() => {
    globalThis.qaBeforeCommandError = { progress: ensureAssistant().progress.dataset.state, lastTurnError: state.lastTurnError };
    setTurnProgress(ensureAssistant(), "tools");
    state.lastTurnError = "";
    ${mobile ? "handleAgentUpdate" : "handleUpdate"}(${JSON.stringify(params)});
  })()`);
  const message = require("../src/ux-policy").describeBackgroundTask(params.update.task_snapshot).message;
  const event = { message, source: "background-task" };
  const status = { id: "background-qa-chrome-updater", state: "failed", source: "background" };
  if (mobile) {
    await win.webContents.executeJavaScript(`handleMessage({ type: "turn-error", data: ${JSON.stringify(event)} }); handleMessage({ type: "task-status", data: ${JSON.stringify(status)} });`);
  } else {
    win.webContents.send("agent:turn-error", event);
    win.webContents.send("agent:task-status", status);
  }
  await win.webContents.executeJavaScript(`new Promise((resolve) => setTimeout(resolve, 100))`);
  await win.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('.error-card.command')].filter((card) => card.dataset.errorDetails.includes('qa-chrome') || card.dataset.errorDetails.includes('chrome --headless=new'));
    if (cards.length !== 1) throw new Error('Background command errors must deduplicate across event routes');
    if (cards[0].querySelector('strong').textContent !== '后台命令执行失败') throw new Error('Incorrect command error classification');
    if (!cards[0].querySelector('p').textContent.includes('Chrome 已启动调试服务')) throw new Error('Missing Chrome startup context');
    if (cards[0].textContent.includes(String.fromCharCode(27))) throw new Error('ANSI escapes leaked into the UI');
    if (state.assistant.progress.dataset.state === 'failed') throw new Error('A background failure must not fail the active turn');
    if (state.lastTurnError) throw new Error('A background failure must not replace the model failure');
    cards[0].remove();
    setTurnProgress(state.assistant, qaBeforeCommandError.progress);
    state.lastTurnError = qaBeforeCommandError.lastTurnError;
    delete globalThis.qaBeforeCommandError;
  })()`);
}

async function captureEffortFlow(win) {
  const output = path.join(desktopRoot, 'dist', 'qa-effort-flow-frames');
  fs.mkdirSync(output, { recursive: true });
  const bounds = await win.webContents.executeJavaScript(`(() => {
    const rect = elements.modelSettingsPopover.getBoundingClientRect();
    return { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  })()`);
  for (const level of ['low', 'medium', 'high', 'xhigh']) {
    await win.webContents.executeJavaScript(`(async () => {
      renderModelState({ reasoningEffort: ${JSON.stringify(level)} });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    fs.writeFileSync(path.join(output, `level-${level}.png`), (await win.webContents.capturePage(bounds)).toPNG());
  }
  await win.webContents.executeJavaScript(`(() => {
    globalThis.qaEffortFlowAnimation = document.querySelector('.effort-slider-fill').getAnimations({ subtree: true }).find((animation) => animation.animationName === 'effort-sheen-travel');
    if (!qaEffortFlowAnimation) throw new Error('Highest effort must have a moving sheen animation');
    qaEffortFlowAnimation.pause();
  })()`);
  const frames = new Set();
  for (let index = 0; index < 24; index += 1) {
    await win.webContents.executeJavaScript(`(async () => {
      qaEffortFlowAnimation.currentTime = ${index * 100};
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    const frame = (await win.webContents.capturePage(bounds)).toPNG();
    frames.add(frame.toString('base64'));
    fs.writeFileSync(path.join(output, `frame-${String(index).padStart(2, '0')}.png`), frame);
  }
  assert.ok(frames.size > 8, 'the sheen must visibly travel across the bar, not just change a glow or opacity');
  await win.webContents.executeJavaScript(`qaEffortFlowAnimation.play(); delete globalThis.qaEffortFlowAnimation;`);
}

async function resizeContent(win, width, height) {
  win.setContentSize(width, height);
  await new Promise((resolve) => setTimeout(resolve, 220));
}

async function mobileGeometry(win) {
  return win.webContents.executeJavaScript(`(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector).getBoundingClientRect();
      return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, width: value.width, height: value.height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      mode: document.querySelector("#app-view").dataset.layout,
      chat: rect(".chat-column"),
      conversation: rect("#conversation"),
      composer: rect(".composer-wrap"),
      composerForm: rect("#composer"),
      composerRow: rect(".composer-row"),
      recover: rect("#mobile-recover-prompt"),
      navigation: rect("#navigation-panel"),
      controls: rect("#controls-panel"),
      leftOpen: document.querySelector("#app-view").classList.contains("left-open"),
      rightOpen: document.querySelector("#app-view").classList.contains("right-open"),
    };
  })()`);
}

function assertMobileGeometry(metrics, { landscape = false, navigationMin = 0, controlsMin = 0 } = {}) {
  assert.ok(metrics.chat.left >= 0 && metrics.chat.right <= metrics.viewport.width + 1, "chat must stay inside viewport");
  assert.ok(metrics.conversation.bottom <= metrics.composer.top + 1, "conversation must not overlap composer");
  assert.ok(metrics.composer.bottom <= metrics.viewport.height + 1, "composer must stay inside viewport");
  assert.ok(metrics.composerForm.left >= 0 && metrics.composerForm.right <= metrics.viewport.width + 1, `composer form must stay inside viewport: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.composerRow.left >= 0 && metrics.composerRow.right <= metrics.viewport.width + 1, `composer controls must stay inside viewport: ${JSON.stringify(metrics)}`);
  if (metrics.recover.height) assert.ok(metrics.recover.left >= 0 && metrics.recover.right <= metrics.viewport.width + 1, `recovery strip must stay inside viewport: ${JSON.stringify(metrics)}`);
  if (landscape) assert.ok(metrics.chat.width >= 480, "landscape chat must remain at least 480px wide");
  if (metrics.leftOpen) assert.ok(metrics.navigation.left >= 0 && metrics.navigation.right <= metrics.viewport.width + 1, "open navigation must stay inside viewport");
  if (metrics.rightOpen) assert.ok(metrics.controls.left >= 0 && metrics.controls.right <= metrics.viewport.width + 1, "open controls must stay inside viewport");
  if (navigationMin) assert.ok(metrics.navigation.width >= navigationMin, `navigation must be at least ${navigationMin}px wide: ${JSON.stringify(metrics)}`);
  if (controlsMin) assert.ok(metrics.controls.width >= controlsMin, `controls must be at least ${controlsMin}px wide: ${JSON.stringify(metrics)}`);
}

function createMobileQaDocument(html) {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || "";
  return body.replace(/<script\b[^>]*\bsrc=[^>]*>\s*<\/script>/gi, "");
}

ipcMain.handle("control:status", () => ({ ok: true, data: { running: false, connectedClients: 0 } }));
ipcMain.handle("appearance:set-theme", () => ({ ok: true }));
ipcMain.handle("official-cli:get", () => ({ ok: true, data: {
  available: true,
  source: "selected",
  executablePath: "C:\\Users\\qa\\AppData\\Local\\Grok Build\\grok.exe",
  version: "0.2.101",
} }));
ipcMain.handle("official-cli:choose", () => ({ ok: true, data: {
  available: true,
  source: "selected",
  executablePath: "C:\\Users\\qa\\AppData\\Local\\Grok Build\\grok.exe",
  version: "0.2.101",
} }));
ipcMain.handle("official-cli:test", () => ({ ok: true, data: {
  available: true,
  source: "selected",
  executablePath: "C:\\Users\\qa\\AppData\\Local\\Grok Build\\grok.exe",
  version: "0.2.101",
} }));
ipcMain.handle("official-cli:update-check", () => ({ ok: true, data: {
  currentVersion: "0.2.101", latestVersion: "0.2.102", updateAvailable: true, channel: "stable", installer: "official", error: null,
} }));
ipcMain.handle("official-cli:update-install", () => ({ ok: true, data: { version: "0.2.102" } }));
ipcMain.handle("agent:account-info", () => ({ ok: true, data: { email: "qa@example.com", team: null, codingDataRetention: true } }));
ipcMain.handle("agent:prompt-history", () => ({ ok: true, data: [] }));
const qaHistoryScopes = [];
ipcMain.handle("agent:list-sessions", (_event, _query, options) => {
  qaHistoryScopes.push(options?.scope || 'all');
  return { ok: true, data: { sessions: [
  { id: "qa-session", title: "优化 Grok Build 客户端排版", cwd: "C:\\work\\grok-build-main", modelId: "openai-gpt-4o", updatedAt: Date.now() },
  { id: "qa-session-2", title: "排查计划审批流程", cwd: "C:\\work\\grok-build-main", modelId: "grok-build", updatedAt: Date.now() - 60_000 },
  { id: "qa-other-project", title: "另一个项目的历史对话", cwd: "D:\\projects\\frontend-dashboard", modelId: "grok-build", updatedAt: Date.now() - 120_000 },
] } };
});
let qaBillingFailure = false;
ipcMain.handle("agent:billing", () => qaBillingFailure
  ? { ok: false, error: { code: 'BILLING_NETWORK_ERROR', message: '暂时无法连接 Grok 额度服务，请检查网络后重试。', data: { detail: 'error sending request for url (https://cli-chat-proxy.grok.com/v1/billing?format=credits)' } } }
  : { ok: true, data: { available: true, usagePercent: 36, subscriptionTier: 'SuperGrok', periodType: 'USAGE_PERIOD_TYPE_WEEKLY', periodEnd: '2026-11-01T00:00:00Z' } });
ipcMain.handle("agent:project-rules", () => ({ ok: true, data: { path: "C:\\work\\grok-build-main\\AGENTS.md", content: "" } }));
ipcMain.handle("background:get", () => ({ ok: true, data: { custom: false, position: "center center", fit: "cover" } }));
ipcMain.handle("avatars:get", () => ({ ok: true, data: { user: avatarDataUrl(), assistant: avatarDataUrl() } }));
ipcMain.handle("prompt-recovery:consume", () => ({ ok: true, data: { text: "继续修改刚才的内容", attachments: [] } }));
ipcMain.handle("agent:capabilities", () => ({ ok: true, data: { modelState: { models: [] }, modeState: { modes: [] } } }));
ipcMain.handle("agent:load-session", (_event, target) => ({ ok: true, data: {
  sessionId: target.id, workspace: target.cwd, connected: true, cliConnected: true, status: 'ready',
} }));
const qaAgentStarts = [];
ipcMain.handle("agent:close-workspace", () => ({ ok: true, data: { cliConnected: true, connected: false, status: "cli-ready", workspace: null, sessionId: null } }));
ipcMain.handle("agent:start", (_event, cwd, options) => {
  qaAgentStarts.push({ cwd, options });
  return { ok: true, data: {
  cliConnected: true,
  connected: Boolean(cwd),
  status: cwd ? "ready" : "cli-ready",
  sessionId: null,
  backend: "C:\\Users\\qa\\AppData\\Local\\Grok Build\\grok.exe",
  workspace: cwd,
  requiresAuth: false,
  modelState: { currentModelId: "openai-gpt-4o", models: [
    { id: "openai-gpt-4o", name: "GPT-4o" },
    { id: "grok-build", name: "grok-build" },
  ] },
  modeState: { modes: [] },
  permissionMode: "ask",
} };
});
let qaPromptFailure = false;
let qaModelFailure = false;
const qaModelRequests = [];
const qaEffortModel = { id: 'grok-build', name: 'Grok 4.7', meta: { reasoningEfforts: [
  { id: 'deep', value: 'xhigh', label: '极高' }, { id: 'high', label: '高' }, { id: 'medium', label: '中', default: true }, { id: 'low', label: '低' }, { id: 'minimal', label: '极低' },
] } };
ipcMain.handle('agent:set-model', (_event, modelId, reasoningEffort) => {
  qaModelRequests.push({ modelId, reasoningEffort });
  return qaModelFailure ? { ok: false, error: { message: 'QA: model setting failed' } }
    : { ok: true, data: { currentModelId: modelId, reasoningEffort, models: [qaEffortModel] } };
});
const qaPrompts = [];
ipcMain.handle("agent:prompt", (event, payload) => {
  qaPrompts.push(payload);
  if (qaPromptFailure) return { ok: false, error: { message: "QA: session preparation failed" } };
  event.sender.send("control:runtime", {
    connected: true, cliConnected: true, busy: false, status: "ready",
    workspace: qaAgentStarts.at(-1).cwd, sessionId: "qa-session",
  });
  event.sender.send("control:user-message", { text: payload.text, attachments: payload.attachments, source: "desktop" });
  return { ok: true, data: { accepted: true, queued: false } };
});
ipcMain.handle("models:list-providers", () => ({
  ok: true,
  data: [{
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiBackend: "responses",
    hasApiKey: true,
    models: [
      { id: "openai-gpt-4o", name: "GPT-4o", model: "gpt-4o", apiBackend: null },
      { id: "openai-gpt-4o-mini", name: "GPT-4o mini", model: "gpt-4o-mini", apiBackend: "chat_completions" },
    ],
  }],
}));
ipcMain.handle("models:apply", () => ({ ok: true, data: { providers: [] } }));
ipcMain.handle("models:check", (_event, providerId, modelId, mode) => ({
  ok: true,
  data: {
    ok: true,
    category: mode === "real" ? "available" : "reachable",
    provider: "OpenAI",
    providerId,
    model: "GPT-4o",
    modelId,
    modelIdentifier: "gpt-4o",
    mode,
    latencyMs: 128,
    httpStatus: 200,
    summary: mode === "real" ? "模型真实请求成功" : "服务可达，模型目录请求成功",
    output: mode === "real" ? "OK" : undefined,
    technicalDetails: "200 OK",
  },
}));

async function captureDesktop() {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: path.join(desktopRoot, "src", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.on("console-message", (_event, _level, message) => console.error(`Renderer: ${message}`));
  await win.loadFile(path.join(desktopRoot, "src", "renderer", "index.html"));
  let startupReloaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  await win.webContents.executeJavaScript(`
    localStorage.removeItem('grok-desktop.workspace');
    localStorage.removeItem('grok-desktop.workspaces');
    location.reload();
  `);
  await startupReloaded;
  await new Promise((resolve) => setTimeout(resolve, 300));
  const startup = await win.webContents.executeJavaScript(`({
    cliReady: document.querySelector('#status-label').textContent === 'CLI 已连接',
    healthy: document.querySelector('#startup-health .health-row').classList.contains('ready'),
    noProject: state.workspace === '' && !state.connected,
    promptDisabled: document.querySelector('#prompt-input').disabled,
  })`);
  assert.ok(Object.values(startup).every(Boolean), 'CLI must connect before selecting a project: ' + JSON.stringify(startup));
  assert.ok(qaAgentStarts.some((attempt) => !attempt.cwd), 'startup must invoke CLI connection without a project');
  await saveCapture(win, "qa-cli-startup.png");
  const reloaded = new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
  await win.webContents.executeJavaScript(`
    localStorage.setItem("grok-desktop.workspace", "C:\\\\work\\\\grok-build-main");
    localStorage.setItem("grok-desktop.workspaces", JSON.stringify([
      "C:\\\\work\\\\grok-build-main",
      "D:\\\\projects\\\\frontend-dashboard"
    ]));
    location.reload();
  `);
  await reloaded;
  await new Promise((resolve) => setTimeout(resolve, 350));
  const draftProject = await win.webContents.executeJavaScript(`(async () => {
    const ready = state.connected && !state.sessionId && !elements.input.disabled && !elements.modelSelector.disabled;
    await activateWorkspace('D:\\\\projects\\\\frontend-dashboard');
    const switched = state.connected && !state.sessionId;
    elements.newSession.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return ready && switched && state.connected && !state.sessionId;
  })()`);
  assert.ok(draftProject, 'opening, switching projects and new chat must keep an editable draft without a session ID');
  assert.equal(qaPrompts.length, 0, 'project navigation must never submit a prompt');
  qaPromptFailure = true;
  const retained = await win.webContents.executeJavaScript(`(async () => {
    elements.input.value = '首条消息草稿';
    state.attachments = [{ id: 'first-send', name: 'draft.txt', kind: 'text', text: 'demo' }];
    saveDraft();
    await submitPrompt();
    return elements.input.value === '首条消息草稿' && state.attachments.length === 1 && !state.sessionId;
  })()`);
  assert.ok(retained, 'first-send preparation errors must retain the text and attachments');
  qaPromptFailure = false;
  const submitted = await win.webContents.executeJavaScript(`(async () => {
    const key = draftKey();
    await submitPrompt();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const sent = state.sessionId === 'qa-session' && elements.input.value === '' && !state.attachments.length && !state.drafts.has(key);
    await activateWorkspace('C:\\\\work\\\\grok-build-main');
    return sent;
  })()`);
  assert.ok(submitted, 'accepted first sends must adopt the session ID and clear only the submitted draft');
  await win.webContents.insertCSS("* { transition-duration: 0s !important; animation-duration: 0s !important; }");
  win.webContents.send("control:runtime", {
    connected: true,
    busy: false,
    status: "ready",
    workspace: "C:\\work\\grok-build-main",
    sessionId: "qa-session",
    modelState: {
      currentModelId: "openai-gpt-4o",
      models: [
        { id: "openai-gpt-4o", name: "GPT-4o" },
        { id: "grok-build", name: "grok-build" },
      ],
    },
    modelProviders: [{ id: "openai", name: "OpenAI", modelIds: ["openai-gpt-4o"] }],
    modeState: { modes: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 350));
  const modelLabels = await win.webContents.executeJavaScript(`
    [...document.querySelectorAll("#model-selector option")].map((option) => option.textContent)
  `);
  if (!modelLabels.includes("GPT-4o · OpenAI") || !modelLabels.includes("grok-build · Grok")) {
    throw new Error(`Model provider labels are invalid: ${JSON.stringify(modelLabels)}`);
  }
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputRoot, "qa-desktop-workspaces.png"), image.toPNG());
  const ideShell = await win.webContents.executeJavaScript(`(() => ({
    treeNodes: document.querySelectorAll(".workspace-tree-node").length,
    nestedSessions: document.querySelectorAll(".workspace-session").length,
    sidebarWidth: document.querySelector("#desktop-sidebar").getBoundingClientRect().width,
    searchVisible: !document.querySelector("#sessions-button").hidden,
  }))()`);
  if (ideShell.treeNodes < 2 || ideShell.nestedSessions < 2 || ideShell.sidebarWidth < 220 || !ideShell.searchVisible) {
    throw new Error(`IDE shell layout is invalid: ${JSON.stringify(ideShell)}`);
  }
  await saveCapture(win, "qa-desktop-ide-shell.png");
  assert.ok(qaHistoryScopes.includes('projects'), 'sidebar must request history across projects');
  const otherHistory = await win.webContents.executeJavaScript(`
    [...document.querySelectorAll('.workspace-tree-node')].find((node) => node.dataset.workspace.includes('frontend-dashboard'))?.textContent.includes('另一个项目的历史对话')
  `);
  assert.ok(otherHistory, 'inactive projects must show their history without being opened');
  const startsBefore = qaAgentStarts.length;
  const sameProject = await win.webContents.executeJavaScript(`(async () => {
    const marker = document.createElement('div');
    marker.id = 'qa-session-preserved';
    document.querySelector('#message-list').append(marker);
    const sessionBefore = state.sessionId;
    await activateWorkspace(state.workspace);
    const preserved = Boolean(document.querySelector('#qa-session-preserved')) && state.sessionId === sessionBefore;
    marker.remove();
    return preserved;
  })()`);
  assert.ok(sameProject && qaAgentStarts.length === startsBefore, 'clicking the active project must preserve its conversation and connection');
  const promptsBeforeProjectCreate = qaPrompts.length;
  const projectCreate = await win.webContents.executeJavaScript(`(async () => {
    const original = { id: state.sessionId, cwd: state.workspace, title: '新任务' };
    const historyCount = state.recentSessions.length;
    elements.input.value = '原会话的未发送内容';
    state.attachments = [{ name: 'keep.txt', kind: 'text', text: 'keep' }];
    const other = [...document.querySelectorAll('.workspace-tree-node')].find((node) => node.dataset.workspace !== state.workspace);
    const target = other.dataset.workspace;
    const create = other.querySelector('.workspace-new-session');
    const visible = create.getBoundingClientRect().width >= 26 && getComputedStyle(create).opacity === '1' && create.querySelector('[data-lucide="plus"]');
    create.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const created = state.workspace === target && state.connected && !state.sessionId && elements.input.value === '' && !state.attachments.length && document.activeElement === elements.input && state.recentSessions.length === historyCount;
    document.querySelector('.workspace-entry.active .workspace-new-session').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const repeated = state.workspace === target && !state.sessionId && state.recentSessions.length === historyCount;
    const more = document.querySelector('.workspace-entry.active .workspace-more');
    more.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const menu = elements.workspaceMenu.matches(':popover-open') && state.workspaceMenuTarget === target && !document.querySelector('.workspace-entry .workspace-remove');
    elements.workspaceMenu.hidePopover();
    await loadRecentSession(original, document.createElement('button'));
    const restored = elements.input.value === '原会话的未发送内容' && state.attachments[0]?.name === 'keep.txt';
    state.drafts.clear(); elements.input.value = ''; state.attachments = []; renderAttachments(); resizeInput();
    return { visible: Boolean(visible), created, repeated, menu, restored };
  })()`);
  assert.ok(Object.values(projectCreate).every(Boolean), 'project plus must create a draft in that project and preserve old conversation drafts: ' + JSON.stringify(projectCreate));
  assert.equal(qaPrompts.length, promptsBeforeProjectCreate, 'project plus must never send a prompt or persist an empty conversation');
  assert.equal(qaAgentStarts.at(-1).options.newSession, true, 'project plus must explicitly start a fresh draft');
  await saveCapture(win, "qa-project-new-conversation.png");
  const draftChecks = await win.webContents.executeJavaScript(`(async () => {
    const original = { id: state.sessionId, cwd: state.workspace, title: '新任务' };
    const attachment = { id: 'draft-file', name: 'draft.txt', kind: 'text', mime: 'text/plain', size: 4, text: 'demo' };
    elements.input.value = '第一段未发送的草稿';
    state.attachments = [attachment];
    const other = { id: 'qa-draft-other', cwd: state.workspace, title: '另一个对话' };
    await loadRecentSession(other, document.createElement('button'));
    const separate = elements.input.value === '' && state.attachments.length === 0;
    elements.input.value = '另一个对话的草稿';
    await loadRecentSession(original, document.createElement('button'));
    const restored = elements.input.value === '第一段未发送的草稿' && state.attachments[0]?.name === 'draft.txt';
    await loadRecentSession(other, document.createElement('button'));
    const otherRestored = elements.input.value === '另一个对话的草稿';
    await loadRecentSession(original, document.createElement('button'));
    state.drafts.clear();
    elements.input.value = '';
    state.attachments = [];
    clearConversation();
    renderAttachments();
    resizeInput();
    return separate && restored && otherRestored;
  })()`);
  assert.ok(draftChecks, 'switching conversations must preserve separate text and attachment drafts');
  const imageIngest = await win.webContents.executeJavaScript(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(avatarDataUrl().split(',')[1])}), (char) => char.charCodeAt(0));
    const waitFor = async (predicate) => { for (let i = 0; i < 100 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 10)); return predicate(); };
    elements.input.value = '保留原有文字'; state.attachments = []; renderAttachments();
    const protectedTransfer = { types: ['Files'], files: [], items: [{ kind: 'file', getAsFile: () => null }] };
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: protectedTransfer });
    elements.composer.dispatchEvent(over);
    const accepted = over.defaultPrevented && elements.composer.classList.contains('drop-active') && protectedTransfer.dropEffect === 'copy';
    const dropped = new DataTransfer(); dropped.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dropped });
    elements.composer.dispatchEvent(drop);
    const dropLoaded = await waitFor(() => state.attachments.length === 1);
    const pasted = new DataTransfer(); pasted.items.add(new File([bytes], 'clipboard.png', { type: 'image/png' }));
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: pasted });
    elements.input.dispatchEvent(paste);
    const pasteLoaded = await waitFor(() => state.attachments.length === 2);
    const textTransfer = new DataTransfer(); textTransfer.setData('text/plain', '普通文本');
    const textPaste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: textTransfer });
    elements.input.dispatchEvent(textPaste);
    const textIntact = !textPaste.defaultPrevented && elements.input.value === '保留原有文字';
    const previews = await waitFor(() => [...elements.attachmentList.querySelectorAll('img')].filter((img) => img.naturalWidth > 0).length === 2);
    const images = state.attachments.every((item) => item.kind === 'image' && item.mimeType === 'image/png' && item.data);
    elements.input.value = ''; await submitPrompt();
    return { accepted, dropLoaded, pasteLoaded, dropPrevented: drop.defaultPrevented, pastePrevented: paste.defaultPrevented, textIntact, previews, images, cleared: !state.attachments.length };
  })()`);
  assert.ok(Object.values(imageIngest).every(Boolean), 'dragging and pasting images must preserve text, render thumbnails and support image-only sends: ' + JSON.stringify(imageIngest));
  const imagePrompt = require('../src/prompt-content').buildPromptContent(qaPrompts.at(-1));
  assert.equal(imagePrompt.blocks.filter((block) => block.type === 'image').length, 2, 'image payloads must reach the CLI as ACP image blocks');
  await win.webContents.executeJavaScript(`clearConversation(); elements.input.value = ''; resizeInput();`);
  const permanentActions = await win.webContents.executeJavaScript(`
    [...document.querySelectorAll('.sidebar-rail button, .brand-row button, .ide-command-bar button, .workspace-heading button')]
      .filter((button) => button.getClientRects().length && getComputedStyle(button).visibility !== 'hidden').length
  `);
  assert.ok(permanentActions <= 5, 'expanded idle sidebar must expose at most five primary utility actions');
  const sidebarChecks = await win.webContents.executeJavaScript(`(() => {
    globalThis.qaSidebarBackup = {
      workspaces: [...state.workspaces], sessions: [...state.recentSessions],
      tree: { ...state.workspaceTreeState }, collapsed: state.sidebarCollapsed,
    };
    state.workspaceTreeState = {};
    state.expandedSessionLists.clear();
    state.workspaces = [state.workspace, 'D:/projects/数据下载', 'D:/projects/id4s', 'D:/projects/新架构'];
    const titles = ['重新设计项目侧栏', '制作 Windows 客户端', '检查 CLI 连接状态', '优化移动端布局', '整理项目规则', '检查会话同步', '修复附件预览', '优化代码结构', '继续当前的设计任务'];
    state.recentSessions = state.workspaces.flatMap((cwd, projectIndex) => titles.map((title, index) => ({
      id: projectIndex === 0 && index === 8 ? state.sessionId : 'sidebar-' + projectIndex + '-' + index,
      cwd, title, modelId: 'grok-build', updatedAt: Date.now(),
    })));
    setSidebarCollapsed(false);
    renderWorkspaceTree();
    updateControls();
    const first = document.querySelector('.workspace-tree-node');
    const initialCount = first.querySelectorAll('.workspace-session').length;
    const activeVisible = Boolean(first.querySelector('[aria-current="page"]'));
    first.querySelector('.workspace-show-more').click();
    const expandedCount = document.querySelector('.workspace-tree-node').querySelectorAll('.workspace-session').length;
    document.querySelector('.workspace-show-more').click();
    const reducedCount = document.querySelector('.workspace-tree-node').querySelectorAll('.workspace-session').length;
    const tree = document.querySelector('#workspace-tree');
    const scrollable = tree.scrollHeight > tree.clientHeight;
    document.querySelector('#sidebar-menu-button').click();
    const menuOpened = document.querySelector('#sidebar-more').matches(':popover-open');
    document.querySelector('#settings-button').click();
    const railWorks = menuOpened && document.querySelector('#settings-dialog').open && !document.querySelector('#sidebar-more').matches(':popover-open');
    document.querySelector('#settings-dialog').close();
    return { initialCount, activeVisible, expandedCount, reducedCount, scrollable, railWorks };
  })()`);
  assert.equal(sidebarChecks.initialCount, 5);
  assert.equal(sidebarChecks.activeVisible, true);
  assert.equal(sidebarChecks.expandedCount, 9);
  assert.equal(sidebarChecks.reducedCount, 5);
  assert.ok(sidebarChecks.scrollable && sidebarChecks.railWorks, 'project list and utility rail must work independently');
  const unifiedThemes = await win.webContents.executeJavaScript(`(() => {
    const previous = state.theme;
    const result = ['light', 'dark'].every((theme) => {
      applyTheme(theme);
      const body = getComputedStyle(document.body);
      const sidebar = getComputedStyle(document.querySelector('#desktop-sidebar'));
      const active = getComputedStyle(document.querySelector('.workspace-session.active'));
      return sidebar.getPropertyValue('--accent') === body.getPropertyValue('--accent')
        && sidebar.getPropertyValue('--text') === body.getPropertyValue('--text')
        && active.color === getComputedStyle(document.querySelector('.empty-symbol')).color;
    });
    applyTheme(previous);
    return result;
  })()`);
  assert.ok(unifiedThemes, 'sidebar must inherit the app palette in every theme');
  await new Promise((resolve) => setTimeout(resolve, 220));
  await saveCapture(win, "qa-sidebar-projects.png");
  for (const theme of ['light', 'dark']) {
    await win.webContents.executeJavaScript(`applyTheme(${JSON.stringify(theme)})`);
    const surfaces = await win.webContents.executeJavaScript(`(() => {
      const dark = document.body.dataset.theme === 'dark';
      const selectors = ['.main-pane', '#desktop-sidebar', '.sidebar-rail', '#composer', '#background-dialog'];
      const consistent = selectors.every((selector) => {
        const color = getComputedStyle(document.querySelector(selector)).backgroundColor;
        const channels = color.match(/[\\d.]+/g).slice(0, 3).map(Number);
        const brightness = channels.reduce((sum, value) => sum + value, 0) / 3;
        return dark ? brightness < 70 : brightness > 220;
      });
      const nativeTheme = getComputedStyle(document.documentElement).colorScheme === (dark ? 'dark' : 'light');
      const dropdowns = [...document.querySelectorAll('select option')].every((option) => {
        const style = getComputedStyle(option);
        const channels = style.backgroundColor.match(/[\\d.]+/g).slice(0, 3).map(Number);
        const brightness = channels.reduce((sum, value) => sum + value, 0) / 3;
        return style.color !== style.backgroundColor && (dark ? brightness < 70 : brightness > 220);
      });
      return consistent && nativeTheme && dropdowns && localStorage.getItem('grok-desktop.theme') === document.body.dataset.theme
        && document.querySelectorAll('.theme-picker [data-theme]').length === 2;
    })()`);
    assert.ok(surfaces, theme + ' must apply consistently to sidebar, chat, composer, and dialogs');
    await new Promise((resolve) => setTimeout(resolve, 120));
    await saveCapture(win, 'qa-theme-' + theme + '.png');
  }
  await win.webContents.executeJavaScript(`document.querySelector('#background-dialog').showModal()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await saveCapture(win, 'qa-theme-dark-appearance.png');
  await win.webContents.executeJavaScript(`document.querySelector('#background-dialog').close(); applyTheme('light');`);
  await win.webContents.executeJavaScript(`document.querySelector('#sidebar-menu-button').click()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  await saveCapture(win, 'qa-usability-menu.png');
  await win.webContents.executeJavaScript(`elements.sidebarMore.hidePopover()`);
  const collapsedRail = await win.webContents.executeJavaScript(`(() => {
    setSidebarCollapsed(true);
    const bodyHidden = getComputedStyle(document.querySelector('#sidebar-body')).display === 'none';
    const railVisible = document.querySelector('.sidebar-rail').getBoundingClientRect().width >= 48;
    document.querySelector('#sidebar-menu-button').click();
    const menuAccessible = document.querySelector('#sidebar-more').matches(':popover-open');
    elements.sidebarMore.hidePopover();
    document.querySelector('#rail-projects').click();
    return bodyHidden && railVisible && menuAccessible && !state.sidebarCollapsed;
  })()`);
  assert.ok(collapsedRail, 'collapsed sidebar must retain its utility rail and expand action');
  await win.webContents.executeJavaScript(`
    state.workspaces = qaSidebarBackup.workspaces;
    state.recentSessions = qaSidebarBackup.sessions;
    state.workspaceTreeState = qaSidebarBackup.tree;
    state.expandedSessionLists.clear();
    setSidebarCollapsed(qaSidebarBackup.collapsed);
    renderWorkspaceTree();
    updateControls();
    delete globalThis.qaSidebarBackup;
  `);
  const suggestion = await win.webContents.executeJavaScript(`(() => {
    document.querySelector('[data-prompt]').click();
    const filled = document.querySelector('#prompt-input').value.includes('目录结构');
    const sendEnabled = !document.querySelector('#send-button').disabled;
    document.querySelector('#prompt-input').value = '';
    document.querySelector('#prompt-input').dispatchEvent(new Event('input', { bubbles: true }));
    const conversation = document.querySelector('#conversation');
    return { filled, sendEnabled, overflow: conversation.scrollHeight - conversation.clientHeight };
  })()`);
  assert.ok(suggestion.filled && suggestion.sendEnabled, 'suggestions must fill an editable prompt');
  assert.ok(suggestion.overflow <= 1, 'welcome content must fit above the composer');
  const toolbarGeometry = await win.webContents.executeJavaScript(`(() => {
    globalThis.qaModelBackup = { model: state.modelState, mode: state.modeState };
    renderModelState({ currentModelId: 'grok-build', reasoningEffort: 'high', models: [{ id: 'grok-build', name: 'Grok 4.6', meta: { reasoningEfforts: [{ id: 'low', label: 'Low Effort' }, { id: 'high', label: 'High Effort' }] } }] });
    const controls = document.querySelector('#session-controls').getBoundingClientRect();
    const actions = document.querySelector('.composer-actions').getBoundingClientRect();
    const form = document.querySelector('#composer').getBoundingClientRect();
    return { effortVisible: !document.querySelector('#effort-control').hidden, aligned: Math.abs((controls.top + controls.bottom) / 2 - (actions.top + actions.bottom) / 2) <= 2,
      inside: controls.left >= form.left && actions.right <= form.right + 1,
      contextOutside: !document.querySelector('#composer').contains(document.querySelector('#composer-context')) };
  })()`);
  assert.ok(Object.values(toolbarGeometry).every(Boolean), 'composer configuration and action buttons must share an aligned toolbar');
  await new Promise((resolve) => setTimeout(resolve, 120));
  await saveCapture(win, 'qa-composer-toolbar.png');
  const descendingEfforts = await win.webContents.executeJavaScript(`(() => {
    globalThis.qaDescendingModel = { id: 'grok-build', name: 'Grok 4.7', meta: { reasoningEfforts: [
      { id: 'deep', value: 'xhigh', label: 'Extra High' }, { id: 'high', label: 'High' }, { id: 'medium', label: 'Medium', default: true }, { id: 'low', label: 'Low' },
    ] } };
    renderModelState({ currentModelId: 'grok-build', reasoningEffort: 'low', models: [qaDescendingModel] });
    elements.modelSettingsButton.click(); applyTheme('dark');
    const low = elements.effortSelector.value === '0' && elements.effortValue.textContent === 'Low' && elements.modelSettingsPopover.dataset.maxEffort === 'false' && elements.modelSettingsButton.dataset.maxEffort === 'false' && getComputedStyle(document.querySelector('.effort-max-badge')).display === 'none';
    const labels = document.querySelector('#effort-min-label').textContent === 'Low' && document.querySelector('#effort-max-label').textContent === 'Extra High';
    renderModelState({ reasoningEffort: 'max' });
    const max = elements.effortSelector.value === '3' && elements.effortValue.textContent === 'Extra High' && elements.modelSettingsPopover.dataset.maxEffort === 'true';
    renderModelState({ reasoningEffort: null });
    const defaultMapped = elements.effortSelector.value === '1' && elements.effortValue.textContent === 'Medium' && elements.modelSettingsPopover.dataset.maxEffort === 'false';
    renderModelState({ reasoningEffort: 'unknown-current' });
    const unknown = elements.effortValue.textContent === 'unknown-current' && elements.modelSettingsPopover.dataset.maxEffort === 'false';
    renderModelState({ reasoningEffort: 'low' });
    return { low, labels, max, defaultMapped, unknown };
  })()`);
  assert.ok(Object.values(descendingEfforts).every(Boolean), 'descending real-world catalogs must preserve semantic effort order and current value: ' + JSON.stringify(descendingEfforts));
  await win.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await saveCapture(win, 'qa-effort-low-v0112.png');
  await win.webContents.executeJavaScript(`renderModelState({ reasoningEffort: 'xhigh' })`);
  await win.webContents.executeJavaScript(`new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  await saveCapture(win, 'qa-effort-highest-v0112.png');
  await win.webContents.executeJavaScript(`elements.modelSettingsPopover.hidePopover(); applyTheme('light'); delete globalThis.qaDescendingModel;`);
  const strengthPanel = await win.webContents.executeJavaScript(`(async () => {
    renderModelState({ currentModelId: 'grok-build', reasoningEffort: 'medium', models: [${JSON.stringify(qaEffortModel)}] });
    elements.modelSettingsButton.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const panel = elements.modelSettingsPopover.getBoundingClientRect();
    const open = elements.modelSettingsPopover.matches(':popover-open') && panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom < elements.modelSettingsButton.getBoundingClientRect().top;
    const range = elements.effortSelector;
    range.value = range.max; range.dispatchEvent(new Event('input', { bubbles: true }));
    const highest = elements.modelSettingsPopover.dataset.maxEffort === 'true' && elements.modelSettingsButton.dataset.maxEffort === 'true' && range.getAttribute('aria-valuetext') === '极高' && getComputedStyle(document.querySelector('.effort-max-badge')).display !== 'none';
    range.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 100 && state.modelSettingsBusy; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const saved = state.modelState.reasoningEffort === 'xhigh' && !range.disabled;
    range.value = '1'; range.dispatchEvent(new Event('input', { bubbles: true }));
    const lower = elements.modelSettingsPopover.dataset.maxEffort === 'false' && elements.modelSettingsButton.dataset.maxEffort === 'false';
    renderModelState({}); applyTheme('dark');
    return { open, highest, saved, lower };
  })()`);
  assert.ok(Object.values(strengthPanel).every(Boolean), 'model popover must expose supported effort levels and enable the effect only at maximum: ' + JSON.stringify(strengthPanel));
  assert.equal(qaModelRequests.at(-1).reasoningEffort, 'xhigh', 'slider changes must send the effort ID, not its numeric position');
  const darkPanel = await win.webContents.executeJavaScript(`(async () => {
    applyTheme('dark');
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return document.body.dataset.theme === 'dark' && getComputedStyle(elements.modelSettingsPopover).backgroundColor === 'rgb(36, 38, 41)';
  })()`);
  assert.ok(darkPanel, 'the open strength panel must use the dark palette');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  const gradients = await win.webContents.executeJavaScript(`(() => {
    const results = [];
    for (const theme of ['light', 'dark']) {
      applyTheme(theme);
      const colors = new Set(); const fills = new Set();
      for (const level of ['low', 'medium', 'high', 'xhigh']) {
        renderModelState({ reasoningEffort: level });
        const fill = document.querySelector('.effort-slider-fill');
        colors.add(getComputedStyle(elements.effortValue).color);
        fills.add(getComputedStyle(fill).backgroundImage);
        const animation = getComputedStyle(fill, '::after').animationName;
        results.push(elements.modelSettingsPopover.dataset.effortLevel === level && (level === 'xhigh' ? animation === 'effort-sheen-travel' : animation === 'none'));
      }
      results.push(colors.size === 4 && fills.size === 4);
    }
    return results.every(Boolean);
  })()`);
  assert.ok(gradients, 'every level must have its own gradient and only the highest may show the travelling sheen');
  await captureEffortFlow(win);
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const reducedMotion = await win.webContents.executeJavaScript(`(() => {
    const fill = document.querySelector('.effort-slider-fill');
    const sheen = getComputedStyle(fill, '::after');
    return sheen.animationName === 'none' && sheen.opacity === '0' && getComputedStyle(fill).backgroundImage.includes('linear-gradient');
  })()`);
  assert.ok(reducedMotion, 'reduced motion must stop the sheen while preserving the level gradient');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  win.webContents.debugger.detach();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await saveCapture(win, 'qa-composer-slider-dark-v0113.png');
  await win.webContents.executeJavaScript(`applyTheme('light')`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await saveCapture(win, 'qa-composer-slider-light-v0113.png');
  qaModelFailure = true;
  const strengthRollback = await win.webContents.executeJavaScript(`(async () => {
    elements.effortSelector.value = '1';
    elements.effortSelector.dispatchEvent(new Event('input', { bubbles: true }));
    elements.effortSelector.dispatchEvent(new Event('change', { bubbles: true }));
    for (let i = 0; i < 100 && state.modelSettingsBusy; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    const restored = state.modelState.reasoningEffort === 'xhigh' && elements.effortSelector.value === '4' && elements.modelSettingsPopover.dataset.maxEffort === 'true';
    elements.modelSettingsPopover.hidePopover(); clearConversation();
    return restored;
  })()`);
  assert.ok(strengthRollback, 'failed effort changes must restore the saved value and effect');
  qaModelFailure = false;
  await win.webContents.executeJavaScript(`renderModelState(qaModelBackup.model); renderModeState(qaModelBackup.mode); delete globalThis.qaModelBackup;`);
  await saveCapture(win, "qa-redesign-desktop.png");
  for (const width of [840, 430, 320]) {
    await resizeContent(win, width, 780);
    const narrow = await win.webContents.executeJavaScript(`(() => {
      const form = document.querySelector('#composer').getBoundingClientRect();
      const title = document.querySelector('.topbar').getBoundingClientRect();
      const visibleSelect = getComputedStyle(document.querySelector('#permission-mode-control')).display !== 'none';
      const toolbar = document.querySelector('.composer-toolbar');
      const toolbarFits = toolbar.scrollWidth <= toolbar.clientWidth + 1;
      document.querySelector('#mobile-sidebar-toggle').click();
      const open = document.querySelector('#mobile-sidebar-toggle').getAttribute('aria-expanded') === 'true';
      const mainInert = document.querySelector('.main-pane').inert;
      const sidebarActive = !document.querySelector('#desktop-sidebar').inert;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const closed = document.querySelector('#desktop-sidebar').inert && !document.querySelector('.main-pane').inert;
      return { formInside: form.left >= 0 && form.right <= innerWidth + 1 && form.bottom <= innerHeight + 1, headerInside: title.right <= innerWidth + 1, toolbarFits, visibleSelect, open, mainInert, sidebarActive, closed };
    })()`);
    assert.ok(Object.values(narrow).every(Boolean), 'narrow desktop layout and drawer must remain usable: ' + JSON.stringify({ width, ...narrow }));
    if (width === 430) {
      await saveCapture(win, "qa-redesign-narrow.png");
      await win.webContents.executeJavaScript(`document.querySelector('#mobile-sidebar-toggle').click()`);
      await new Promise((resolve) => setTimeout(resolve, 220));
      const drawerFits = await win.webContents.executeJavaScript(`(() => {
        const sidebar = document.querySelector('#desktop-sidebar').getBoundingClientRect();
        const body = document.querySelector('#sidebar-body').getBoundingClientRect();
        return sidebar.left >= 0 && body.width >= sidebar.width - 1 && body.right <= innerWidth;
      })()`);
      assert.ok(drawerFits, 'full-width project list must fit in the mobile drawer');
      await saveCapture(win, "qa-sidebar-mobile.png");
      await win.webContents.executeJavaScript(`setNavigationOpen(false)`);
    }
  }
  await resizeContent(win, 1240, 820);
  await win.webContents.executeJavaScript(`state.connected = false; updateControls(); renderStartupHealth();`);
  const setupLayout = await win.webContents.executeJavaScript(`(() => {
    const setup = document.querySelector('#empty-workspace-button').getBoundingClientRect();
    const health = document.querySelector('#startup-health').getBoundingClientRect();
    const composer = document.querySelector('#composer').getBoundingClientRect();
    return { visible: setup.width > 0 && setup.top > 64 && setup.bottom < composer.top, fits: health.bottom < composer.top, disabled: document.querySelector('#prompt-input').disabled };
  })()`);
  assert.ok(Object.values(setupLayout).every(Boolean), 'setup actions must remain visible above the disabled composer');
  await saveCapture(win, "qa-redesign-setup.png");
  await win.webContents.executeJavaScript(`state.connected = true; updateControls(); renderStartupHealth();`);
  await resizeContent(win, 1100, 640);
  const shortSidebar = await win.webContents.executeJavaScript(`(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector).getBoundingClientRect();
      return { top: value.top, bottom: value.bottom, left: value.left, right: value.right, width: value.width, height: value.height };
    };
    const sidebar = rect("#desktop-sidebar");
    const workspace = rect(".workspace-tree-region");
    const footer = rect(".sidebar-footer");
    const account = rect(".account-row");
    const inside = (value) => value.left >= sidebar.left && value.right <= sidebar.right + 1 && value.top >= sidebar.top && value.bottom <= sidebar.bottom + 1;
    const sidebarFooterInside = inside(footer) && inside(account);
    return {
      workspaceHeight: workspace.height,
      workspaceOverflowY: getComputedStyle(document.querySelector("#workspace-tree")).overflowY,
      sidebarFooterInside,
      footerAfterNavigation: footer.top >= workspace.bottom - 1,
      accountHeight: account.height,
    };
  })()`);
  if (shortSidebar.workspaceHeight < 100 || shortSidebar.workspaceOverflowY !== "auto" || !shortSidebar.sidebarFooterInside || !shortSidebar.footerAfterNavigation || shortSidebar.accountHeight < 40) {
    throw new Error(`Short desktop sidebar is invalid: ${JSON.stringify(shortSidebar)}`);
  }
  await saveCapture(win, "qa-desktop-sidebar-short.png");
  await resizeContent(win, 1240, 820);
  win.webContents.send("agent:task-status", {
    id: "qa-desktop-task",
    state: "started",
    source: "desktop",
    timestamp: Date.now(),
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const desktopTaskStatus = await win.webContents.executeJavaScript(`(() => {
    const strip = document.querySelector("#task-status");
    const composer = document.querySelector("#composer").getBoundingClientRect();
    const rect = strip.getBoundingClientRect();
    return {
      visible: !strip.hidden,
      state: strip.dataset.state,
      label: document.querySelector("#task-status-label").textContent,
      insideComposerWidth: rect.left >= composer.left && rect.right <= composer.right,
    };
  })()`);
  if (!desktopTaskStatus.visible || desktopTaskStatus.state !== "started" || desktopTaskStatus.label !== "任务已开始" || !desktopTaskStatus.insideComposerWidth) {
    throw new Error(`Desktop task status is invalid: ${JSON.stringify(desktopTaskStatus)}`);
  }
  await saveCapture(win, "qa-desktop-task-status.png");
  await win.webContents.executeJavaScript(`renderTaskStatus(null); setTurnProgress(state.assistant, "complete")`);
  await win.webContents.executeJavaScript(`document.querySelector("#models-button").click()`);
  await new Promise((resolve) => setTimeout(resolve, 350));
  const providerUi = await win.webContents.executeJavaScript(`({
    open: document.querySelector("#models-dialog").open,
    providers: document.querySelectorAll("#provider-list .provider-group").length,
    models: document.querySelectorAll("#provider-list .provider-model-row").length,
  })`);
  if (!providerUi.open || providerUi.providers !== 1 || providerUi.models !== 2) {
    throw new Error(`Provider UI is invalid: ${JSON.stringify(providerUi)}`);
  }
  const providerImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputRoot, "qa-desktop-model-providers.png"), providerImage.toPNG());
  await win.webContents.executeJavaScript(`document.querySelector("#provider-list .provider-model-row .resource-actions button").click()`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const modelCheckUi = await win.webContents.executeJavaScript(`(() => {
    document.querySelector("#model-check-real").click();
    document.querySelector("#run-model-check").click();
    return {
      open: document.querySelector("#model-check-dialog").open,
      warningVisible: !document.querySelector("#model-check-credit-warning").hidden,
    };
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const modelCheckResult = await win.webContents.executeJavaScript(`({
    success: document.querySelector("#model-check-result").classList.contains("success"),
    output: document.querySelector("#model-check-result").textContent,
  })`);
  if (!modelCheckUi.open || !modelCheckUi.warningVisible || !modelCheckResult.success || !modelCheckResult.output.includes("OK")) {
    throw new Error(`Model check UI is invalid: ${JSON.stringify({ modelCheckUi, modelCheckResult })}`);
  }
  await saveCapture(win, "qa-desktop-model-check.png");
  await win.webContents.executeJavaScript(`document.querySelector("#model-check-dialog").close()`);
  await win.webContents.executeJavaScript(`document.querySelector("#provider-list .provider-header .resource-actions button").click()`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const modelFormUi = await win.webContents.executeJavaScript(`({
    nameRequired: document.querySelector("#provider-model-name").required,
    identifierRequired: document.querySelector("#provider-model-value").required,
    identifierAdvanced: Boolean(document.querySelector(".advanced-settings #provider-model-value")),
    submitText: document.querySelector("#provider-model-form button[type=submit]").textContent.trim(),
    applyText: document.querySelector("#apply-model-config").textContent.trim(),
  })`);
  if (!modelFormUi.nameRequired || modelFormUi.identifierRequired || !modelFormUi.identifierAdvanced || !modelFormUi.submitText.includes("保存模型") || !modelFormUi.applyText.includes("应用并刷新")) {
    throw new Error(`Model form UI is invalid: ${JSON.stringify(modelFormUi)}`);
  }
  const modelFormImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputRoot, "qa-desktop-model-form.png"), modelFormImage.toPNG());
  await win.webContents.executeJavaScript(`document.querySelector("#cancel-provider-model").click()`);
  await win.webContents.executeJavaScript(`document.querySelector("#models-dialog").close()`);
  const conflictUi = await win.webContents.executeJavaScript(`(() => {
    showModelConflict({ data: { modelId: "gpt" } }, null);
    return {
      open: document.querySelector("#model-conflict-dialog").open,
      actions: document.querySelectorAll("#model-conflict-dialog .conflict-actions button").length,
    };
  })()`);
  if (!conflictUi.open || conflictUi.actions !== 3) throw new Error(`Conflict UI is invalid: ${JSON.stringify(conflictUi)}`);
  const conflictImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputRoot, "qa-desktop-model-conflict.png"), conflictImage.toPNG());
  await win.webContents.executeJavaScript(`
    document.querySelector("#model-conflict-dialog").close();
    showError('serialization error: missing field output');
    showError('serialization error: missing field output');
    const duplicates = [...document.querySelectorAll(".error-card")].filter((item) => item.dataset.errorDetails.includes("missing field"));
    if (duplicates.length !== 1) throw new Error("Duplicate errors were not collapsed");
    if (duplicates[0].querySelector("strong").textContent.includes("missing field")) throw new Error("Raw error leaked into headline");
    if (duplicates[0].querySelector("details").open) throw new Error("Technical details must start collapsed");
    duplicates[0].remove();
  `);
  win.webContents.send("control:user-message", {
    text: "开展代码 Review，核查方向包含：冗余无效代码排查、各业务模块功能落地实现校验、代码耦合度分析，全程采用专业工程师视角分析；仅输出问题审查汇总内容，不编写、不修改源码，最终把全部评审结果告诉我",
    attachments: [],
  });
  win.webContents.send("agent:update", {
    update: { sessionUpdate: "agent_message_chunk", content: { text: "我先检查简历中的技能描述，然后更新对应内容。" } },
  });
  for (const update of [
    {
      sessionUpdate: "tool_call",
      toolCallId: "qa-search-renderer",
      tool: "run_terminal_command",
      title: 'rg -n "workspace-tree-region|sidebar-spacer" C:\\work\\renderer.js',
      rawInput: { command: 'rg -n "workspace-tree-region|sidebar-spacer" C:\\work\\renderer.js' },
      status: "completed",
      content: "renderer.js:293:.workspace-tree-region",
    },
    {
      sessionUpdate: "tool_call",
      toolCallId: "qa-search-styles",
      tool: "run_terminal_command",
      title: 'rg -n "tool-card|tool-header" C:\\work\\styles.css',
      rawInput: { command: 'rg -n "tool-card|tool-header" C:\\work\\styles.css' },
      status: "completed",
      content: "styles.css:1379:.tool-card",
    },
    ...Array.from({ length: 4 }, (_value, index) => ({
      sessionUpdate: "tool_call",
      toolCallId: `qa-read-${index + 1}`,
      title: "Read `C:\\work\\services\\chat_service.py`",
      rawInput: { file_path: "C:\\work\\services\\chat_service.py" },
      status: "completed",
      content: `读取结果 ${index + 1}`,
    })),
  ]) win.webContents.send("agent:update", { update });
  win.webContents.send("agent:update", {
    update: { sessionUpdate: "agent_message_chunk", content: { text: "定位完成，我继续修改目标文件并验证运行结果。" } },
  });
  for (const update of [
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "qa-edit",
      title: "Edit `C:\\work\\build_resume.py`",
      status: "completed",
      content: [{
        type: "diff",
        path: "C:\\work\\build_resume.py",
        oldText: "熟悉 SQLite",
        newText: "熟悉 PyTorch",
        _meta: { details: [{ old_string: "熟悉 SQLite", old_line: 100, new_string: "熟悉 PyTorch", new_line: 100 }] },
      }],
    },
    {
      sessionUpdate: "tool_call_update",
      toolCallId: "qa-terminal-failed",
      tool: "run_terminal_command",
      title: "PowerShell 检查 C:\\work\\missing-model.json",
      rawInput: { command: "Get-Content C:\\work\\missing-model.json" },
      status: "failed",
      content: "模型配置不存在",
    },
  ]) win.webContents.send("agent:update", { update });
  win.webContents.send("agent:update", {
    update: { sessionUpdate: "agent_message_chunk", content: { text: "最终结果：活动流已完成归并，失败的模型检查已单独列出。" } },
  });
  win.webContents.send("agent:update", {
    update: { sessionUpdate: "turn_completed", stop_reason: "end_turn" },
  });
  win.webContents.send("control:runtime", {
    connected: true,
    busy: true,
    queueLength: 2,
    promptQueue: [
      { id: "qa-queue-1", text: "继续检查格式", attachments: [], source: "desktop", createdAt: Date.now() },
      { id: "qa-queue-2", text: "最后导出文件", attachments: [{ name: "notes.txt", kind: "text", size: 12 }], source: "mobile", createdAt: Date.now() },
    ],
    status: "ready",
    workspace: "C:\\work\\grok-build-main",
    sessionId: "qa-session",
    avatars: { user: avatarDataUrl(), assistant: avatarDataUrl() },
    recoverablePrompt: { id: "qa-recovery", text: "继续修改刚才的内容", source: "desktop", attachments: [] },
  });
  await new Promise((resolve) => setTimeout(resolve, 280));
  const activityUi = await win.webContents.executeJavaScript(`(() => {
    const groups = [...document.querySelectorAll(".message.assistant .activity-group")];
    const rows = [...document.querySelectorAll(".message.assistant .activity-row")];
    const mainTitles = rows.map((row) => row.querySelector(".activity-row-title")?.textContent || "");
    const repeat = rows.find((row) => row.querySelector(".activity-row-title")?.textContent === "读取 chat_service.py")?.querySelector(".activity-repeat")?.textContent;
    const failed = document.querySelector(".message.assistant .activity-row.failed");
    const final = document.querySelector(".message.assistant .message-content.final-answer");
    return {
      groups: groups.length,
      rows: rows.length,
      labels: groups.map((group) => group.querySelector(".activity-group-label")?.textContent),
      mainTitles,
      repeat,
      firstCollapsed: !groups[0]?.open,
      failedGroupOpen: Boolean(groups[1]?.open),
      failedDetailsOpen: Boolean(failed?.querySelector(".activity-row-details")?.open),
      finalOutside: Boolean(final && !final.closest(".activity-group")),
    };
  })()`);
  if (activityUi.groups !== 2 || activityUi.rows !== 5 || activityUi.repeat !== "×4" || !activityUi.firstCollapsed || !activityUi.failedGroupOpen || !activityUi.failedDetailsOpen || !activityUi.finalOutside) {
    throw new Error(`IDE activity grouping is invalid: ${JSON.stringify(activityUi)}`);
  }
  if (activityUi.mainTitles.some((title) => title.includes("C:\\") || title.includes("workspace-tree-region") || title.includes("tool-card|tool-header"))) {
    throw new Error(`Raw tool details leaked into activity titles: ${JSON.stringify(activityUi.mainTitles)}`);
  }
  const activityCaptureViewport = await win.webContents.executeJavaScript(`(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const groups = [...document.querySelectorAll(".message.assistant .activity-group")];
    groups[0].open = true;
    document.querySelectorAll(".message.assistant .activity-row-details").forEach((details) => { details.open = false; });
    const conversation = document.querySelector("#conversation");
    state.autoFollow = false;
    const top = groups[0].getBoundingClientRect().top - conversation.getBoundingClientRect().top + conversation.scrollTop;
    conversation.scrollTop = Math.max(0, top - 12);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const groupRect = groups[0].getBoundingClientRect();
    const conversationRect = conversation.getBoundingClientRect();
    return {
      groupTop: groupRect.top,
      groupBottom: groupRect.bottom,
      conversationTop: conversationRect.top,
      conversationBottom: conversationRect.bottom,
      openDetails: document.querySelectorAll(".message.assistant .activity-row-details[open]").length,
    };
  })()`);
  if (activityCaptureViewport.groupTop < activityCaptureViewport.conversationTop || activityCaptureViewport.groupTop >= activityCaptureViewport.conversationBottom || activityCaptureViewport.openDetails !== 0) {
    throw new Error(`Activity capture did not reach the first group: ${JSON.stringify(activityCaptureViewport)}`);
  }
  await saveCapture(win, "qa-desktop-activity-stream.png");
  const desktopToolGeometry = await win.webContents.executeJavaScript(`(() => {
    const mainElement = document.querySelector(".main-pane");
    const assistantBody = document.querySelector(".message.assistant .message-body");
    const assistantContent = document.querySelector(".message.assistant .message-content");
    const imageProbe = document.createElement("img");
    imageProbe.width = 2400;
    imageProbe.height = 24;
    assistantContent.append(imageProbe);
    const thoughtProbe = document.createElement("div");
    thoughtProbe.className = "thought-block";
    thoughtProbe.textContent = "D:\\Desktop\\live2d-suzu\\live2d-llm\\modules\\plugin_runtime\\capability_manager_and_security_review_implementation.py";
    assistantBody.append(thoughtProbe);
    const conversationTitle = document.querySelector("#conversation-title");
    const originalTitle = conversationTitle.textContent;
    conversationTitle.textContent = "开展代码 Review，核查方向包含：冗余无效代码排查、各业务模块功能落地实现校验、代码耦合度分析，全程采用专业软件工程视角分析";
    const main = mainElement.getBoundingClientRect();
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const topbarTitle = document.querySelector(".topbar-title").getBoundingClientRect();
    const topbarActions = document.querySelector(".topbar-actions").getBoundingClientRect();
    const composer = document.querySelector("#composer").getBoundingClientRect();
    const body = assistantBody.getBoundingClientRect();
    const tool = document.querySelector(".message.assistant .activity-group").getBoundingClientRect();
    const toolName = document.querySelector(".message.assistant .activity-row-title").getBoundingClientRect();
    const image = imageProbe.getBoundingClientRect();
    const thought = thoughtProbe.getBoundingClientRect();
    const result = {
      topbarInside: topbar.left >= main.left && topbar.right <= main.right + 1,
      topbarContentInside: topbarTitle.left >= topbar.left && topbarTitle.right <= topbarActions.left + 1 && topbarActions.right <= topbar.right + 1,
      composerInside: composer.left >= main.left && composer.right <= main.right + 1,
      bodyInside: body.left >= main.left && body.right <= main.right + 1,
      toolInside: tool.left >= body.left && tool.right <= body.right + 1,
      toolNameInside: toolName.left >= tool.left && toolName.right <= tool.right + 1,
      imageInside: image.left >= body.left && image.right <= body.right + 1,
      thoughtInside: thought.left >= body.left && thought.right <= body.right + 1,
      mainHasNoHorizontalOverflow: mainElement.scrollWidth <= mainElement.clientWidth + 1,
    };
    imageProbe.remove();
    thoughtProbe.remove();
    conversationTitle.textContent = originalTitle;
    return result;
  })()`);
  if (!desktopToolGeometry.topbarInside || !desktopToolGeometry.topbarContentInside || !desktopToolGeometry.composerInside || !desktopToolGeometry.bodyInside || !desktopToolGeometry.toolInside || !desktopToolGeometry.toolNameInside || !desktopToolGeometry.imageInside || !desktopToolGeometry.thoughtInside || !desktopToolGeometry.mainHasNoHorizontalOverflow) {
    throw new Error(`Desktop tool layout escapes the main pane: ${JSON.stringify(desktopToolGeometry)}`);
  }
  const desktopMessageGeometry = await win.webContents.executeJavaScript(`(() => {
    const conversation = document.querySelector("#conversation");
    const message = document.querySelector(".message.user");
    const body = message.querySelector(".message-body");
    const content = message.querySelector(".message-content");
    const viewportRect = conversation.getBoundingClientRect();
    const messageRect = message.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    return {
      overflowX: getComputedStyle(conversation).overflowX,
      messageInside: messageRect.left >= viewportRect.left && messageRect.right <= viewportRect.right + 1,
      bodyInside: bodyRect.left >= viewportRect.left && bodyRect.right <= viewportRect.right + 1,
      contentInside: contentRect.left >= viewportRect.left && contentRect.right <= viewportRect.right + 1,
    };
  })()`);
  if (desktopMessageGeometry.overflowX !== "hidden" || !desktopMessageGeometry.messageInside || !desktopMessageGeometry.bodyInside || !desktopMessageGeometry.contentInside) {
    throw new Error(`Desktop long message escapes the conversation viewport: ${JSON.stringify(desktopMessageGeometry)}`);
  }
  await win.webContents.executeJavaScript('document.querySelector(".message.user").scrollIntoView({ block: "start" })');
  await verifyMessageAlignment(win);
  await captureMessageAlignment(win, "qa-message-alignment-light-v0116.png");
  await saveCapture(win, "qa-desktop-long-message.png");
  const timelineOrder = await win.webContents.executeJavaScript(`
    [...document.querySelectorAll(".message.assistant .message-body > .message-content, .message.assistant .message-body > .activity-group")]
      .map((node) => node.classList.contains("activity-group") ? "activity" : node.textContent.trim())
  `);
  if (timelineOrder.length !== 5 || timelineOrder[1] !== "activity" || timelineOrder[3] !== "activity" || !timelineOrder[4].includes("最终结果")) {
    throw new Error(`Assistant timeline order is invalid: ${JSON.stringify(timelineOrder)}`);
  }
  const turnUi = await win.webContents.executeJavaScript(`({
    state: document.querySelector(".message.assistant .turn-progress")?.dataset.state,
    finalLabel: document.querySelector(".message.assistant .final-answer-label")?.textContent,
    healthRows: document.querySelectorAll("#startup-health .health-row").length,
  })`);
  if (turnUi.state !== "complete" || turnUi.finalLabel !== "最终回答" || turnUi.healthRows !== 4) {
    throw new Error(`Turn progress or startup health is invalid: ${JSON.stringify(turnUi)}`);
  }
  const queueUi = await win.webContents.executeJavaScript(`({
    inputDisabled: document.querySelector("#prompt-input").disabled,
    running: document.querySelector("#running-indicator").textContent,
    queueItems: document.querySelectorAll("#prompt-queue-list .prompt-queue-item").length,
    composerMode: document.querySelector("#composer-submit-mode").dataset.mode,
  })`);
  if (queueUi.inputDisabled || !queueUi.running.includes("2 条待执行") || queueUi.queueItems !== 2 || queueUi.composerMode !== "queue") {
    throw new Error(`Prompt queue UI is invalid: ${JSON.stringify(queueUi)}`);
  }
  const avatarRecoveryUi = await win.webContents.executeJavaScript(`({
    recoverVisible: !document.querySelector("#recover-prompt").hidden,
    avatarImages: document.querySelectorAll(".message-avatar.has-image").length,
    editButtons: document.querySelectorAll(".message.user .message-edit").length,
  })`);
  if (!avatarRecoveryUi.recoverVisible || avatarRecoveryUi.avatarImages < 2 || avatarRecoveryUi.editButtons !== 1) {
    throw new Error(`Avatar and recovery UI is invalid: ${JSON.stringify(avatarRecoveryUi)}`);
  }
  await saveCapture(win, "qa-desktop-avatars-recovery.png");
  const toolImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputRoot, "qa-desktop-tool-results.png"), toolImage.toPNG());
  await verifyBackgroundErrorUi(win);
  const desktopUsability = await win.webContents.executeJavaScript(`(async () => {
    const filler = document.createElement("div");
    filler.style.height = "1200px";
    document.querySelector("#message-list").append(filler);
    scrollToBottom(true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const conversation = document.querySelector("#conversation");
    conversation.scrollTop = 0;
    conversation.dispatchEvent(new Event("scroll"));
    scrollToBottom();
    const jumpVisible = !document.querySelector("#jump-to-latest").hidden;
    const stayedAtTop = conversation.scrollTop < 10;
    filler.remove();
    document.querySelector("#jump-to-latest").click();
    showError('serialization error: missing field output');
    showPermission({ id: "qa-permission", toolCall: { title: "删除临时文件", rawInput: "Remove-Item qa.tmp" }, options: [{ id: "allow_once", name: "仅本次允许", kind: "allow_once" }] });
    const permission = {
      risk: document.querySelector("#permission-risk").textContent,
      target: document.querySelector("#permission-target").textContent,
      detailsOpen: document.querySelector("#permission-details").open,
    };
    document.querySelector("#permission-dialog").close();
    state.pendingPermission = null;
    updateControls();
    return { jumpVisible, stayedAtTop, permission };
  })()`);
  if (!desktopUsability.jumpVisible || !desktopUsability.stayedAtTop || desktopUsability.permission.risk !== "高影响操作" || desktopUsability.permission.detailsOpen) {
    throw new Error(`Desktop usability state is invalid: ${JSON.stringify(desktopUsability)}`);
  }
  await saveCapture(win, "qa-desktop-usability.png");
  await win.webContents.executeJavaScript(`
    document.querySelector('.theme-picker [data-theme="dark"]').click();
    document.querySelector("#background-button").click();
  `);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const themeImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputRoot, "qa-desktop-themes.png"), themeImage.toPNG());
  const desktopTable = await win.webContents.executeJavaScript(`(() => {
    document.querySelector("#background-dialog").close();
    const content = document.querySelector(".message.assistant .message-content");
    content.innerHTML = "<table><thead><tr><th>供应商</th><th>模型说明</th><th>可用状态</th></tr></thead><tbody><tr><td>OpenAI</td><td>支持长说明与链接，不应挤压标签列。</td><td>可用</td></tr><tr><td>Grok</td><td>中文标签需要保持完整可读。</td><td>可用</td></tr></tbody></table>";
    const table = content.querySelector("table");
    const firstCell = table.querySelector("th");
    return {
      firstWidth: firstCell.getBoundingClientRect().width,
      tableWidth: table.getBoundingClientRect().width,
      contentWidth: content.getBoundingClientRect().width,
    };
  })()`);
  await verifyMessageAlignment(win);
  await win.webContents.executeJavaScript('document.querySelector(".message.user").scrollIntoView({ block: "start" })');
  await captureMessageAlignment(win, "qa-message-alignment-dark-v0116.png");
  if (desktopTable.firstWidth < 96 || desktopTable.tableWidth > desktopTable.contentWidth + 1) {
    throw new Error(`Desktop markdown table layout is invalid: ${JSON.stringify(desktopTable)}`);
  }
  await win.webContents.executeJavaScript('document.querySelector(".message.assistant .message-content table").scrollIntoView({ block: "start" })');
  await new Promise((resolve) => setTimeout(resolve, 80));
  await saveCapture(win, "qa-desktop-markdown-table.png");
  const repairedMarkdown = await win.webContents.executeJavaScript(`(() => {
    const content = document.querySelector(".message.assistant .message-content");
    renderMarkdown(content, [
      "| 字段 | experimental内容 |",
      "| --- | --- 并收 |",
      "| 类别 | A 结构套公开 API。 |",
      "",
      "###冗余（6已） |",
      "| 证据 | 文档 delegate_session.py |",
    ].join("\\n"));
    content.scrollIntoView({ block: "start" });
    return {
      tables: content.querySelectorAll("table").length,
      heading: content.querySelector("h3")?.textContent,
      looseRow: content.querySelector("li")?.textContent,
      preserved: content.textContent.includes("并收"),
      rawHeading: content.textContent.includes("###冗余"),
    };
  })()`);
  if (repairedMarkdown.tables !== 1 || repairedMarkdown.heading !== "冗余（6已）" || !repairedMarkdown.looseRow?.includes("证据") || !repairedMarkdown.preserved || repairedMarkdown.rawHeading) {
    throw new Error(`Malformed markdown repair is invalid: ${JSON.stringify(repairedMarkdown)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 80));
  await saveCapture(win, "qa-desktop-markdown-repair.png");
  const endpointSpecs = [
    { address: "192.168.1.20", kind: "lan", url: "http://192.168.1.20:2420/" },
    { address: "100.88.12.34", kind: "tailscale", url: "http://100.88.12.34:2420/" },
  ];
  const endpoints = await Promise.all(endpointSpecs.map(async (endpoint) => ({
    ...endpoint,
    qrDataUrl: await QRCode.toDataURL(`${endpoint.url}?code=482731`),
  })));
  win.webContents.send("control:info", {
    running: true,
    pairingCode: "482731",
    connectedClients: 0,
    endpoints,
    url: endpoints[0].url,
    qrDataUrl: endpoints[0].qrDataUrl,
  });
  await win.webContents.executeJavaScript(`
    document.querySelector("#background-dialog").close();
    document.querySelector("#remote-dialog").showModal();
    const address = document.querySelector("#remote-address");
    address.value = "http://100.88.12.34:2420/";
    address.dispatchEvent(new Event("change"));
  `);
  await new Promise((resolve) => setTimeout(resolve, 180));
  const remoteImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outputRoot, "qa-desktop-remote.png"), remoteImage.toPNG());
  await win.webContents.executeJavaScript(`document.querySelector("#remote-dialog").close(); document.querySelector("#account-button").click()`);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const officialCliUi = await win.webContents.executeJavaScript(`(async () => {
    document.querySelector("#check-official-cli-update").click();
    await new Promise((resolve) => setTimeout(resolve, 80));
    return {
      open: document.querySelector("#account-dialog").open,
      path: document.querySelector("#official-cli-path").textContent,
      version: document.querySelector("#official-cli-version").textContent,
      updateEnabled: !document.querySelector("#install-official-cli-update").disabled,
    };
  })()`);
  if (!officialCliUi.open || !officialCliUi.path.endsWith("grok.exe") || officialCliUi.version !== "v0.2.101" || !officialCliUi.updateEnabled) {
    throw new Error(`Official CLI UI is invalid: ${JSON.stringify(officialCliUi)}`);
  }
  await saveCapture(win, "qa-desktop-official-cli.png");
  const switchesContained = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#retention-opt-out');
    const track = input.nextElementSibling;
    const thumb = track.querySelector('.switch-thumb');
    return [false, true].every((checked) => {
      input.checked = checked;
      const outer = track.getBoundingClientRect();
      const inner = thumb.getBoundingClientRect();
      return inner.left >= outer.left + 1 && inner.right <= outer.right - 1
        && inner.top >= outer.top + 1 && inner.bottom <= outer.bottom - 1;
    });
  })()`);
  assert.ok(switchesContained, 'settings switches must contain their thumb in both states');
  await saveCapture(win, 'qa-switch-alignment.png');
  await win.webContents.executeJavaScript(`(async () => { document.querySelector('#account-dialog').close(); document.querySelector('#usage-dialog').showModal(); await refreshBilling(); })()`);
  const quotaLoaded = await win.webContents.executeJavaScript(`!document.querySelector('#usage-content').hidden && document.querySelector('#usage-percent').textContent === '36%'`);
  assert.ok(quotaLoaded, 'successful billing responses must display quota');
  await saveCapture(win, 'qa-billing-success.png');
  qaBillingFailure = true;
  await win.webContents.executeJavaScript(`(async () => { await refreshBilling(); })()`);
  const quotaFailure = await win.webContents.executeJavaScript(`!document.querySelector('#usage-error-details').hidden && !document.querySelector('#usage-error-details').open && !document.querySelector('#refresh-usage').disabled`);
  assert.ok(quotaFailure, 'billing failure must allow retry and keep technical details collapsed');
  await saveCapture(win, 'qa-billing-network-error.png');
  qaBillingFailure = false;
  await win.webContents.executeJavaScript(`document.querySelector('#usage-dialog').close()`);
  const settingsUi = await win.webContents.executeJavaScript(`(() => {
    document.querySelector("#account-dialog").close();
    document.querySelector("#settings-button").click();
    return {
      open: document.querySelector("#settings-dialog").open,
      active: document.querySelector("[data-settings-section].active")?.dataset.settingsSection,
      panelVisible: !document.querySelector('[data-settings-panel="grok-build"]').hidden,
    };
  })()`);
  if (!settingsUi.open || settingsUi.active !== "grok-build" || !settingsUi.panelVisible) {
    throw new Error(`Settings center is invalid: ${JSON.stringify(settingsUi)}`);
  }
  await saveCapture(win, "qa-desktop-settings.png");
  const persistedTheme = await win.webContents.executeJavaScript(`localStorage.getItem('grok-desktop.theme')`);
  let themeReloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.webContents.executeJavaScript(`location.reload()`);
  await themeReloaded;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(await win.webContents.executeJavaScript(`document.body.dataset.theme`), persistedTheme, 'theme choice must survive reload');
  themeReloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.webContents.executeJavaScript(`localStorage.setItem('grok-desktop.theme', 'mist'); location.reload()`);
  await themeReloaded;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(await win.webContents.executeJavaScript(`document.body.dataset.theme`), 'light', 'old theme preferences must migrate to light');
  return win;
}

async function captureMobile() {
  const win = new BrowserWindow({ width: 430, height: 850, show: false });
  await win.loadFile(path.join(__dirname, "qa-empty.html"));
  const mobileHtml = fs.readFileSync(path.join(desktopRoot, "src", "mobile", "index.html"), "utf8");
  const mobileQaDocument = createMobileQaDocument(mobileHtml);
  await win.webContents.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(mobileQaDocument)}`);
  await win.webContents.insertCSS(fs.readFileSync(path.join(desktopRoot, "src", "mobile", "styles.css"), "utf8"));
  await win.webContents.insertCSS("* { transition-duration: 0s !important; animation-duration: 0s !important; }");
  const mobileSources = [
    path.join(desktopRoot, "node_modules", "marked", "marked.min.js"),
    path.join(desktopRoot, "node_modules", "dompurify", "dist", "purify.min.js"),
    path.join(desktopRoot, "node_modules", "lucide", "dist", "umd", "lucide.min.js"),
    path.join(desktopRoot, "src", "tool-presentation.js"),
    path.join(desktopRoot, "src", "mobile-layout.js"),
    path.join(desktopRoot, "src", "mobile-session-sync-policy.js"),
    path.join(desktopRoot, "src", "ux-policy.js"),
    path.join(desktopRoot, "src", "markdown-display.js"),
    path.join(desktopRoot, "src", "layout-policy.js"),
    path.join(desktopRoot, "src", "mobile", "app.js"),
  ].map((file) => fs.readFileSync(file, "utf8")).join("\n;\n");
  await win.webContents.executeJavaScript(`
    localStorage.removeItem("grok-remote.token");
    localStorage.removeItem("grok-remote.ipad-panels");
    ${mobileSources}
    document.querySelector("#pair-view").hidden = true;
    document.querySelector("#app-view").hidden = false;
    state.socket = { readyState: WebSocket.OPEN };
    state.runtime = {
      connected: true,
      busy: true,
      status: "ready",
      workspaceName: "grok-build-main",
      sessionId: "qa-current",
      queueLength: 2,
      promptQueue: [
        { id: "qa-queue-1", text: "继续检查格式", attachments: [] },
        { id: "qa-queue-2", text: "最后导出文件", attachments: [{ name: "notes.txt", kind: "text", size: 12 }] },
      ],
      modelState: {
        currentModelId: "openai-gpt-4o",
        models: [{ id: "openai-gpt-4o", name: "GPT-4o" }, { id: "grok-build", name: "grok-build" }],
      },
      modelProviders: [{ id: "openai", name: "OpenAI", modelIds: ["openai-gpt-4o"] }],
      modeState: {
        currentModeId: "default",
        modes: [{ id: "default", name: "默认" }, { id: "plan", name: "计划" }],
      },
      avatars: { user: ${JSON.stringify(avatarDataUrl())}, assistant: ${JSON.stringify(avatarDataUrl())} },
      recoverablePrompt: { id: "qa-mobile-recovery", text: "继续检查恢复逻辑", source: "desktop", attachments: [] },
    };
    renderRuntime();
    renderSessionGroups([
      { id: "qa-current", title: "适配 iPad 三栏布局", cwd: "C:/work/grok-build-main", modelId: "gpt-5.6-sol", updatedAt: Date.now() },
      { id: "qa-2", title: "修复移动端文件上传", cwd: "C:/work/grok-build-main", modelId: "grok-build", updatedAt: Date.now() - 60000 },
      { id: "qa-3", title: "整理个人简历", cwd: "C:/documents/resume", modelId: "gpt-5.6-sol", updatedAt: Date.now() - 120000 },
    ]);
    resetConversation();
    createMessage("user", "帮我检查 iPad 横屏布局，左右栏都要能收起。");
    state.assistant = null;
    state.tools.clear();
    appendAssistant("我先核对会话栏、聊天区和控制栏的可用宽度。");
    updateTool({ toolCallId: "qa-layout", title: "检查响应式布局", status: "completed", content: "三栏宽度正常" });
    appendAssistant("布局检查完成，当前尺寸没有发生遮挡。");
    finalizeAssistantTurn();
    document.querySelector("#mobile-usage").textContent = "SuperGrok · 已用 36% · 7月 30日重置";
    document.querySelector("#mobile-work").innerHTML = '<div class="mobile-resource-row"><div><strong>视觉 QA</strong><span>Electron · 正在运行</span></div><button class="icon-button" title="停止"><i data-lucide="square"></i></button></div>';
    document.querySelector("#prompt").value = "继续检查竖屏抽屉";
    updateControls();
    updateLayoutMode();
    lucide.createIcons();
  `);
  await new Promise((resolve) => setTimeout(resolve, 250));

  const mobileTaskStatus = await win.webContents.executeJavaScript(`(() => {
    handleMessage({ type: "task-status", data: {
      id: "qa-mobile-task", state: "started", source: "mobile", timestamp: Date.now(),
    }});
    const strip = document.querySelector("#mobile-task-status");
    const rect = strip.getBoundingClientRect();
    return {
      visible: !strip.hidden,
      state: strip.dataset.state,
      label: document.querySelector("#mobile-task-status-label").textContent,
      rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height },
      insideViewport: rect.width > 0 && rect.height >= 36 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
    };
  })()`);
  if (!mobileTaskStatus.visible || mobileTaskStatus.state !== "started" || mobileTaskStatus.label !== "任务已开始" || !mobileTaskStatus.insideViewport) {
    throw new Error(`Mobile task status is invalid: ${JSON.stringify(mobileTaskStatus)}`);
  }
  await saveCapture(win, "qa-mobile-task-status.png");
  await win.webContents.executeJavaScript(`renderTaskStatus(null); setTurnProgress(state.assistant, "complete")`);

  assert.equal(await win.webContents.executeJavaScript("typeof GrokMobileLayout"), "object");
  assert.equal(await win.webContents.executeJavaScript("typeof GrokUxPolicy"), "object");
  await verifyBackgroundErrorUi(win, true);
  const mobileUsability = await win.webContents.executeJavaScript(`(async () => {
    const filler = document.createElement("div");
    filler.style.height = "900px";
    document.querySelector("#message-list").append(filler);
    scrollToBottom(true);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const conversation = document.querySelector("#conversation");
    conversation.scrollTop = 0;
    conversation.dispatchEvent(new Event("scroll"));
    scrollToBottom();
    const jumpVisible = !document.querySelector("#mobile-jump-to-latest").hidden;
    const stayedAtTop = conversation.scrollTop < 10;
    filler.remove();
    document.querySelector("#mobile-jump-to-latest").click();
    showError('serialization error: missing field output');
    showPermission({ id: "qa-mobile-permission", toolCall: { title: "删除临时文件", rawInput: "Remove-Item qa.tmp" }, options: [{ id: "allow_once", name: "仅本次允许", kind: "allow_once" }] });
    const permission = {
      risk: document.querySelector("#mobile-permission-risk").textContent,
      target: document.querySelector("#mobile-permission-target").textContent,
      detailsOpen: document.querySelector("#mobile-permission-details").open,
    };
    document.querySelector("#permission-dialog").close();
    state.pendingPermission = null;
    renderRuntime();
    return {
      jumpVisible,
      stayedAtTop,
      permission,
      turnState: document.querySelector(".message.assistant .turn-progress")?.dataset.state,
      recoveryVisible: !document.querySelector("#mobile-recover-prompt").hidden,
      avatarImages: document.querySelectorAll(".message-avatar.has-image").length,
      editButtons: document.querySelectorAll(".message.user .message-edit").length,
    };
  })()`);
  if (!mobileUsability.jumpVisible || !mobileUsability.stayedAtTop || mobileUsability.permission.risk !== "高影响操作" || mobileUsability.permission.detailsOpen || mobileUsability.turnState !== "complete" || !mobileUsability.recoveryVisible || mobileUsability.avatarImages < 2 || mobileUsability.editButtons !== 1) {
    throw new Error(`Mobile usability state is invalid: ${JSON.stringify(mobileUsability)}`);
  }
  let metrics = await mobileGeometry(win);
  assert.equal(metrics.mode, "phone");
  assertMobileGeometry(metrics);
  await verifyMessageAlignment(win);
  await win.webContents.executeJavaScript('document.querySelector(".message.user").scrollIntoView({ block: "start" })');
  await captureMessageAlignment(win, "qa-message-alignment-mobile-v0116.png");
  await saveCapture(win, "qa-mobile-usability.png");
  await saveCapture(win, "qa-mobile-attachments.png");
  const mobileTable = await win.webContents.executeJavaScript(`(() => {
    const content = document.querySelector(".message.assistant .message-content");
    content.innerHTML = "<table><thead><tr><th>供应商</th><th>模型说明</th><th>可用状态</th></tr></thead><tbody><tr><td>OpenAI</td><td>支持长说明与链接，不应挤压标签列。</td><td>可用</td></tr><tr><td>Grok</td><td>中文标签需要保持完整可读。</td><td>可用</td></tr></tbody></table>";
    const table = content.querySelector("table");
    const firstCell = table.querySelector("th");
    return {
      firstWidth: firstCell.getBoundingClientRect().width,
      clientWidth: table.clientWidth,
      scrollWidth: table.scrollWidth,
      overflowX: getComputedStyle(table).overflowX,
    };
  })()`);
  if (mobileTable.firstWidth < 96 || mobileTable.scrollWidth <= mobileTable.clientWidth || mobileTable.overflowX !== "auto") {
    throw new Error(`Mobile markdown table layout is invalid: ${JSON.stringify(mobileTable)}`);
  }
  await win.webContents.executeJavaScript('document.querySelector(".message.assistant .message-content table").scrollIntoView({ block: "start" })');
  await new Promise((resolve) => setTimeout(resolve, 80));
  await saveCapture(win, "qa-mobile-markdown-table.png");

  await resizeContent(win, 320, 700);
  await win.webContents.executeJavaScript("updateLayoutMode()");
  metrics = await mobileGeometry(win);
  assert.equal(metrics.mode, "phone");
  assertMobileGeometry(metrics);
  await verifyMessageAlignment(win);
  await saveCapture(win, "qa-mobile-compact.png");

  await resizeContent(win, 768, 1024);
  await win.webContents.executeJavaScript("updateLayoutMode(); setPanelOpen('left', true, elements.sessionsButton)");
  await new Promise((resolve) => setTimeout(resolve, 220));
  metrics = await mobileGeometry(win);
  assert.equal(metrics.mode, "tablet-portrait");
  assert.equal(metrics.leftOpen, true);
  assert.equal(metrics.rightOpen, false);
  assertMobileGeometry(metrics, { navigationMin: 350 });
  await saveCapture(win, "qa-ipad-portrait-left.png");

  await resizeContent(win, 1024, 768);
  await win.webContents.executeJavaScript("updateLayoutMode()");
  await new Promise((resolve) => setTimeout(resolve, 220));
  metrics = await mobileGeometry(win);
  assert.equal(metrics.mode, "tablet-landscape");
  assert.equal(metrics.leftOpen, true);
  assert.equal(metrics.rightOpen, false);
  assertMobileGeometry(metrics, { landscape: true, navigationMin: 210 });
  await saveCapture(win, "qa-ipad-landscape-default.png");

  await resizeContent(win, 1366, 1024);
  await win.webContents.executeJavaScript("updateLayoutMode(); setPanelOpen('right', true, elements.controlsButton)");
  await new Promise((resolve) => setTimeout(resolve, 220));
  metrics = await mobileGeometry(win);
  assert.equal(metrics.mode, "tablet-landscape");
  assert.equal(metrics.leftOpen, true);
  assert.equal(metrics.rightOpen, true);
  assertMobileGeometry(metrics, { landscape: true, navigationMin: 250, controlsMin: 290 });
  await saveCapture(win, "qa-ipad-pro-three-column.png");
  await resizeContent(win, 390, 844);
  await win.webContents.executeJavaScript(`
    state.runtime.busy = false;
    state.runtime.queueLength = 0;
    state.runtime.promptQueue = [];
    state.runtime.recoverablePrompt = null;
    state.attachments = [];
    state.recoverablePrompt = null;
    state.pendingPlanApproval = null;
    document.querySelector('#prompt').value = '';
    resetConversation();
    renderTaskStatus(null);
    renderRuntime();
    updateLayoutMode();
    lucide.createIcons();
  `);
  assertMobileGeometry(await mobileGeometry(win));
  const phoneControls = await win.webContents.executeJavaScript(`(() => {
    const touchTargets = [...document.querySelectorAll('.header-actions button')].every((button) => {
      const box = button.getBoundingClientRect();
      return box.width >= 44 && box.height >= 44;
    });
    setPanelOpen('right', true, elements.controlsButton);
    const isolated = document.querySelector('.chat-column').inert && !document.querySelector('#controls-panel').inert && document.querySelector('#navigation-panel').inert;
    closeDrawer();
    const restored = !document.querySelector('.chat-column').inert && document.querySelector('#controls-panel').inert;
    return { touchTargets, isolated, restored };
  })()`);
  assert.ok(Object.values(phoneControls).every(Boolean), 'phone drawer focus and touch targets must be usable');
  await saveCapture(win, "qa-redesign-mobile.png");
  await win.webContents.executeJavaScript(`document.querySelector('#app-view').hidden = true; document.querySelector('#pair-view').hidden = false;`);
  await saveCapture(win, "qa-redesign-pairing.png");
  return win;
}

app.whenReady().then(async () => {
  const mobile = await captureMobile();
  const desktop = await captureDesktop();
  mobile.destroy();
  desktop.destroy();
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
