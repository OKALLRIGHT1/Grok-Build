/* global DOMPurify, GrokAttachmentIngest, GrokLayoutPolicy, GrokMarkdownDisplay, GrokReasoningEffort, GrokToolPresentation, GrokUxPolicy, lucide, marked */

const STREAM_RENDER_DELAY = 100;
const TOOL_RENDER_DELAY = 120;

const api = window.grokDesktop;
let connectionAttemptInFlight = false;
const SIDEBAR_COLLAPSED_KEY = "grok-desktop.sidebar-collapsed";
const WORKSPACE_TREE_STATE_KEY = "grok-desktop.workspace-tree-state";
const SIDEBAR_WIDTH_KEY = "grok-desktop.sidebar-width";
const legacyWorkspace = localStorage.getItem("grok-desktop.workspace") || "";
let storedWorkspaces = [];
try {
  const parsed = JSON.parse(localStorage.getItem("grok-desktop.workspaces") || "[]");
  if (Array.isArray(parsed)) storedWorkspaces = parsed.filter((item) => typeof item === "string" && item.trim());
} catch {}
if (legacyWorkspace && !storedWorkspaces.includes(legacyWorkspace)) storedWorkspaces.unshift(legacyWorkspace);

const state = {
  workspace: legacyWorkspace || storedWorkspaces[0] || "",
  workspaces: [...new Set(storedWorkspaces)],
  connected: false,
  cliConnected: false,
  connectionStatus: "idle",
  busy: false,
  assistant: null,
  tools: new Map(),
  authMethods: [],
  diagnostics: "",
  pendingPermission: null,
  pendingTrust: null,
  pendingPlanApproval: null,
  controlInfo: { running: false, connectedClients: 0 },
  remoteSelectedUrl: "",
  workspaceMenuTarget: null,
  background: { custom: false, dataUrl: null, position: "center center", fit: "cover" },
  avatars: { user: null, assistant: null },
  recoverablePrompt: null,
  theme: localStorage.getItem("grok-desktop.theme") || "light",
  modelState: { currentModelId: null, reasoningEffort: null, models: [] },
  effortOptions: [],
  effortSelectionKnown: false,
  modelSettingsBusy: false,
  modeState: { currentModeId: null, modes: [] },
  permissionMode: "ask",
  modelProviders: [],
  modelProviderLabels: {},
  modelConfigDirty: false,
  pendingModelConflict: null,
  modelCheckTarget: null,
  modelCheckMode: "quick",
  replaying: false,
  sessionSearchTimer: null,
  sessionSearchGeneration: 0,
  sessionId: null,
  extensionTab: "mcp",
  hooksTrusted: false,
  workRefreshTimer: null,
  attachments: [],
  lastTurnError: "",
  queueLength: 0,
  promptQueue: [],
  editingQueueId: null,
  scrollScheduled: false,
  autoFollow: true,
  hasUnseenUpdates: false,
  taskStatus: null,
  taskStatusTimer: null,
  officialCli: null,
  officialCliUpdate: null,
  sidebarCollapsed: localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true",
  recentSessionsKey: "",
  recentSessionsTimer: null,
  recentSessions: [],
  recentSessionsError: "",
  recentSessionsLoading: false,
  recentSessionsGeneration: 0,
  drafts: new Map(),
  workspaceTreeState: loadWorkspaceTreeState(),
  expandedSessionLists: new Set(),
  sidebarWidth: loadSidebarWidth(),
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  conversation: $("#conversation"),
  emptyState: $("#empty-state"),
  messageList: $("#message-list"),
  composer: $("#composer"),
  input: $("#prompt-input"),
  send: $("#send-button"),
  stop: $("#stop-button"),
  interruptSend: $("#interrupt-send-button"),
  promptQueue: $("#prompt-queue"),
  promptQueueList: $("#prompt-queue-list"),
  recoverPrompt: $("#recover-prompt"),
  recoverPromptLabel: $("#recover-prompt-label"),
  restorePrompt: $("#restore-prompt"),
  dismissRecoveredPrompt: $("#dismiss-recovered-prompt"),
  planApprovalBanner: $("#plan-approval-banner"),
  reopenPlanApproval: $("#reopen-plan-approval"),
  taskStatus: $("#task-status"),
  taskStatusIcon: $("#task-status-icon"),
  taskStatusLabel: $("#task-status-label"),
  newSession: $("#new-session"),
  sidebarToggle: $("#sidebar-toggle"),
  sidebarResizeHandle: $("#sidebar-resize-handle"),
  sidebarMore: $("#sidebar-more"),
  sidebarSearch: $("#sessions-button"),
  workspaceTree: $("#workspace-tree"),
  workspaceMenu: $("#workspace-menu"),
  workspaceMenuRemove: $("#workspace-menu-remove"),
  workspaceButton: $("#workspace-button"),
  workspaceList: $("#workspace-list"),
  workspaceListEmpty: $("#workspace-list-empty"),
  recentSessionsList: $("#recent-sessions-list"),
  recentSessionsEmpty: $("#recent-sessions-empty"),
  emptyWorkspaceButton: $("#empty-workspace-button"),
  composerContext: $("#composer-context"),
  composerSubmitMode: $("#composer-submit-mode"),
  cancelQueueEdit: $("#cancel-queue-edit"),
  jumpToLatest: $("#jump-to-latest"),
  startupHealth: $("#startup-health"),
  attachmentButton: $("#attachment-button"),
  attachmentInput: $("#attachment-input"),
  attachmentList: $("#attachment-list"),
  statusDot: $("#status-dot"),
  statusLabel: $("#status-label"),
  backendLabel: $("#backend-label"),
  title: $("#conversation-title"),
  running: $("#running-indicator"),
  login: $("#login-button"),
  diagnosticPanel: $("#diagnostic-panel"),
  diagnosticText: $("#diagnostic-text"),
  permissionDialog: $("#permission-dialog"),
  permissionDescription: $("#permission-description"),
  permissionCommand: $("#permission-command"),
  permissionDetails: $("#permission-details"),
  permissionRisk: $("#permission-risk"),
  permissionTarget: $("#permission-target"),
  permissionOptions: $("#permission-options"),
  trustDialog: $("#trust-dialog"),
  trustDescription: $("#trust-description"),
  trustKinds: $("#trust-kinds"),
  planApprovalDialog: $("#plan-approval-dialog"),
  planApprovalSession: $("#plan-approval-session"),
  planApprovalContent: $("#plan-approval-content"),
  planApprovalFeedback: $("#plan-approval-feedback"),
  planApprovalStatus: $("#plan-approval-status"),
  approvePlan: $("#approve-plan"),
  revisePlan: $("#revise-plan"),
  abandonPlan: $("#abandon-plan"),
  deferPlan: $("#defer-plan"),
  authDialog: $("#auth-dialog"),
  authMethod: $("#auth-method"),
  authDescription: $("#auth-description"),
  remoteToggle: $("#remote-toggle"),
  remoteStatus: $("#remote-status"),
  remoteDialog: $("#remote-dialog"),
  remoteQr: $("#remote-qr"),
  remoteCode: $("#remote-code"),
  remoteAddress: $("#remote-address"),
  remoteUrl: $("#remote-url"),
  remoteClientCount: $("#remote-client-count"),
  backgroundDialog: $("#background-dialog"),
  backgroundStatus: $("#background-status"),
  backgroundPreview: $("#choose-background"),
  sessionControls: $("#session-controls"),
  modelSelector: $("#model-selector"),
  modelSettingsButton: $("#model-settings-button"),
  modelSettingsPopover: $("#model-settings-popover"),
  composerModelLabel: $("#composer-model-label"),
  effortValue: $("#effort-value"),
  effortTicks: $("#effort-ticks"),
  effortControl: $("#effort-control"),
  effortSelector: $("#effort-selector"),
  modeControl: $("#mode-control"),
  modeSelector: $("#mode-selector"),
  sessionsDialog: $("#sessions-dialog"),
  sessionSearch: $("#session-search"),
  sessionsState: $("#sessions-state"),
  sessionsList: $("#sessions-list"),
  usageDialog: $("#usage-dialog"),
  usageContent: $("#usage-content"),
  usageState: $("#usage-state"),
  usageTier: $("#usage-tier"),
  modelsDialog: $("#models-dialog"),
  modelCheckDialog: $("#model-check-dialog"),
  modelCheckTarget: $("#model-check-target"),
  modelCheckCreditWarning: $("#model-check-credit-warning"),
  modelCheckResult: $("#model-check-result"),
  runModelCheckButton: $("#run-model-check"),
  modelConflictDialog: $("#model-conflict-dialog"),
  modelConflictDescription: $("#model-conflict-description"),
  applyModelConfig: $("#apply-model-config"),
  modelConfigState: $("#model-config-state"),
  providerList: $("#provider-list"),
  providerEmpty: $("#provider-empty"),
  providerForm: $("#provider-form"),
  providerId: $("#provider-id"),
  providerName: $("#provider-name"),
  providerBackend: $("#provider-backend"),
  providerBaseUrl: $("#provider-base-url"),
  providerApiKey: $("#provider-api-key"),
  providerClearKey: $("#provider-clear-key"),
  providerClearKeyRow: $("#provider-clear-key-row"),
  providerModelForm: $("#provider-model-form"),
  modelProviderId: $("#model-provider-id"),
  modelOriginalId: $("#model-original-id"),
  providerModelId: $("#provider-model-id"),
  providerModelName: $("#provider-model-name"),
  providerModelValue: $("#provider-model-value"),
  providerModelBackend: $("#provider-model-backend"),
  providerModelContext: $("#provider-model-context"),
  providerModelMaxOutput: $("#provider-model-max-output"),
  providerModelTemperature: $("#provider-model-temperature"),
  providerModelTopP: $("#provider-model-top-p"),
  permissionModeSelector: $("#permission-mode-selector"),
  sessionToolsDialog: $("#session-tools-dialog"),
  rewindState: $("#rewind-state"),
  rewindList: $("#rewind-list"),
  extensionsDialog: $("#extensions-dialog"),
  mcpState: $("#mcp-state"),
  mcpList: $("#mcp-list"),
  skillsState: $("#skills-state"),
  skillsList: $("#skills-list"),
  pluginsState: $("#plugins-state"),
  pluginsList: $("#plugins-list"),
  marketplaceState: $("#marketplace-state"),
  marketplaceList: $("#marketplace-list"),
  hooksState: $("#hooks-state"),
  hooksList: $("#hooks-list"),
  workDialog: $("#work-dialog"),
  workState: $("#work-state"),
  workList: $("#work-list"),
  accountDialog: $("#account-dialog"),
  accountEmail: $("#account-email"),
  accountTeam: $("#account-team"),
  retentionOptOut: $("#retention-opt-out"),
  promptHistoryState: $("#prompt-history-state"),
  promptHistoryList: $("#prompt-history-list"),
  projectRules: $("#project-rules"),
  settingsDialog: $("#settings-dialog"),
  officialCliStatus: $("#official-cli-status"),
  officialCliPath: $("#official-cli-path"),
  officialCliVersion: $("#official-cli-version"),
  officialCliUpdateState: $("#official-cli-update-state"),
  chooseOfficialCli: $("#choose-official-cli"),
  testOfficialCli: $("#test-official-cli"),
  checkOfficialCliUpdate: $("#check-official-cli-update"),
  installOfficialCliUpdate: $("#install-official-cli-update"),
  officialCliUpdateDialog: $("#official-cli-update-dialog"),
  officialCliUpdateDescription: $("#official-cli-update-description"),
};

marked.setOptions({ breaks: true, gfm: true });
lucide.createIcons();

function basename(filePath) {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) || filePath;
}

function workspaceKey(filePath) {
  const value = String(filePath || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(value) || value.startsWith("//") ? value.toLowerCase() : value;
}

function parentPath(filePath) {
  const parts = filePath.split(/[\\/]/).filter(Boolean);
  parts.pop();
  const prefix = /^[A-Za-z]:/.test(filePath) ? "" : filePath.startsWith("/") ? "/" : "";
  return `${prefix}${parts.join("\\")}` || filePath;
}

function loadWorkspaceTreeState() {
  try {
    const value = JSON.parse(localStorage.getItem(WORKSPACE_TREE_STATE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function loadSidebarWidth() {
  const width = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(width) ? Math.min(440, Math.max(280, width)) : 320;
}

function saveWorkspaceTreeState() {
  localStorage.setItem(WORKSPACE_TREE_STATE_KEY, JSON.stringify(state.workspaceTreeState));
}

function setSidebarWidth(width) {
  state.sidebarWidth = Math.min(440, Math.max(280, Number(width) || 320));
  document.documentElement.style.setProperty("--sidebar-width", `${state.sidebarWidth}px`);
  localStorage.setItem(SIDEBAR_WIDTH_KEY, String(state.sidebarWidth));
}

function persistWorkspaces() {
  state.workspaces = [...new Set(state.workspaces.filter(Boolean))];
  localStorage.setItem("grok-desktop.workspaces", JSON.stringify(state.workspaces));
  if (state.workspace) localStorage.setItem("grok-desktop.workspace", state.workspace);
  else localStorage.removeItem("grok-desktop.workspace");
}

function rememberWorkspace(workspace) {
  if (!workspace) return;
  if (!state.workspaces.includes(workspace)) state.workspaces.push(workspace);
  persistWorkspaces();
}

function renderWorkspaces() {
  renderWorkspaceTree();
}

function toggleWorkspaceTreeNode(workspace) {
  const expanded = state.workspaceTreeState[workspace] ?? true;
  state.workspaceTreeState[workspace] = !expanded;
  saveWorkspaceTreeState();
  renderWorkspaceTree();
}

function renderWorkspaceTree() {
  elements.workspaceList.replaceChildren();
  const sessionsByWorkspace = new Map();
  for (const session of state.recentSessions) {
    const workspace = String(session.cwd || "").trim();
    if (!workspace) continue;
    const key = workspaceKey(workspace);
    if (!sessionsByWorkspace.has(key)) sessionsByWorkspace.set(key, []);
    sessionsByWorkspace.get(key).push(session);
  }
  const projectPaths = new Map();
  for (const cwd of [...state.workspaces, ...state.recentSessions.map((session) => session.cwd).filter(Boolean)]) {
    if (!projectPaths.has(workspaceKey(cwd))) projectPaths.set(workspaceKey(cwd), cwd);
  }
  const workspaces = [...projectPaths.values()];
  elements.workspaceListEmpty.hidden = Boolean(workspaces.length);
  workspaces.forEach((workspace) => {
    const node = document.createElement("section");
    node.className = "workspace-tree-node";
    node.dataset.workspace = workspace;
    const row = document.createElement("div");
    row.className = `workspace-entry${workspaceKey(workspace) === workspaceKey(state.workspace) ? " active" : ""}`;

    const expanded = state.workspaceTreeState[workspace] ?? true;
    const toggle = document.createElement("button");
    toggle.className = "workspace-tree-toggle";
    toggle.type = "button";
    toggle.title = expanded ? "收起工作区" : "展开工作区";
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-expanded", String(expanded));
    const listId = `workspace-sessions-${workspaces.indexOf(workspace)}`;
    toggle.setAttribute("aria-controls", listId);
    toggle.innerHTML = `<i data-lucide="${expanded ? "chevron-down" : "chevron-right"}"></i>`;
    toggle.addEventListener("click", () => toggleWorkspaceTreeNode(workspace));

    const select = document.createElement("button");
    select.className = "workspace-select";
    select.type = "button";
    select.title = workspace;
    select.disabled = state.busy || connectionAttemptInFlight;
    select.innerHTML = '<i data-lucide="folder"></i>';
    const copy = document.createElement("span");
    copy.className = "workspace-copy";
    const name = document.createElement("strong");
    name.textContent = basename(workspace);
    const parent = document.createElement("span");
    parent.textContent = parentPath(workspace);
    copy.append(name, parent);
    select.append(copy);
    select.addEventListener("click", () => activateWorkspace(workspace));

    const actions = document.createElement("div");
    actions.className = "workspace-actions";
    const more = document.createElement("button");
    more.className = "workspace-more";
    more.type = "button";
    more.title = `项目选项 · ${basename(workspace)}`;
    more.setAttribute("aria-label", more.title);
    more.disabled = state.busy || connectionAttemptInFlight;
    more.popoverTargetElement = elements.workspaceMenu;
    more.innerHTML = '<i data-lucide="ellipsis"></i>';
    more.addEventListener("click", () => prepareWorkspaceMenu(workspace, more.getBoundingClientRect()));
    const create = document.createElement("button");
    create.className = "workspace-new-session";
    create.type = "button";
    create.title = `新建对话 · ${basename(workspace)}`;
    create.setAttribute("aria-label", create.title);
    create.disabled = !state.cliConnected || state.busy || connectionAttemptInFlight;
    create.innerHTML = '<i data-lucide="plus"></i>';
    create.addEventListener("click", () => newWorkspaceConversation(workspace));
    actions.append(more, create);
    row.append(toggle, select, actions);
    row.addEventListener("contextmenu", (event) => {
      if (state.busy || connectionAttemptInFlight) return;
      event.preventDefault();
      prepareWorkspaceMenu(workspace, { right: event.clientX + 200, bottom: event.clientY });
      elements.workspaceMenu.showPopover();
      elements.workspaceMenuRemove.focus();
    });
    node.append(row);

    const sessionList = document.createElement("div");
    sessionList.className = "workspace-session-list";
    sessionList.id = listId;
    sessionList.hidden = !expanded;
    const sessions = sessionsByWorkspace.get(workspaceKey(workspace)) || [];
    const showAll = state.expandedSessionLists.has(workspace);
    const visibleSessions = showAll ? sessions : sessions.slice(0, 5);
    // Keep the current conversation visible even when it is outside the first five.
    const activeSession = sessions.find((session) => session.id === state.sessionId);
    if (!showAll && activeSession && !visibleSessions.includes(activeSession)) visibleSessions[visibleSessions.length - 1] = activeSession;
    visibleSessions.forEach((session) => {
      const sessionButton = document.createElement("button");
      sessionButton.className = `workspace-session${session.id === state.sessionId ? " active" : ""}`;
      sessionButton.type = "button";
      sessionButton.title = `${session.title || "未命名对话"}${session.cwd ? `\n${session.cwd}` : ""}`;
      sessionButton.disabled = state.busy || connectionAttemptInFlight || session.id === state.sessionId;
      if (session.id === state.sessionId) sessionButton.setAttribute("aria-current", "page");
      sessionButton.innerHTML = '<i data-lucide="message-square-text"></i>';
      const copy = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = session.title || "未命名对话";
      const meta = document.createElement("small");
      meta.textContent = [session.updatedAt ? formatDate(session.updatedAt) : "", session.modelId || ""].filter(Boolean).join(" · ");
      copy.append(title, meta);
      sessionButton.append(copy);
      sessionButton.addEventListener("click", () => loadRecentSession(session, sessionButton));
      sessionList.append(sessionButton);
    });
    if (!sessions.length) {
      const empty = document.createElement("p");
      empty.className = "workspace-session-empty";
      empty.textContent = state.recentSessionsLoading ? "正在读取对话…" : state.recentSessionsError ? "对话读取失败，点击重试" : "还没有对话";
      if (state.recentSessionsError) {
        empty.setAttribute("role", "button");
        empty.tabIndex = 0;
        empty.addEventListener("click", refreshRecentSessions);
        empty.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); refreshRecentSessions(); }
        });
      }
      sessionList.append(empty);
    }
    if (sessions.length > 5) {
      const more = document.createElement("button");
      more.className = "workspace-show-more";
      more.type = "button";
      more.textContent = showAll ? "收起" : `展开更多 · ${sessions.length - 5}`;
      more.setAttribute("aria-expanded", String(showAll));
      more.setAttribute("aria-label", `${showAll ? "收起" : "展开"}${basename(workspace)}的更多对话`);
      more.addEventListener("click", () => {
        if (showAll) state.expandedSessionLists.delete(workspace);
        else state.expandedSessionLists.add(workspace);
        const scrollTop = elements.workspaceTree.scrollTop;
        renderWorkspaceTree();
        elements.workspaceTree.scrollTop = scrollTop;
        const buttons = [...elements.workspaceList.querySelectorAll(".workspace-show-more")];
        buttons.find((button) => button.closest(".workspace-tree-node").dataset.workspace === workspace)?.focus({ preventScroll: true });
      });
      sessionList.append(more);
    }
    node.append(sessionList);
    elements.workspaceList.append(node);
  });
  lucide.createIcons({ nodes: [elements.workspaceList] });
}

function setSidebarCollapsed(collapsed) {
  state.sidebarCollapsed = Boolean(collapsed);
  document.documentElement.dataset.sidebarCollapsed = String(!window.matchMedia("(max-width: 920px)").matches && state.sidebarCollapsed);
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(state.sidebarCollapsed));
  elements.sidebarToggle.title = state.sidebarCollapsed ? "展开侧栏" : "收起侧栏";
  elements.sidebarToggle.setAttribute("aria-expanded", state.sidebarCollapsed ? "false" : "true");
  elements.sidebarToggle.innerHTML = `<i data-lucide="${state.sidebarCollapsed ? "panel-left-open" : "panel-left-close"}"></i>`;
  if (state.sidebarCollapsed) {
    elements.sidebarMore.hidePopover();
    elements.workspaceMenu.hidePopover();
  }
  $("#rail-projects").setAttribute("aria-expanded", String(!state.sidebarCollapsed));
  lucide.createIcons({ nodes: [elements.sidebarToggle] });
}

function bindSidebarResize() {
  let startX = 0;
  let startWidth = 0;
  const stop = () => {
    elements.sidebarResizeHandle.classList.remove("is-resizing");
    window.removeEventListener("pointermove", resize);
    window.removeEventListener("pointerup", stop);
  };
  const resize = (event) => setSidebarWidth(startWidth + event.clientX - startX);
  elements.sidebarResizeHandle.addEventListener("pointerdown", (event) => {
    if (state.sidebarCollapsed || event.button !== 0) return;
    startX = event.clientX;
    startWidth = state.sidebarWidth;
    elements.sidebarResizeHandle.classList.add("is-resizing");
    window.addEventListener("pointermove", resize);
    window.addEventListener("pointerup", stop, { once: true });
    event.preventDefault();
  });
}

function setWorkspaceLabels() {
  elements.composerContext.textContent = state.workspace || "未选择工作区";
  renderWorkspaces();
  renderStartupHealth();
}

function setStatus(status, details) {
  state.connectionStatus = status;
  elements.statusDot.className = `status-dot ${status}`;
  const labels = {
    idle: "CLI 未连接",
    connecting: "正在连接 CLI",
    "cli-ready": "CLI 已连接",
    switching: "正在打开项目",
    "auth-required": "等待登录",
    ready: "CLI 已连接",
    disconnected: "已断开",
    error: "连接失败",
  };
  elements.statusLabel.textContent = labels[status] || status;
  if (details) elements.backendLabel.textContent = details;
  renderStartupHealth();
}

function renderOfficialCli() {
  const cli = state.officialCli;
  const available = Boolean(cli?.available);
  elements.officialCliStatus.textContent = available ? "官方 CLI 已就绪" : (cli?.error || "未检测到官方 Grok Build");
  elements.officialCliPath.textContent = available ? cli.executablePath : "未选择";
  elements.officialCliPath.title = available ? cli.executablePath : "";
  elements.officialCliVersion.textContent = available ? `v${cli.version}` : "--";
  elements.testOfficialCli.disabled = !available;
  elements.checkOfficialCliUpdate.disabled = !available;
  const update = state.officialCliUpdate;
  if (!update) {
    elements.officialCliUpdateState.textContent = available ? "可手动检查官方 CLI 更新。" : "请先安装并选择官方 Grok Build CLI。";
  } else if (update.error) {
    elements.officialCliUpdateState.textContent = `更新检查失败：${update.error}`;
  } else if (update.updateAvailable) {
    elements.officialCliUpdateState.textContent = `可更新：${update.currentVersion || "当前版本"} -> ${update.latestVersion || "最新版本"}`;
  } else {
    elements.officialCliUpdateState.textContent = `已是最新版本${update.currentVersion ? `：${update.currentVersion}` : ""}`;
  }
  elements.installOfficialCliUpdate.disabled = !update?.updateAvailable;
}

function openSettings(section = "grok-build") {
  document.querySelectorAll("[data-settings-section]").forEach((button) => {
    button.classList.toggle("active", button.dataset.settingsSection === section);
  });
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.settingsPanel !== section;
  });
  if (!elements.settingsDialog.open) elements.settingsDialog.showModal();
}

async function refreshOfficialCli() {
  const response = await api.getOfficialCli();
  state.officialCli = response.ok ? response.data : { available: false, error: responseError(response) };
  state.officialCliUpdate = null;
  renderOfficialCli();
}

function updateControls() {
  const modelSettingsDisabled = !state.connected || state.busy || state.modelSettingsBusy;
  elements.modelSettingsButton.disabled = !state.connected || !elements.modelSelector.options.length;
  elements.modelSelector.disabled = modelSettingsDisabled || !elements.modelSelector.options.length;
  elements.effortSelector.disabled = modelSettingsDisabled || state.effortOptions.length < 2;
  elements.modeSelector.disabled = modelSettingsDisabled;
  if (!state.connected) elements.modelSettingsPopover.hidePopover();
  document.documentElement.dataset.connectionReady = String(state.connected);
  const hasContent = Boolean(elements.input.value.trim() || state.attachments.length);
  const composer = GrokUxPolicy.describeComposer({
    connected: state.connected,
    busy: state.busy,
    editing: Boolean(state.editingQueueId),
    hasContent,
  });
  elements.input.disabled = !state.connected;
  document.querySelectorAll("[data-prompt]").forEach((button) => { button.disabled = !state.connected; });
  elements.send.disabled = composer.disabled;
  elements.send.dataset.mode = composer.mode;
  elements.send.title = composer.sendLabel;
  elements.send.setAttribute("aria-label", composer.sendLabel);
  elements.composerSubmitMode.textContent = !state.connected && state.cliConnected
    ? (state.workspace ? "正在准备会话" : "先选择项目")
    : composer.hint;
  elements.composerSubmitMode.dataset.mode = composer.mode;
  elements.cancelQueueEdit.hidden = !state.editingQueueId;
  elements.attachmentButton.disabled = !state.connected || Boolean(state.editingQueueId);
  elements.stop.hidden = !state.busy;
  elements.interruptSend.hidden = !state.busy || (!elements.input.value.trim() && !state.attachments.length);
  elements.interruptSend.disabled = !state.connected || (!elements.input.value.trim() && !state.attachments.length);
  elements.interruptSend.title = "打断并发送";
  elements.interruptSend.setAttribute("aria-label", "打断并发送");
  elements.running.hidden = !state.busy && !state.pendingPermission;
  elements.running.textContent = state.pendingPermission
    ? "等待你确认"
    : state.queueLength ? `处理中 · ${state.queueLength} 条待执行` : "处理中";
  elements.newSession.disabled = !state.cliConnected || state.busy || connectionAttemptInFlight;
  $("#rail-work-status").hidden = !state.busy && !state.queueLength;
  elements.composerContext.textContent = state.editingQueueId ? "正在编辑待执行指令" : (state.workspace || "未选择工作区");
  elements.composerContext.title = state.workspace || "未选择工作区";
  elements.input.placeholder = !state.connected
    ? (state.cliConnected ? (state.workspace ? "正在准备项目会话…" : "选择项目后开始任务") : "正在等待 CLI 连接…")
    : state.busy
      ? "输入下一步指令，将按顺序执行"
      : "描述你要完成的任务";
  elements.sessionControls.hidden = !state.connected;
  $("#sessions-button").disabled = !state.cliConnected;
  $("#usage-button").disabled = !state.cliConnected;
  $("#extensions-button").disabled = !state.connected || !state.sessionId;
  $("#work-button").disabled = !state.connected || !state.sessionId;
  $("#account-button").disabled = false;
  $("#session-tools-button").disabled = !state.connected || !state.sessionId;
  elements.workspaceButton.disabled = state.busy || connectionAttemptInFlight;
  elements.emptyWorkspaceButton.disabled = state.busy || connectionAttemptInFlight;
  elements.workspaceList.querySelectorAll("button").forEach((button) => {
    button.disabled = state.busy || connectionAttemptInFlight || button.getAttribute("aria-current") === "page"
      || (button.matches(".workspace-new-session") && !state.cliConnected);
  });
  elements.workspaceMenuRemove.disabled = state.busy || connectionAttemptInFlight;
  document.querySelectorAll("[data-sidebar-action]").forEach((button) => {
    button.disabled = $("#" + button.dataset.sidebarAction).disabled;
  });
}

function renderStartupHealth() {
  if (!elements.startupHealth) return;
  const rows = GrokUxPolicy.describeHealth({
    connected: state.connected,
    cliConnected: state.cliConnected,
    status: state.connectionStatus,
    workspaceName: state.workspace,
    modelState: state.modelState,
  });
  elements.startupHealth.replaceChildren();
  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = `health-row ${row.state}`;
    const dot = document.createElement("span");
    dot.className = "health-dot";
    const label = document.createElement("strong");
    label.textContent = row.label;
    const detail = document.createElement("span");
    detail.textContent = row.detail;
    item.append(dot, label, detail);
    elements.startupHealth.append(item);
  });
}

function modelEffortOptions(model) {
  return GrokReasoningEffort.optionsForModel(model);
}

function renderModelState(modelState) {
  state.modelState = { ...state.modelState, ...modelState };
  const models = state.modelState.models || [];
  elements.modelSelector.replaceChildren();
  if (!models.length && state.modelState.currentModelId) {
    const option = document.createElement("option");
    option.value = state.modelState.currentModelId;
    option.textContent = state.modelState.currentModelId;
    elements.modelSelector.append(option);
  }
  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    const provider = state.modelProviderLabels[model.id] || "Grok";
    option.textContent = `${model.name || model.id} · ${provider}`;
    option.title = model.description || model.id;
    elements.modelSelector.append(option);
  });
  if (state.modelState.currentModelId) elements.modelSelector.value = state.modelState.currentModelId;
  elements.modelSelector.disabled = !state.connected || state.busy || !models.length;

  const current = models.find((model) => model.id === state.modelState.currentModelId);
  const efforts = modelEffortOptions(current);
  state.effortOptions = efforts;
  elements.effortSelector.max = String(Math.max(0, efforts.length - 1));
  elements.effortTicks.replaceChildren(...efforts.map(() => document.createElement("span")));
  elements.effortControl.hidden = !efforts.length;
  const selected = GrokReasoningEffort.selectedIndex(efforts, state.modelState.reasoningEffort, current);
  state.effortSelectionKnown = selected >= 0;
  elements.effortSelector.value = String(Math.max(0, selected));
  $("#effort-min-label").textContent = efforts[0]?.label || "";
  $("#effort-max-label").textContent = efforts.at(-1)?.label || "";
  renderEffortPreview();
  updateControls();
  renderStartupHealth();
}

function renderEffortPreview() {
  const index = Number(elements.effortSelector.value);
  const effort = state.effortSelectionKnown ? state.effortOptions[index] : null;
  const current = state.modelState.models?.find((model) => model.id === state.modelState.currentModelId);
  const name = current?.name || state.modelState.currentModelId || "选择模型";
  const highest = GrokReasoningEffort.isHighest(state.effortOptions, effort);
  const percent = effort && state.effortOptions.length > 1 ? index / (state.effortOptions.length - 1) * 100 : 0;
  const effortLabel = effort?.label || (state.effortOptions.length ? state.modelState.reasoningEffort || "模型默认" : "");
  elements.effortValue.textContent = effortLabel;
  elements.effortSelector.setAttribute("aria-valuetext", effortLabel || "当前模型不支持调整推理强度");
  elements.modelSettingsPopover.style.setProperty("--effort-fill", `${percent}%`);
  elements.modelSettingsPopover.dataset.maxEffort = String(highest);
  elements.modelSettingsButton.dataset.maxEffort = String(highest);
  const visualLevel = GrokReasoningEffort.visualLevel(effort);
  elements.modelSettingsPopover.dataset.effortLevel = visualLevel;
  elements.modelSettingsButton.dataset.effortLevel = visualLevel;
  elements.composerModelLabel.textContent = effortLabel ? `${name} · ${effortLabel}` : name;
  elements.modelSettingsButton.setAttribute("aria-label", `模型与推理强度：${elements.composerModelLabel.textContent}${highest ? "，最高强度" : ""}`);
  const bars = elements.modelSettingsButton.querySelector(".effort-mini-bars");
  bars.hidden = !effort;
  bars.querySelectorAll("i").forEach((bar, position) => {
    bar.classList.toggle("filled", position <= Math.round(percent / 100 * 3));
  });
}

function positionModelSettings() {
  const rect = elements.modelSettingsButton.getBoundingClientRect();
  const width = Math.min(288, innerWidth - 24);
  const below = rect.top < 200;
  elements.modelSettingsPopover.style.left = `${Math.max(12, Math.min(rect.right - width, innerWidth - width - 12))}px`;
  elements.modelSettingsPopover.style.top = below ? `${rect.bottom + 8}px` : "auto";
  elements.modelSettingsPopover.style.bottom = below ? "auto" : `${innerHeight - rect.top + 8}px`;
  elements.modelSettingsPopover.style.maxHeight = `${Math.max(120, below ? innerHeight - rect.bottom - 20 : rect.top - 20)}px`;
}

function renderModeState(modeState) {
  state.modeState = { ...state.modeState, ...modeState };
  elements.modeSelector.replaceChildren();
  (state.modeState.modes || []).forEach((mode) => {
    const option = document.createElement("option");
    option.value = mode.id;
    option.textContent = mode.name || mode.id;
    option.title = mode.description || "";
    elements.modeSelector.append(option);
  });
  elements.modeControl.hidden = !state.modeState.modes?.length;
  if (state.modeState.currentModeId) elements.modeSelector.value = state.modeState.currentModeId;
}

function renderPermissionMode(mode) {
  state.permissionMode = mode || "ask";
  elements.permissionModeSelector.value = state.permissionMode;
}

function applyConnectionData(data) {
  if (!data) return;
  if (typeof data.connected === "boolean") state.connected = data.connected;
  if (typeof data.cliConnected === "boolean") state.cliConnected = data.cliConnected;
  if (Object.hasOwn(data, "sessionId")) state.sessionId = data.sessionId;
  if (data.authMethods) {
    state.authMethods = data.authMethods.filter((method) => method.id);
    elements.login.hidden = !state.authMethods.some((method) => ["grok.com", "oidc"].includes(method.id));
  }
  if (data.backend) elements.backendLabel.textContent = basename(data.backend);
  if (data.modelState) renderModelState(data.modelState);
  if (data.modeState) renderModeState(data.modeState);
  if (data.permissionMode) renderPermissionMode(data.permissionMode);
}

function renderLatestState() {
  elements.jumpToLatest.hidden = state.autoFollow || !state.hasUnseenUpdates;
}

function resetConversationFollow() {
  state.autoFollow = true;
  state.hasUnseenUpdates = false;
  renderLatestState();
}

function scrollToBottom(force = false) {
  if (!force && !state.autoFollow) {
    state.hasUnseenUpdates = true;
    renderLatestState();
    return;
  }
  if (state.scrollScheduled) return;
  state.scrollScheduled = true;
  requestAnimationFrame(() => {
    state.scrollScheduled = false;
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
    state.autoFollow = true;
    state.hasUnseenUpdates = false;
    renderLatestState();
  });
}

function settleConversationAtBottom() {
  resetConversationFollow();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => scrollToBottom(true));
  });
  elements.messageList.querySelectorAll("img").forEach((image) => {
    if (!image.complete) image.addEventListener("load", () => scrollToBottom(true), { once: true });
  });
}

function showMessages() {
  elements.emptyState.hidden = true;
}

function updateConversationLayout() {
  const layout = GrokLayoutPolicy.conversationLayout({
    messageCount: elements.messageList.children.length,
    busy: state.busy || state.taskStatus?.state === "started",
    queueLength: state.queueLength,
  });
  document.documentElement.dataset.conversationLayout = layout;
}

function renderMarkdown(container, text) {
  const normalized = GrokMarkdownDisplay.normalizeMarkdown(text || "");
  container.innerHTML = DOMPurify.sanitize(marked.parse(normalized), { USE_PROFILES: { html: true } });
  container.querySelectorAll("a[href]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      api.openExternal(link.href);
    });
  });
}

const TEXT_FILE_EXTENSIONS = new Set([
  "txt", "md", "json", "jsonl", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "html", "xml",
  "yaml", "yml", "toml", "ini", "csv", "log", "py", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp",
  "cs", "php", "rb", "sh", "ps1", "sql", "vue", "svelte",
]);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isTextFile(file) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  return file.type.startsWith("text/") || TEXT_FILE_EXTENSIONS.has(extension);
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`无法读取 ${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function serializeAttachment(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} 超过 5 MB`);
  const mimeType = file.type || "application/octet-stream";
  if (isTextFile(file)) {
    if (file.size > 1024 * 1024) throw new Error(`${file.name} 是文本文件，不能超过 1 MB`);
    return { name: file.name, mimeType, size: file.size, kind: "text", content: await file.text() };
  }
  const dataUrl = await fileAsDataUrl(file);
  const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { name: file.name, mimeType, size: file.size, kind: mimeType.startsWith("image/") ? "image" : "file", data };
}

function renderAttachmentChips(container, attachments, removable = false) {
  container.replaceChildren();
  attachments.forEach((attachment, index) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    if (attachment.kind === "image" && attachment.data) {
      const preview = document.createElement("img");
      preview.src = `data:${attachment.mimeType};base64,${attachment.data}`;
      preview.alt = "";
      chip.append(preview);
    } else {
      chip.innerHTML = `<i data-lucide="${attachment.kind === "image" ? "image" : "file"}"></i>`;
    }
    const label = document.createElement("span");
    label.textContent = `${attachment.name} · ${formatBytes(attachment.size || 0)}`;
    label.title = attachment.name;
    chip.append(label);
    if (removable) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.title = "移除附件";
      remove.innerHTML = '<i data-lucide="x"></i>';
      remove.addEventListener("click", () => {
        state.attachments.splice(index, 1);
        renderAttachments();
      });
      chip.append(remove);
    }
    container.append(chip);
  });
  container.hidden = !attachments.length;
  lucide.createIcons({ nodes: [container] });
}

function renderAttachments() {
  renderAttachmentChips(elements.attachmentList, state.attachments, true);
  updateControls();
}

function applyAvatarElement(element, role) {
  const dataUrl = state.avatars[role];
  element.dataset.role = role;
  element.classList.toggle("has-image", Boolean(dataUrl));
  element.style.backgroundImage = dataUrl ? `url(${JSON.stringify(dataUrl)})` : "";
  element.textContent = dataUrl ? "" : role === "user" ? "你" : "G";
}

function applyAvatars(avatars = {}) {
  state.avatars = { ...state.avatars, ...avatars };
  document.querySelectorAll(".message-avatar, .avatar-preview").forEach((element) => {
    applyAvatarElement(element, element.dataset.role || "assistant");
  });
}

function editUserPrompt(text, attachments = []) {
  state.editingQueueId = null;
  elements.input.value = String(text || "");
  state.attachments = JSON.parse(JSON.stringify(attachments || []));
  renderAttachments();
  resizeInput();
  elements.input.focus();
}

function renderRecoverablePrompt(summary) {
  state.recoverablePrompt = summary?.id ? summary : null;
  elements.recoverPrompt.hidden = !state.recoverablePrompt;
  if (!state.recoverablePrompt) return;
  const attachmentCount = state.recoverablePrompt.attachments?.length || 0;
  elements.recoverPromptLabel.textContent = attachmentCount
    ? `已保留刚才取消的指令和 ${attachmentCount} 个附件`
    : "已保留刚才取消的指令";
}

async function consumeRecoveredPrompt({ fill = true } = {}) {
  const response = await api.consumeRecoveredPrompt();
  if (!response.ok) return showError(response.error.message);
  renderRecoverablePrompt(null);
  if (fill && response.data?.text != null) editUserPrompt(response.data.text, response.data.attachments || []);
}

async function addAttachments(files) {
  const incoming = [...files];
  if (state.attachments.length + incoming.length > 5) return showError("一次最多发送 5 个附件");
  if (state.attachments.reduce((sum, file) => sum + file.size, 0) + incoming.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) {
    return showError("附件总大小不能超过 8 MB");
  }
  try {
    for (const file of incoming) state.attachments.push(await serializeAttachment(file));
    renderAttachments();
  } catch (error) {
    showError(error.message);
  } finally {
    elements.attachmentInput.value = "";
  }
}

function createMessage(role, text = "", attachments = []) {
  showMessages();
  const message = document.createElement("article");
  message.className = `message ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  applyAvatarElement(avatar, role);
  const body = document.createElement("div");
  body.className = "message-body";
  const content = document.createElement("div");
  content.className = "message-content";
  const roleRow = document.createElement("div");
  roleRow.className = "message-role-row";
  if (role !== "user") {
    const roleLabel = document.createElement("div");
    roleLabel.className = "message-role";
    roleLabel.textContent = "Grok";
    roleRow.append(roleLabel);
  }
  if (role === "user") {
    roleRow.append(iconAction("pencil", "编辑并再次发送", () => editUserPrompt(text, attachments), "icon-button small message-edit"));
  }
  body.append(roleRow);
  let progress = null;
  let progressLabel = null;
  if (role === "assistant") {
    progress = document.createElement("div");
    progress.className = "turn-progress responding";
    progress.dataset.state = "responding";
    const progressDot = document.createElement("span");
    progressDot.className = "turn-progress-dot";
    progressLabel = document.createElement("span");
    progressLabel.textContent = "正在响应";
    progress.append(progressDot, progressLabel);
    body.append(progress);
  }
  if (attachments.length) {
    const attachmentStrip = document.createElement("div");
    attachmentStrip.className = "message-attachments";
    renderAttachmentChips(attachmentStrip, attachments);
    body.append(attachmentStrip);
  }
  body.append(content);
  message.append(avatar, body);
  elements.messageList.append(message);
  renderMarkdown(content, text);
  lucide.createIcons({ nodes: [message] });
  updateConversationLayout();
  scrollToBottom();
  return {
    message, body, content, text, thought: null, thoughtText: "", renderTimer: null, thoughtTimer: null, hadTools: false,
    progress, progressLabel, finalLabel: null, activityGroups: [], activeActivityGroup: null,
  };
}

function setTurnProgress(assistant, stage) {
  if (!assistant?.progress) return;
  const labels = {
    responding: "正在响应",
    tools: "正在执行工具",
    organizing: "正在整理结果",
    complete: "回答完成",
    interrupted: "任务已中断",
    failed: "执行失败",
  };
  assistant.progress.className = `turn-progress ${stage}`;
  assistant.progress.dataset.state = stage;
  assistant.progressLabel.textContent = labels[stage] || labels.responding;
}

function renderTaskStatus(task) {
  if (task?.source === "background") return;
  if (state.taskStatusTimer) {
    clearTimeout(state.taskStatusTimer);
    state.taskStatusTimer = null;
  }
  if (!task?.state) {
    state.taskStatus = null;
    elements.taskStatus.hidden = true;
    return;
  }
  const presentations = {
    started: { label: "任务已开始", icon: "loader-circle", progress: "responding" },
    completed: { label: "任务已完成", icon: "circle-check", progress: "complete" },
    interrupted: { label: "任务已中断", icon: "square", progress: "interrupted" },
    failed: { label: "任务失败", icon: "triangle-alert", progress: "failed" },
  };
  const presentation = presentations[task.state];
  if (!presentation) return;
  state.taskStatus = { ...task };
  elements.taskStatus.hidden = false;
  elements.taskStatus.dataset.state = task.state;
  elements.taskStatusIcon.innerHTML = `<i data-lucide="${presentation.icon}"></i>`;
  elements.taskStatusLabel.textContent = presentation.label;
  lucide.createIcons({ nodes: [elements.taskStatusIcon] });
  setTurnProgress(state.assistant, presentation.progress);
  if (task.state === "started") return;
  const elapsed = Math.max(0, Date.now() - Number(task.timestamp || Date.now()));
  const remaining = Math.max(0, 5_000 - elapsed);
  state.taskStatusTimer = setTimeout(() => {
    if (state.taskStatus?.id !== task.id || state.taskStatus?.state !== task.state) return;
    elements.taskStatus.hidden = true;
    state.taskStatusTimer = null;
  }, remaining);
}

function ensureAssistant() {
  if (!state.assistant) state.assistant = createMessage("assistant");
  return state.assistant;
}

function ensureAssistantContent(assistant) {
  if (assistant.content) return assistant.content;
  assistant.content = document.createElement("div");
  assistant.content.className = "message-content";
  assistant.text = "";
  assistant.body.append(assistant.content);
  return assistant.content;
}

function flushAssistantRender(assistant) {
  if (assistant.renderTimer) {
    clearTimeout(assistant.renderTimer);
    assistant.renderTimer = null;
  }
  if (assistant.thoughtTimer) {
    clearTimeout(assistant.thoughtTimer);
    assistant.thoughtTimer = null;
  }
  if (assistant.content) renderMarkdown(assistant.content, assistant.text);
  if (assistant.thought) assistant.thought.textContent = assistant.thoughtText;
}

function scheduleAssistantRender(assistant) {
  if (assistant.renderTimer) return;
  assistant.renderTimer = setTimeout(() => {
    assistant.renderTimer = null;
    if (assistant.content) renderMarkdown(assistant.content, assistant.text);
    scrollToBottom();
  }, STREAM_RENDER_DELAY);
}

function sealAssistantSegment(assistant) {
  flushAssistantRender(assistant);
  assistant.content = null;
  assistant.text = "";
  assistant.thought = null;
  assistant.thoughtText = "";
}

function appendAssistantText(text) {
  const assistant = ensureAssistant();
  if (text && assistant.activeActivityGroup) assistant.activeActivityGroup = null;
  ensureAssistantContent(assistant);
  setTurnProgress(assistant, assistant.hadTools ? "organizing" : "responding");
  assistant.text += text || "";
  scheduleAssistantRender(assistant);
}

function appendThought(text) {
  const assistant = ensureAssistant();
  if (!assistant.thought) {
    assistant.thought = document.createElement("div");
    assistant.thought.className = "thought-block";
    assistant.thoughtText = "";
    if (assistant.content) assistant.body.insertBefore(assistant.thought, assistant.content);
    else assistant.body.append(assistant.thought);
  }
  assistant.thoughtText += text || "";
  if (!assistant.thoughtTimer) {
    assistant.thoughtTimer = setTimeout(() => {
      assistant.thoughtTimer = null;
      if (assistant.thought) assistant.thought.textContent = assistant.thoughtText;
      scrollToBottom();
    }, STREAM_RENDER_DELAY);
  }
}

function toolId(update) {
  return update.toolCallId || update.id || `${update.tool || update.title || "tool"}-${state.tools.size}`;
}

function ensureActivityGroup(assistant) {
  if (assistant.activeActivityGroup) return assistant.activeActivityGroup;
  sealAssistantSegment(assistant);
  const root = document.createElement("details");
  root.className = "activity-group";
  root.open = true;
  const summary = document.createElement("summary");
  summary.className = "activity-group-summary";
  const stateIcon = document.createElement("span");
  stateIcon.className = "activity-group-icon";
  stateIcon.innerHTML = '<i data-lucide="loader-circle"></i>';
  const label = document.createElement("span");
  label.className = "activity-group-label";
  label.textContent = "正在执行";
  const represented = document.createElement("span");
  represented.className = "activity-group-count";
  const chevron = document.createElement("span");
  chevron.className = "activity-group-chevron";
  chevron.innerHTML = '<i data-lucide="chevron-right"></i>';
  summary.append(stateIcon, label, represented, chevron);
  const list = document.createElement("div");
  list.className = "activity-list";
  root.append(summary, list);
  assistant.body.append(root);
  const group = {
    root,
    summary,
    stateIcon,
    label,
    represented,
    list,
    state: GrokToolPresentation.createActivityState(),
    rows: new Map(),
    renderTimer: null,
  };
  assistant.activeActivityGroup = group;
  assistant.activityGroups.push(group);
  assistant.hadTools = true;
  setTurnProgress(assistant, "tools");
  lucide.createIcons({ nodes: [root] });
  return group;
}

function activityDetails(row) {
  return row.items.map((item, index) => {
    const sections = [];
    const heading = row.items.length > 1 ? `操作 ${index + 1}` : "操作详情";
    const rawInput = item.rawInput ?? item.arguments;
    if (item.title) sections.push(`原始标题：${item.title}`);
    if (rawInput != null) {
      const input = GrokToolPresentation.format({ rawOutput: rawInput });
      if (input.text) sections.push(`参数：\n${input.text}`);
    }
    const output = GrokToolPresentation.format(item);
    if (output.text) sections.push(`输出：\n${output.text}`);
    return `${heading}\n${sections.join("\n\n")}`.trim();
  }).filter(Boolean).join("\n\n----------------\n\n");
}

function createActivityRow(row) {
  const rowElement = document.createElement("article");
  rowElement.className = `activity-row ${row.status}`;
  rowElement.dataset.rowKey = row.key;
  const main = document.createElement("div");
  main.className = "activity-row-main";
  const rail = document.createElement("span");
  rail.className = "activity-rail";
  const icon = document.createElement("span");
  icon.className = "activity-row-icon";
  const title = document.createElement("span");
  title.className = "activity-row-title";
  const repeat = document.createElement("span");
  repeat.className = "activity-repeat";
  const status = document.createElement("span");
  status.className = "activity-row-status";
  main.append(rail, icon, title, repeat, status);
  const details = document.createElement("details");
  details.className = "activity-row-details";
  const detailsSummary = document.createElement("summary");
  detailsSummary.textContent = "查看详细信息";
  const output = document.createElement("pre");
  details.append(detailsSummary, output);
  rowElement.append(main, details);
  return { rowElement, icon, title, repeat, status, details, output };
}

function renderActivityGroup(group) {
  const summary = GrokToolPresentation.summarizeActivity(group.state);
  const statusLabels = { running: "执行中", completed: "完成", failed: "失败" };
  const statusIcons = { running: "loader-circle", completed: "circle-check", failed: "triangle-alert" };
  group.root.dataset.state = summary.status;
  group.label.textContent = summary.label;
  group.represented.textContent = summary.represented < summary.total ? `${summary.represented} 行` : "";
  group.stateIcon.innerHTML = `<i data-lucide="${statusIcons[summary.status]}"></i>`;
  if (summary.status !== "completed") group.root.open = true;

  const activeKeys = new Set();
  summary.rows.forEach((row) => {
    activeKeys.add(row.key);
    let record = group.rows.get(row.key);
    if (!record) {
      record = createActivityRow(row);
      group.rows.set(row.key, record);
    }
    record.rowElement.className = `activity-row ${row.status}`;
    record.rowElement.dataset.rowKey = row.key;
    record.icon.innerHTML = `<i data-lucide="${row.icon}"></i>`;
    record.title.textContent = row.title;
    record.title.title = row.title;
    record.repeat.textContent = row.count > 1 ? `×${row.count}` : "";
    record.repeat.hidden = row.count < 2;
    record.status.textContent = statusLabels[row.status];
    record.output.textContent = activityDetails(row);
    record.details.hidden = !record.output.textContent;
    record.details.open = row.status === "failed";
    group.list.append(record.rowElement);
  });
  group.rows.forEach((record, key) => {
    if (activeKeys.has(key)) return;
    record.rowElement.remove();
    group.rows.delete(key);
  });
  lucide.createIcons({ nodes: [group.root] });
}

function updateTool(update, isNew) {
  const id = toolId(update);
  let record = state.tools.get(id);
  if (!record) {
    const assistant = ensureAssistant();
    const group = ensureActivityGroup(assistant);
    record = { group, data: {} };
    state.tools.set(id, record);
  }

  record.data = { ...record.data, ...update };
  if (!record.data.status) record.data.status = isNew ? "in_progress" : "pending";
  GrokToolPresentation.upsertActivity(record.group.state, id, record.data);
  if (!record.group.renderTimer) {
    record.group.renderTimer = setTimeout(() => {
      record.group.renderTimer = null;
      renderActivityGroup(record.group);
      scrollToBottom();
    }, TOOL_RENDER_DELAY);
  }
}

function finalizeAssistantTurn() {
  const assistant = state.assistant;
  if (!assistant) return;
  flushAssistantRender(assistant);
  assistant.activityGroups.forEach((group) => {
    if (group.renderTimer) clearTimeout(group.renderTimer);
    group.renderTimer = null;
    renderActivityGroup(group);
    if (group.root.dataset.state === "completed") group.root.open = false;
  });
  assistant.activeActivityGroup = null;
  if (assistant.hadTools && assistant.content && assistant.text.trim()) {
    assistant.content.classList.add("final-answer");
    if (!assistant.finalLabel) {
      assistant.finalLabel = document.createElement("div");
      assistant.finalLabel.className = "final-answer-label";
      assistant.finalLabel.textContent = "最终回答";
      assistant.body.insertBefore(assistant.finalLabel, assistant.content);
    }
  }
  setTurnProgress(assistant, "complete");
  scrollToBottom();
}

function renderPlan(update) {
  const entries = update.entries || [];
  if (!entries.length) return;
  const assistant = ensureAssistant();
  let plan = assistant.body.querySelector(".plan-block");
  if (!plan) {
    plan = document.createElement("ol");
    plan.className = "plan-block";
    assistant.body.append(plan);
  }
  plan.replaceChildren();
  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry.content || entry.text || entry.title || String(entry);
    plan.append(item);
  });
  scrollToBottom();
}

function handleUpdate(params) {
  const update = params?.update && typeof params.update === "object" ? params.update : params;
  if (!update?.sessionUpdate) return;
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      appendAssistantText(update.content?.text);
      break;
    case "user_message_chunk":
      if (state.replaying) {
        createMessage("user", update.content?.text || "");
        state.assistant = null;
        state.tools.clear();
      }
      break;
    case "agent_thought_chunk":
      appendThought(update.content?.text);
      break;
    case "tool_call":
      updateTool(update, true);
      break;
    case "tool_call_update":
      updateTool(update, false);
      break;
    case "plan":
      renderPlan(update);
      break;
    case "task_completed":
      presentBackgroundTask(params);
      break;
    case "retry_state":
      if (update.type === "failed") showTurnError(update.message || update.error_type || "模型请求失败");
      break;
    case "turn_completed":
      finalizeAssistantTurn();
      if (update.stop_reason === "error") showTurnError(update.agent_result || "模型请求失败");
      break;
    default:
      break;
  }
}

function showTurnError(message, options = {}) {
  const presentation = GrokUxPolicy.describeError(message || "模型请求失败", options);
  if (presentation.kind === "command") return showError(message, options);
  if (presentation.details === state.lastTurnError) return;
  state.lastTurnError = presentation.details;
  setTurnProgress(state.assistant, "failed");
  showError(message, options);
}

function showError(message, { retry = null, source = "" } = {}) {
  showMessages();
  const presentation = GrokUxPolicy.describeError(message || "操作失败", { source });
  const existing = [...elements.messageList.querySelectorAll(".error-card")]
    .find((item) => item.dataset.errorDetails === presentation.details);
  if (existing) {
    scrollToBottom();
    return existing;
  }
  const card = document.createElement("section");
  card.className = `error-card ${presentation.kind}`;
  card.dataset.errorDetails = presentation.details;
  const heading = document.createElement("div");
  heading.className = "error-card-heading";
  heading.innerHTML = '<i data-lucide="circle-alert"></i>';
  const title = document.createElement("strong");
  title.textContent = presentation.title;
  heading.append(title);
  const guidance = document.createElement("p");
  guidance.textContent = presentation.guidance;
  const details = document.createElement("details");
  details.className = "error-details";
  const summary = document.createElement("summary");
  summary.textContent = "技术详情";
  const raw = document.createElement("pre");
  raw.textContent = presentation.details;
  details.append(summary, raw);
  const actions = document.createElement("div");
  actions.className = "error-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "复制详情";
  copy.addEventListener("click", async () => {
    await api.copyText(presentation.details);
    copy.textContent = "已复制";
  });
  if (typeof retry === "function") {
    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = "重试";
    retryButton.addEventListener("click", async () => {
      retryButton.disabled = true;
      card.remove();
      await retry();
    });
    actions.append(retryButton);
  }
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "关闭";
  dismiss.addEventListener("click", () => card.remove());
  actions.append(copy, dismiss);
  card.append(heading, guidance, details, actions);
  elements.messageList.append(card);
  lucide.createIcons({ nodes: [card] });
  scrollToBottom();
  return card;
}

function draftKey() {
  return state.sessionId || state.workspace || "__new__";
}

function saveDraft() {
  if (state.editingQueueId) return;
  const key = draftKey();
  state.drafts.delete(key);
  if (elements.input.value || state.attachments.length) {
    state.drafts.set(key, { text: elements.input.value, attachments: [...state.attachments] });
  }
  while (state.drafts.size > 20) state.drafts.delete(state.drafts.keys().next().value);
}

function restoreDraft() {
  const draft = state.drafts.get(draftKey());
  elements.input.value = draft?.text || "";
  state.attachments = [...(draft?.attachments || [])];
  renderAttachments();
  resizeInput();
}

function clearConversation() {
  elements.messageList.replaceChildren();
  elements.emptyState.hidden = false;
  state.assistant = null;
  state.tools.clear();
  state.attachments = [];
  state.lastTurnError = "";
  resetConversationFollow();
  renderAttachments();
  elements.title.textContent = "新任务";
  updateConversationLayout();
}

async function chooseWorkspace() {
  if (state.busy || connectionAttemptInFlight) return;
  const selected = await api.chooseWorkspace();
  if (!selected) return;
  await activateWorkspace(selected);
}

async function activateWorkspace(selected) {
  if (!selected || state.busy || connectionAttemptInFlight) return;
  if (selected === state.workspace && state.connected) return;
  saveDraft();
  state.workspace = selected;
  rememberWorkspace(selected);
  setWorkspaceLabels();
  if (await connectAgent()) {
    clearConversation();
    restoreDraft();
  }
}

function prepareWorkspaceMenu(workspace, anchor) {
  state.workspaceMenuTarget = workspace;
  elements.workspaceMenu.style.left = `${Math.max(8, Math.min(anchor.right - 200, innerWidth - 208))}px`;
  elements.workspaceMenu.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, innerHeight - 64))}px`;
  elements.workspaceMenuRemove.disabled = state.busy || connectionAttemptInFlight;
}

async function newWorkspaceConversation(workspace = state.workspace) {
  if (state.busy || connectionAttemptInFlight || !state.cliConnected) return;
  if (!workspace) return chooseWorkspace();
  saveDraft();
  state.workspace = workspace;
  rememberWorkspace(workspace);
  state.workspaceTreeState[workspace] = true;
  saveWorkspaceTreeState();
  setWorkspaceLabels();
  if (await connectAgent({ newSession: true })) {
    clearConversation();
    elements.input.value = "";
    resizeInput();
    elements.input.focus();
  }
}

async function removeWorkspace(workspace) {
  if (state.busy || connectionAttemptInFlight) return;
  const remaining = state.workspaces.filter((item) => item !== workspace);
  if (state.workspace !== workspace) {
    state.workspaces = remaining;
    persistWorkspaces();
    renderWorkspaces();
    return;
  }
  const next = remaining[0];
  if (next) {
    await activateWorkspace(next);
    if (state.workspace === next && state.connected) {
      state.workspaces = remaining;
      persistWorkspaces();
      renderWorkspaces();
    }
    return;
  }
  const response = await api.closeWorkspace();
  if (!response.ok) return showError(response.error.message);
  state.workspaces = remaining;
  state.workspace = "";
  state.connected = false;
  state.sessionId = null;
  persistWorkspaces();
  clearConversation();
  setWorkspaceLabels();
  applyConnectionData(response.data);
  setStatus(state.cliConnected ? "cli-ready" : "idle");
  updateControls();
}

async function connectAgent(options = {}) {
  if (connectionAttemptInFlight) return;
  connectionAttemptInFlight = true;
  try {
    state.connected = false;
    state.busy = false;
    setStatus(state.cliConnected ? (state.workspace ? "switching" : "cli-ready") : "connecting");
    updateControls();
    const response = await api.startAgent(state.workspace || null, options);
    if (!response.ok) {
      if (response.stale) return;
      if (response.data) {
        applyConnectionData(response.data);
        state.connected = Boolean(response.data.connected);
        state.workspace = response.data.workspace || "";
        persistWorkspaces();
        setWorkspaceLabels();
      }
      setStatus(response.data?.status || "error");
      showError(response.error.message, { retry: connectAgent });
      return;
    }
    applyConnectionData(response.data);
    if (response.data.requiresAuth) {
      state.connected = false;
      setStatus("auth-required");
      updateControls();
      populateAuthDialog();
      return false;
    }
    state.connected = response.data.connected ?? Boolean(state.workspace);
    state.cliConnected = response.data.cliConnected ?? state.connected;
    setStatus(state.connected ? "ready" : "cli-ready");
    updateControls();
    if (state.connected) elements.input.focus();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法连接到 Grok 后端";
    setStatus("error");
    showError(message, { retry: connectAgent });
  } finally {
    connectionAttemptInFlight = false;
    updateControls();
  }
}

function renderPromptQueue(items) {
  state.promptQueue = items || [];
  state.queueLength = state.promptQueue.length;
  elements.promptQueue.hidden = !state.promptQueue.length;
  elements.promptQueueList.replaceChildren();
  state.promptQueue.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "prompt-queue-item";
    const order = document.createElement("span");
    order.className = "prompt-queue-order";
    order.textContent = String(index + 1);
    const copy = document.createElement("div");
    copy.className = "prompt-queue-copy";
    const text = document.createElement("strong");
    text.textContent = item.text;
    const detail = document.createElement("span");
    detail.textContent = [
      item.modelName || item.modelId,
      item.providerName,
      item.attachments?.length ? `${item.attachments.length} 个附件` : "无附件",
    ].filter(Boolean).join(" · ");
    copy.append(text, detail);
    const actions = document.createElement("div");
    actions.className = "prompt-queue-actions";
    const moveUp = iconAction("arrow-up", "上移", async () => {
      const response = await api.moveQueuedPrompt(item.id, -1);
      if (!response.ok) showError(response.error.message);
    });
    moveUp.disabled = index === 0;
    const moveDown = iconAction("arrow-down", "下移", async () => {
      const response = await api.moveQueuedPrompt(item.id, 1);
      if (!response.ok) showError(response.error.message);
    });
    moveDown.disabled = index === state.promptQueue.length - 1;
    actions.append(
      iconAction("pencil", "编辑", () => {
        if ((elements.input.value.trim() || state.attachments.length) && !window.confirm("用这条待执行指令替换当前草稿？")) return;
        state.editingQueueId = item.id;
        elements.input.value = item.text;
        state.attachments = [];
        renderAttachments();
        resizeInput();
        elements.input.focus();
      }),
      moveUp,
      moveDown,
      iconAction("forward", "打断当前任务并立即执行", async () => {
        const response = await api.interruptQueuedPrompt(item.id);
        if (!response.ok) showError(response.error.message);
      }),
      iconAction("trash-2", "删除", async () => {
        const response = await api.removeQueuedPrompt(item.id);
        if (!response.ok) return showError(response.error.message);
        if (state.editingQueueId === item.id) state.editingQueueId = null;
        updateControls();
      }),
    );
    row.append(order, copy, actions);
    elements.promptQueueList.append(row);
  });
  if (state.editingQueueId && !state.promptQueue.some((item) => item.id === state.editingQueueId)) {
    state.editingQueueId = null;
  }
  lucide.createIcons({ nodes: [elements.promptQueueList] });
  updateConversationLayout();
  updateControls();
}

function cancelQueueEdit() {
  state.editingQueueId = null;
  elements.input.value = "";
  state.attachments = [];
  renderAttachments();
  resizeInput();
  elements.input.focus();
}

async function submitPrompt(interrupt = false) {
  const draft = elements.input.value;
  const text = draft.trim();
  if ((!text && !state.attachments.length) || !state.connected) return;

  if (state.editingQueueId) {
    const id = state.editingQueueId;
    const response = await api.updateQueuedPrompt(id, { text });
    if (!response.ok) return showTurnError(response.error.message);
    if (interrupt) {
      const interrupted = await api.interruptQueuedPrompt(id);
      if (!interrupted.ok) return showTurnError(interrupted.error.message);
    }
    if (elements.input.value === draft) elements.input.value = "";
    state.editingQueueId = null;
    resizeInput();
    elements.input.focus();
    return;
  }

  const attachments = state.attachments;
  const submittedDraftKey = draftKey();
  state.lastTurnError = "";
  const response = await api.prompt({ text, attachments, interrupt });
  if (!response.ok) {
    if (response.error.code === "AUTH_REQUIRED") {
      populateAuthDialog();
      updateControls();
      return;
    }
    if (response.error.message !== state.lastTurnError) showTurnError(response.error.message);
    updateControls();
    return;
  }
  state.drafts.delete(submittedDraftKey);
  if (elements.title.textContent === "新任务") {
    const title = text || attachments[0]?.name || "附件任务";
    elements.title.textContent = title.length > 42 ? `${title.slice(0, 42)}...` : title;
  }
  if (elements.input.value === draft) elements.input.value = "";
  if (state.attachments === attachments) state.attachments = [];
  renderAttachments();
  resizeInput();
  elements.input.focus();
}

function resizeInput() {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 180)}px`;
  updateControls();
}

function permissionOptionId(option) {
  return option.optionId || option.id;
}

function showPermission(request) {
  state.pendingPermission = request;
  const presentation = GrokUxPolicy.describePermission(request);
  elements.permissionRisk.className = `permission-risk ${presentation.level}`;
  elements.permissionRisk.textContent = presentation.label;
  elements.permissionTarget.textContent = presentation.summary;
  elements.permissionDescription.textContent = "请选择允许范围";
  elements.permissionCommand.textContent = presentation.details;
  elements.permissionDetails.hidden = !presentation.details;
  elements.permissionDetails.open = false;
  elements.permissionOptions.replaceChildren();
  updateControls();
  const submitReply = async (optionId) => {
    elements.permissionOptions.querySelectorAll("button").forEach((item) => { item.disabled = true; });
    elements.permissionDescription.textContent = "正在提交确认...";
    const response = await api.replyPermission(request.id, optionId);
    if (response?.ok === false) throw new Error(response.error?.message || "权限确认失败");
    state.pendingPermission = null;
    elements.permissionDialog.close();
    updateControls();
  };
  (request.options || []).forEach((option) => {
    const button = document.createElement("button");
    const kind = String(option.kind || option.optionKind || "").toLowerCase();
    button.className = `permission-option ${kind.includes("reject") ? "reject" : "allow"}`;
    button.type = "button";
    button.textContent = option.name || option.label || permissionOptionId(option);
    button.addEventListener("click", async () => {
      try {
        await submitReply(permissionOptionId(option));
      } catch (error) {
        elements.permissionDescription.textContent = "提交失败，请重试";
        elements.permissionOptions.querySelectorAll("button").forEach((item) => { item.disabled = false; });
        showError(error);
      }
    });
    elements.permissionOptions.append(button);
  });
  if (!request.options?.length) {
    const reject = document.createElement("button");
    reject.className = "permission-option reject";
    reject.type = "button";
    reject.textContent = "拒绝";
    reject.addEventListener("click", async () => {
      try {
        await submitReply(null);
      } catch (error) {
        elements.permissionDescription.textContent = "提交失败，请重试";
        elements.permissionOptions.querySelectorAll("button").forEach((item) => { item.disabled = false; });
        showError(error);
      }
    });
    elements.permissionOptions.append(reject);
  }
  elements.permissionDialog.showModal();
}

function showFolderTrust(request) {
  state.pendingTrust = request;
  elements.trustDescription.textContent = request.workspace || request.cwd;
  elements.trustKinds.replaceChildren();
  (request.configKinds || []).forEach((kind) => {
    const tag = document.createElement("span");
    tag.textContent = String(kind).toUpperCase();
    elements.trustKinds.append(tag);
  });
  elements.trustDialog.showModal();
}

function planApprovalFeedbackReady() {
  return Boolean(elements.planApprovalFeedback.value.trim());
}

function renderPlanApprovalBanner() {
  const pending = Boolean(state.pendingPlanApproval);
  const open = Boolean(elements.planApprovalDialog.open);
  elements.planApprovalBanner.hidden = !pending || open;
  if (elements.planApprovalBanner.hidden) return;
  lucide.createIcons({ nodes: [elements.planApprovalBanner] });
}

function syncPlanApprovalActions(busy = false) {
  elements.approvePlan.disabled = busy;
  elements.abandonPlan.disabled = busy;
  elements.revisePlan.disabled = busy || !planApprovalFeedbackReady();
  elements.deferPlan.disabled = busy;
}

function setPlanApprovalBusy(busy) {
  syncPlanApprovalActions(busy);
}

function fillPlanApproval(request) {
  const context = GrokUxPolicy.describePlanApprovalContext(request);
  elements.planApprovalSession.textContent = context.label;
  elements.planApprovalSession.title = context.title;
  renderMarkdown(elements.planApprovalContent, request.planContent || "# 未提供计划内容");
  if (!elements.planApprovalFeedback.value) elements.planApprovalFeedback.value = "";
  elements.planApprovalStatus.textContent = "请选择批准、提出修改意见或放弃计划";
  syncPlanApprovalActions(false);
}

function showPlanApproval(request, { reopen = false } = {}) {
  if (!request?.id) return;
  if (!reopen && state.pendingPlanApproval?.id === request.id) return;
  if (!reopen || state.pendingPlanApproval?.id !== request.id) {
    elements.planApprovalFeedback.value = "";
  }
  state.pendingPlanApproval = request;
  fillPlanApproval(request);
  if (!elements.planApprovalDialog.open) elements.planApprovalDialog.showModal();
  renderPlanApprovalBanner();
  requestAnimationFrame(() => elements.approvePlan.focus());
}

function deferPlanApproval() {
  if (elements.planApprovalDialog.open) elements.planApprovalDialog.close();
  renderPlanApprovalBanner();
}

function clearPlanApproval() {
  state.pendingPlanApproval = null;
  if (elements.planApprovalDialog.open) elements.planApprovalDialog.close();
  renderPlanApprovalBanner();
}

async function submitPlanApproval(outcome) {
  const pending = state.pendingPlanApproval;
  if (!pending) return;
  const feedback = elements.planApprovalFeedback.value.trim();
  if (outcome === "cancelled" && !feedback) {
    elements.planApprovalStatus.textContent = "请先填写修改意见";
    elements.planApprovalFeedback.focus();
    syncPlanApprovalActions(false);
    return;
  }
  if (outcome === "abandoned" && !window.confirm("确定放弃这份计划？模型将停止按该方案继续执行。")) return;
  setPlanApprovalBusy(true);
  elements.planApprovalStatus.textContent = "正在提交计划审批...";
  try {
    const accepted = await api.replyPlanApproval(pending.id, outcome, feedback);
    if (!accepted) throw new Error("计划审批已失效，请等待重新同步");
    clearPlanApproval();
  } catch (error) {
    elements.planApprovalStatus.textContent = "提交失败，请重试";
    setPlanApprovalBusy(false);
    showError(error);
  }
}

function taskSnapshotFrom(params) {
  const update = params?.update && typeof params.update === "object" ? params.update : params;
  if (!update || (update.sessionUpdate && update.sessionUpdate !== "task_completed")) return null;
  return update.task_snapshot ?? update.taskSnapshot ?? update.task ?? null;
}

function presentBackgroundTask(params) {
  const task = taskSnapshotFrom(params);
  if (!task) return;
  const described = GrokUxPolicy.describeBackgroundTask(task);
  const taskId = described.taskId;
  updateTool({
    toolCallId: `background-${taskId}`,
    tool: "terminal",
    title: described.command,
    status: described.status,
    rawOutput: described.detail || described.output || described.message,
  }, false);
  if (described.kind === "failed") showTurnError(described.message, { source: "background-task" });
}

function populateAuthDialog() {
  elements.authMethod.replaceChildren();
  state.authMethods.filter((method) => method.id !== "cached_token").forEach((method) => {
    const option = document.createElement("option");
    option.value = method.id;
    option.textContent = method.name || method.id;
    option.dataset.description = method.description || "";
    elements.authMethod.append(option);
  });
  const selected = elements.authMethod.selectedOptions[0];
  elements.authDescription.textContent = selected?.dataset.description || "将在浏览器中完成登录。";
  elements.authDialog.showModal();
}

function renderControlInfo(info) {
  state.controlInfo = { ...state.controlInfo, ...info };
  elements.remoteToggle.checked = Boolean(state.controlInfo.running);
  const clients = state.controlInfo.connectedClients || 0;
  elements.remoteStatus.textContent = state.controlInfo.running
    ? clients ? `${clients} 台设备已连接` : "等待手机连接"
    : "已关闭";
  elements.remoteClientCount.textContent = clients ? `${clients} 台设备已连接` : "等待手机连接";
  elements.remoteCode.textContent = state.controlInfo.pairingCode || "------";
  const endpoints = state.controlInfo.endpoints || [];
  if (!endpoints.some((endpoint) => endpoint.url === state.remoteSelectedUrl)) {
    state.remoteSelectedUrl = endpoints[0]?.url || state.controlInfo.url || "";
  }
  elements.remoteAddress.replaceChildren(...endpoints.map((endpoint) => {
    const option = document.createElement("option");
    option.value = endpoint.url;
    option.textContent = `${endpoint.kind === "tailscale" ? "Tailscale" : "局域网"} · ${endpoint.address}`;
    return option;
  }));
  elements.remoteAddress.value = state.remoteSelectedUrl;
  elements.remoteAddress.hidden = endpoints.length < 2;
  const selected = endpoints.find((endpoint) => endpoint.url === state.remoteSelectedUrl);
  elements.remoteUrl.textContent = selected?.url || state.controlInfo.url || "没有可用的连接地址";
  elements.remoteQr.src = selected?.qrDataUrl || state.controlInfo.qrDataUrl || "";
}

async function enableRemote(showDialog = true) {
  const response = await api.startControlServer();
  if (!response.ok) {
    renderControlInfo({ running: false });
    showError(response.error.message);
    return;
  }
  renderControlInfo(response.data);
  if (showDialog && !elements.remoteDialog.open) elements.remoteDialog.showModal();
}

async function disableRemote() {
  const response = await api.stopControlServer();
  if (!response.ok) {
    showError(response.error.message);
    return;
  }
  renderControlInfo(response.data);
  if (elements.remoteDialog.open) elements.remoteDialog.close();
}

function backgroundImageValue(settings) {
  return settings.dataUrl ? `url(${JSON.stringify(settings.dataUrl)})` : "none";
}

const THEMES = new Set(["light", "dark"]);

function applyTheme(theme) {
  state.theme = THEMES.has(theme) ? theme : "light";
  document.documentElement.dataset.theme = state.theme;
  document.body.dataset.theme = state.theme;
  localStorage.setItem("grok-desktop.theme", state.theme);
  document.querySelectorAll(".theme-picker [data-theme]").forEach((button) => {
    button.classList.toggle("active", button.dataset.theme === state.theme);
    button.setAttribute("aria-pressed", button.dataset.theme === state.theme ? "true" : "false");
  });
  api.setTheme?.(state.theme).catch(() => {});
}

function applyBackground(settings) {
  state.background = { ...state.background, ...settings };
  document.body.dataset.customBackground = String(Boolean(state.background.dataUrl));
  const image = backgroundImageValue(state.background);
  document.body.style.backgroundImage = image;
  document.body.style.backgroundPosition = state.background.position;
  document.body.style.backgroundSize = state.background.fit;
  document.body.style.backgroundRepeat = "no-repeat";
  elements.backgroundPreview.style.backgroundImage = image;
  elements.backgroundPreview.style.backgroundPosition = state.background.position;
  elements.backgroundPreview.style.backgroundSize = state.background.fit;
  elements.backgroundPreview.style.backgroundRepeat = "no-repeat";
  elements.backgroundStatus.textContent = state.background.custom ? "使用自定义背景" : "使用默认背景";
  document.querySelectorAll("[data-position]").forEach((button) => {
    button.classList.toggle("active", button.dataset.position === state.background.position);
  });
  document.querySelectorAll("[data-fit]").forEach((button) => {
    button.classList.toggle("active", button.dataset.fit === state.background.fit);
  });
}

function formatDate(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

async function loadRecentSession(session, button) {
  saveDraft();
  button.disabled = true;
  clearConversation();
  state.replaying = true;
  const response = await api.loadSession({ id: session.id, cwd: session.cwd || state.workspace });
  button.disabled = false;
  if (!response.ok) {
    state.replaying = false;
    restoreDraft();
    showError(response.error.message);
    return;
  }
  state.workspace = response.data.workspace;
  rememberWorkspace(state.workspace);
  setWorkspaceLabels();
  applyConnectionData(response.data);
  elements.title.textContent = session.title;
  restoreDraft();
  updateControls();
  scheduleRecentSessionsRefresh(true);
}

function renderRecentSessions(sessions) {
  state.recentSessions = Array.isArray(sessions) ? sessions : [];
  renderWorkspaceTree();
}

async function refreshRecentSessions() {
  if (!state.cliConnected) {
    renderRecentSessions([]);
    return;
  }
  const generation = ++state.recentSessionsGeneration;
  state.recentSessionsLoading = !state.recentSessions.length;
  state.recentSessionsError = "";
  renderWorkspaceTree();
  let response;
  try {
    response = await api.listSessions("", { scope: "projects" });
  } catch {
    response = null;
  }
  if (generation !== state.recentSessionsGeneration) return;
  state.recentSessionsLoading = false;
  if (!response?.ok) {
    state.recentSessionsError = response?.error?.message || "暂时无法读取项目对话";
    renderWorkspaceTree();
    return;
  }
  renderRecentSessions(response.data?.sessions || []);
}

function scheduleRecentSessionsRefresh(force = false) {
  const key = `${state.cliConnected}:${state.connected}:${state.workspace}:${state.sessionId || ""}`;
  if (!force && key === state.recentSessionsKey) return;
  state.recentSessionsKey = key;
  clearTimeout(state.recentSessionsTimer);
  state.recentSessionsTimer = setTimeout(refreshRecentSessions, 120);
}

function formatMoney(cents) {
  return Number(cents || 0).toLocaleString("zh-CN", { style: "currency", currency: "USD" });
}

async function refreshBilling() {
  const refresh = $("#refresh-usage");
  if (refresh.disabled) return;
  refresh.disabled = true;
  refresh.setAttribute("aria-busy", "true");
  const details = $("#usage-error-details");
  details.hidden = true;
  details.open = false;
  elements.usageState.hidden = false;
  elements.usageState.textContent = "正在查询账号额度...";
  elements.usageContent.hidden = true;
  let response;
  try {
    response = await api.getBilling();
  } catch (error) {
    response = { ok: false, error: { message: "额度查询未能完成，请检查连接后重试。", data: { detail: error.message } } };
  } finally {
    refresh.disabled = false;
    refresh.removeAttribute("aria-busy");
  }
  if (!response.ok) {
    elements.usageState.textContent = response.error.message || "无法查询额度，请先登录 Grok";
    const technical = response.error.data?.detail || response.error.detail;
    details.hidden = !technical;
    $("#usage-error-text").textContent = technical || "";
    return;
  }
  const billing = response.data;
  elements.usageTier.textContent = billing.subscriptionTier || "Grok 账号";
  if (!billing.available) {
    elements.usageState.textContent = "此登录方式没有可显示的个人额度";
    return;
  }
  const percent = Math.floor(billing.usagePercent || 0);
  $("#usage-percent").textContent = `${percent}%`;
  $("#usage-period-label").textContent = String(billing.periodType || "").includes("WEEKLY") ? "本周额度" : String(billing.periodType || "").includes("MONTHLY") ? "本月额度" : "本期额度";
  $("#usage-reset").textContent = billing.periodEnd ? `下次重置 ${formatDate(billing.periodEnd)}` : "重置时间未知";
  $("#usage-prepaid").textContent = billing.prepaidBalanceCents ? formatMoney(billing.prepaidBalanceCents) : "无预付余额";
  $("#usage-demand").textContent = billing.onDemandEnabled
    ? `${formatMoney(billing.onDemandUsedCents)} / ${formatMoney(billing.onDemandCapCents)}`
    : "未启用";
  const fill = $("#usage-track-fill");
  fill.style.width = `${Math.min(100, percent)}%`;
  fill.className = percent >= 90 ? "danger" : percent >= 70 ? "warning" : "";
  elements.usageState.hidden = true;
  elements.usageContent.hidden = false;
}

function renderSessions(result) {
  elements.sessionsList.replaceChildren();
  const sessions = result?.sessions || [];
  elements.sessionsState.hidden = Boolean(sessions.length);
  elements.sessionsState.textContent = sessions.length ? "" : "没有找到匹配的历史会话";
  sessions.forEach((session) => {
    const row = document.createElement("div");
    row.className = "resource-row";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "resource-copy session-open";
    const title = document.createElement("strong");
    title.textContent = session.title;
    const details = document.createElement("span");
    details.textContent = [formatDate(session.updatedAt), session.modelId, session.messageCount ? `${session.messageCount} 条消息` : ""].filter(Boolean).join(" · ");
    copy.append(title, details);
    const actions = document.createElement("div");
    actions.className = "resource-actions";
    const resume = copy;
    resume.title = "打开对话";
    resume.addEventListener("click", async () => {
      await loadRecentSession(session, resume);
      if (state.sessionId === session.id && state.connected) elements.sessionsDialog.close();
    });
    const rename = document.createElement("button");
    rename.className = "icon-button small";
    rename.type = "button";
    rename.title = "重命名";
    rename.innerHTML = '<i data-lucide="pencil"></i>';
    rename.addEventListener("click", async () => {
      const title = window.prompt("输入新的会话标题", session.title);
      if (!title?.trim() || title.trim() === session.title) return;
      const response = await api.renameSession({ ...session, title: title.trim() });
      response.ok ? refreshSessions() : showError(response.error.message);
    });
    const fork = document.createElement("button");
    fork.className = "icon-button small";
    fork.type = "button";
    fork.title = "分叉会话";
    fork.innerHTML = '<i data-lucide="git-fork"></i>';
    fork.addEventListener("click", async () => {
      const response = await api.forkSession(session);
      response.ok ? refreshSessions() : showError(response.error.message);
    });
    const remove = document.createElement("button");
    remove.className = "icon-button small";
    remove.type = "button";
    remove.title = "删除会话";
    remove.innerHTML = '<i data-lucide="trash-2"></i>';
    remove.addEventListener("click", async () => {
      if (!window.confirm(`永久删除会话“${session.title}”？`)) return;
      const response = await api.deleteSession(session);
      response.ok ? refreshSessions() : showError(response.error.message);
    });
    actions.append(rename, fork, remove);
    row.append(copy, actions);
    elements.sessionsList.append(row);
  });
  lucide.createIcons({ nodes: [elements.sessionsList] });
}

async function refreshSessions() {
  const generation = ++state.sessionSearchGeneration;
  const query = elements.sessionSearch.value;
  elements.sessionsState.hidden = false;
  elements.sessionsState.textContent = query ? "正在搜索对话…" : "正在读取历史会话…";
  elements.sessionsList.setAttribute("aria-busy", "true");
  let response;
  try {
    response = await api.listSessions(query);
  } catch (error) {
    response = { ok: false, error: { message: error.message || "暂时无法读取对话，请重试" } };
  }
  if (generation !== state.sessionSearchGeneration || query !== elements.sessionSearch.value) return;
  elements.sessionsList.setAttribute("aria-busy", "false");
  if (!response.ok) {
    elements.sessionsState.textContent = response.error.message;
    return;
  }
  renderSessions(response.data);
}

function formatTokens(value) {
  const number = Number(value || 0);
  return number >= 1000000 ? `${(number / 1000000).toFixed(1)}m` : number >= 1000 ? `${Math.round(number / 1000)}k` : String(number);
}

function renderSessionInfo(info) {
  const context = info?.context || {};
  $("#session-info-summary").textContent = info?.sessionId ? `会话 ${info.sessionId.slice(0, 12)} · ${basename(info.cwd || state.workspace)}` : "当前会话";
  $("#session-info-model").textContent = info?.modelDisplayName || info?.model || state.modelState.currentModelId || "--";
  $("#session-info-turns").textContent = `${info?.turns || context.turnCount || 0} 轮`;
  $("#session-info-context").textContent = context.total ? `${formatTokens(context.used)} / ${formatTokens(context.total)} (${context.usagePct || 0}%)` : "暂无统计";
  $("#session-info-backend").textContent = info?.apiBackend || "默认";
}

async function openSessionTools() {
  elements.sessionToolsDialog.showModal();
  $("#session-info-summary").textContent = "正在读取会话状态...";
  elements.rewindList.replaceChildren();
  elements.rewindState.hidden = true;
  $("#rewind-mode-row").hidden = true;
  const response = await api.getSessionInfo();
  if (response.ok) renderSessionInfo(response.data);
  else $("#session-info-summary").textContent = response.error.message;
}

function promptHistoryText(item) {
  return typeof item === "string" ? item : String(item?.text || item?.prompt || item?.content || "");
}

function renderRewindPoints(response, currentPrompts = []) {
  const points = response?.rewind_points || response?.rewindPoints || [];
  elements.rewindList.replaceChildren();
  elements.rewindState.hidden = Boolean(points.length);
  elements.rewindState.textContent = points.length ? "" : "当前会话还没有可用的回退点";
  $("#rewind-mode-row").hidden = !points.length;
  points.slice().reverse().forEach((point) => {
    const promptIndex = Number(point.prompt_index ?? point.promptIndex);
    const exactPrompt = promptHistoryText(currentPrompts[promptIndex]);
    const row = document.createElement("div");
    row.className = "resource-row";
    const copy = document.createElement("div");
    copy.className = "resource-copy";
    const title = document.createElement("strong");
    title.textContent = point.prompt_preview || point.promptPreview || `第 ${Number(point.prompt_index ?? point.promptIndex) + 1} 次提问`;
    const details = document.createElement("span");
    const fileCount = point.num_file_snapshots ?? point.numFileSnapshots ?? 0;
    details.textContent = `${formatDate(point.created_at || point.createdAt)} · ${fileCount} 个文件快照`;
    copy.append(title, details);
    const actions = document.createElement("div");
    actions.className = "resource-actions";
    const button = document.createElement("button");
    button.className = "secondary-command compact-button";
    button.type = "button";
    button.innerHTML = '<i data-lucide="rotate-ccw"></i><span>回退</span>';
    button.addEventListener("click", async () => {
      const mode = $("#rewind-mode").value;
      const labels = { all: "对话和文件", conversation_only: "仅对话", files_only: "仅文件" };
      if (!window.confirm(`确定回退到这次提问之前？范围：${labels[mode]}`)) return;
      button.disabled = true;
      const result = await api.rewind(promptIndex, mode);
      button.disabled = false;
      if (!result.ok) return showError(result.error.message);
      elements.sessionToolsDialog.close();
      if (state.sessionId) {
        state.replaying = true;
        const loaded = await api.loadSession({ id: state.sessionId, cwd: state.workspace });
        state.replaying = false;
        if (!loaded.ok) showError(loaded.error.message);
      }
    });
    actions.append(button);
    if (exactPrompt) {
      const edit = document.createElement("button");
      edit.className = "secondary-command compact-button";
      edit.type = "button";
      edit.innerHTML = '<i data-lucide="pencil"></i><span>回退并编辑</span>';
      edit.addEventListener("click", async () => {
        const mode = $("#rewind-mode").value;
        if (!window.confirm("回退会丢弃这次提问之后的对话。确定回退并把原指令放回输入框吗？")) return;
        edit.disabled = true;
        const result = await api.rewind(promptIndex, mode);
        edit.disabled = false;
        if (!result.ok) return showError(result.error.message);
        elements.sessionToolsDialog.close();
        if (state.sessionId) {
          state.replaying = true;
          const loaded = await api.loadSession({ id: state.sessionId, cwd: state.workspace });
          state.replaying = false;
          if (!loaded.ok) return showError(loaded.error.message);
        }
        editUserPrompt(exactPrompt);
      });
      actions.append(edit);
    }
    row.append(copy, actions);
    elements.rewindList.append(row);
  });
  lucide.createIcons({ nodes: [elements.rewindList] });
}

function configId(value, fallback = "provider") {
  const normalized = String(value || "").trim().toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 52);
  return normalized || `${fallback}-${Date.now().toString(36)}`;
}

function uniqueConfigId(value, usedIds, fallback) {
  const base = configId(value, fallback);
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base.slice(0, 58)}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function closeModelForms() {
  elements.providerForm.reset();
  elements.providerModelForm.reset();
  elements.providerForm.hidden = true;
  elements.providerModelForm.hidden = true;
}

function openProviderForm(provider = null) {
  closeModelForms();
  elements.providerForm.hidden = false;
  elements.providerId.value = provider?.id || "";
  elements.providerName.value = provider?.name || "";
  elements.providerBackend.value = provider?.apiBackend || "chat_completions";
  elements.providerBaseUrl.value = provider?.baseUrl || "";
  elements.providerApiKey.value = "";
  elements.providerClearKeyRow.hidden = !provider?.hasApiKey;
  $("#provider-form-title").textContent = provider ? "编辑供应商" : "添加供应商";
  elements.providerName.focus();
}

function openProviderModelForm(provider, model = null) {
  closeModelForms();
  elements.providerModelForm.hidden = false;
  elements.modelProviderId.value = provider.id;
  elements.modelOriginalId.value = model?.id || "";
  elements.providerModelId.value = model?.id || "";
  elements.providerModelId.dataset.auto = model ? "false" : "true";
  elements.providerModelName.value = model?.name || "";
  elements.providerModelValue.value = model && model.model !== model.name ? model.model : "";
  elements.providerModelBackend.value = model?.apiBackend || "";
  elements.providerModelContext.value = model?.contextWindow ?? "";
  elements.providerModelMaxOutput.value = model?.maxCompletionTokens ?? "";
  elements.providerModelTemperature.value = model?.temperature ?? "";
  elements.providerModelTopP.value = model?.topP ?? "";
  $("#model-form-title").textContent = model ? "编辑模型" : "添加模型";
  $("#model-provider-name").textContent = provider.name;
  elements.providerModelName.focus();
}

function showModelConflict(error, retry) {
  state.pendingModelConflict = { modelId: error.data?.modelId, retry };
  elements.modelConflictDescription.textContent = `配置 ID“${error.data?.modelId || "未知"}”在 config.toml 与客户端中的内容不同。`;
  elements.modelConflictDialog.showModal();
}

function applyProviderMutation(response, retry = null) {
  if (!response.ok) {
    if (response.error.code === "MODEL_CONFIG_CONFLICT" && response.error.data?.modelId) {
      showModelConflict(response.error, retry);
      return false;
    }
    showError(response.error.message);
    return false;
  }
  renderModelProviders(response.data.providers);
  closeModelForms();
  setModelConfigDirty(true);
  if (response.data.reloaded) {
    clearConversation();
    state.connected = true;
    applyConnectionData(response.data.reloaded);
    setStatus("ready");
    updateControls();
  }
  return true;
}

function setModelConfigDirty(dirty) {
  state.modelConfigDirty = Boolean(dirty);
  elements.applyModelConfig.disabled = !state.modelConfigDirty;
  elements.modelConfigState.textContent = state.modelConfigDirty ? "有尚未应用的更改" : "配置已应用";
}

function setModelCheckMode(mode) {
  state.modelCheckMode = mode === "real" ? "real" : "quick";
  document.querySelectorAll("[data-model-check-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.modelCheckMode === state.modelCheckMode);
  });
  elements.modelCheckCreditWarning.hidden = state.modelCheckMode !== "real";
  elements.modelCheckResult.className = "model-check-result";
  elements.modelCheckResult.replaceChildren();
  const hint = document.createElement("span");
  hint.textContent = state.modelCheckMode === "real"
    ? "将发送“Reply with OK”并等待模型实际输出。"
    : "快速检测只检查配置、密钥和服务连通性，不消耗模型额度。";
  elements.modelCheckResult.append(hint);
}

function openModelCheck(provider, model) {
  state.modelCheckTarget = { providerId: provider.id, modelId: model.id };
  elements.modelCheckTarget.textContent = `${provider.name} · ${model.name} (${model.model})`;
  setModelCheckMode("quick");
  elements.modelCheckDialog.showModal();
}

function renderModelCheckResult(result) {
  elements.modelCheckResult.replaceChildren();
  elements.modelCheckResult.className = `model-check-result ${result.ok ? "success" : "failure"}`;
  const heading = document.createElement("div");
  heading.className = "model-check-result-heading";
  heading.innerHTML = `<i data-lucide="${result.ok ? "circle-check" : "circle-x"}"></i>`;
  const title = document.createElement("strong");
  title.textContent = result.summary || (result.ok ? "检测通过" : "检测失败");
  heading.append(title);
  const metrics = document.createElement("div");
  metrics.className = "model-check-metrics";
  [
    ["供应商", result.provider || "--"],
    ["模型", result.modelIdentifier || result.model || "--"],
    ["延迟", Number.isFinite(result.latencyMs) ? `${result.latencyMs} ms` : "--"],
    ["HTTP", result.httpStatus || "--"],
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    const caption = document.createElement("span");
    caption.textContent = label;
    const content = document.createElement("strong");
    content.textContent = value;
    item.append(caption, content);
    metrics.append(item);
  });
  elements.modelCheckResult.append(heading, metrics);
  if (result.output) {
    const output = document.createElement("p");
    output.textContent = `模型回复：${result.output}`;
    elements.modelCheckResult.append(output);
  }
  if (result.technicalDetails) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "技术详情";
    const raw = document.createElement("pre");
    raw.textContent = result.technicalDetails;
    details.append(summary, raw);
    elements.modelCheckResult.append(details);
  }
  lucide.createIcons({ nodes: [elements.modelCheckResult] });
}

async function runModelCheck() {
  if (!state.modelCheckTarget) return;
  elements.runModelCheckButton.disabled = true;
  elements.modelCheckResult.className = "model-check-result checking";
  elements.modelCheckResult.textContent = state.modelCheckMode === "real" ? "正在发送真实模型请求..." : "正在检查服务连通性...";
  const response = await api.checkModelAvailability(
    state.modelCheckTarget.providerId,
    state.modelCheckTarget.modelId,
    state.modelCheckMode,
  );
  elements.runModelCheckButton.disabled = false;
  if (!response.ok) {
    renderModelCheckResult({ ok: false, summary: response.error.message, technicalDetails: response.error.message });
    return;
  }
  renderModelCheckResult(response.data);
}

async function applyPendingModelConfig() {
  if (!state.modelConfigDirty) return true;
  elements.applyModelConfig.disabled = true;
  elements.modelConfigState.textContent = "正在刷新后端...";
  const response = await api.applyModelConfig();
  if (!response.ok) {
    elements.applyModelConfig.disabled = false;
    elements.modelConfigState.textContent = "应用失败";
    showError(response.error.message);
    return false;
  }
  renderModelProviders(response.data.providers);
  setModelConfigDirty(false);
  if (response.data.reloaded) {
    clearConversation();
    state.connected = true;
    applyConnectionData(response.data.reloaded);
    setStatus("ready");
    updateControls();
  }
  return true;
}

async function resolveModelConflict(action) {
  const pending = state.pendingModelConflict;
  if (!pending) return;
  const buttons = [...elements.modelConflictDialog.querySelectorAll("button")];
  buttons.forEach((button) => { button.disabled = true; });
  const response = await api.resolveModelConflict(pending.modelId, action);
  buttons.forEach((button) => { button.disabled = false; });
  if (!response.ok) return showError(response.error.message);
  renderModelProviders(response.data.providers);
  setModelConfigDirty(true);
  if (response.data.reloaded) {
    clearConversation();
    state.connected = true;
    applyConnectionData(response.data.reloaded);
    setStatus("ready");
    updateControls();
  }
  state.pendingModelConflict = null;
  elements.modelConflictDialog.close();
  pending.retry?.();
}

function renderModelProviders(providers) {
  state.modelProviders = providers || [];
  elements.providerList.replaceChildren();
  elements.providerEmpty.hidden = Boolean(state.modelProviders.length);
  state.modelProviders.forEach((provider) => {
    const group = document.createElement("section");
    group.className = "provider-group";
    const header = document.createElement("div");
    header.className = "provider-header";
    const copy = document.createElement("div");
    copy.className = "resource-copy";
    const title = document.createElement("strong");
    title.textContent = provider.name;
    const details = document.createElement("span");
    let address = provider.baseUrl;
    try { address = new URL(provider.baseUrl).host; } catch {}
    details.textContent = `${address} · ${provider.apiBackend} · ${provider.hasApiKey ? "密钥已保存" : "未保存密钥"} · ${provider.models.length} 个模型`;
    copy.append(title, details);
    const actions = document.createElement("div");
    actions.className = "resource-actions";
    actions.append(
      iconAction("plus", "添加模型", () => openProviderModelForm(provider)),
      iconAction("pencil", "编辑供应商", () => openProviderForm(provider)),
      iconAction("trash-2", "删除供应商", async () => {
        const suffix = provider.models.length ? `，同时删除其下 ${provider.models.length} 个模型` : "";
        if (!window.confirm(`删除供应商“${provider.name}”${suffix}？`)) return;
        applyProviderMutation(await api.removeModelProvider(provider.id));
      }),
    );
    header.append(copy, actions);
    const models = document.createElement("div");
    models.className = "provider-models";
    if (!provider.models.length) {
      const empty = document.createElement("div");
      empty.className = "provider-model-empty";
      empty.textContent = "还没有模型";
      models.append(empty);
    }
    provider.models.forEach((model) => {
      const { row, actions: modelActions } = resourceRow(model.name, `${model.model} · ${model.apiBackend || `继承 ${provider.apiBackend}`}`);
      row.classList.add("provider-model-row");
      modelActions.append(
        iconAction("activity", "检测模型是否可用", () => openModelCheck(provider, model)),
        iconAction("pencil", "编辑模型", () => openProviderModelForm(provider, model)),
        iconAction("trash-2", "删除模型", async () => {
          if (!window.confirm(`删除模型“${model.name}”？`)) return;
          applyProviderMutation(await api.removeProviderModel(provider.id, model.id));
        }),
      );
      models.append(row);
    });
    group.append(header, models);
    elements.providerList.append(group);
  });
  lucide.createIcons({ nodes: [elements.providerList] });
}

async function openModelsDialog() {
  const response = await api.listModelProviders();
  if (response.ok) renderModelProviders(response.data);
  else showError(response.error.message);
  closeModelForms();
  setModelConfigDirty(state.modelConfigDirty);
  elements.modelsDialog.showModal();
}

function iconAction(icon, title, handler, className = "icon-button small") {
  const button = document.createElement("button");
  button.className = className;
  button.type = "button";
  button.title = title;
  button.innerHTML = `<i data-lucide="${icon}"></i>`;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await handler();
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function resourceRow(titleText, detailText) {
  const row = document.createElement("div");
  row.className = "resource-row";
  const copy = document.createElement("div");
  copy.className = "resource-copy";
  const title = document.createElement("strong");
  title.textContent = titleText;
  const details = document.createElement("span");
  details.textContent = detailText;
  copy.append(title, details);
  const actions = document.createElement("div");
  actions.className = "resource-actions";
  row.append(copy, actions);
  return { row, copy, actions };
}

function responseError(response, fallback = "操作失败") {
  return response?.error?.message || fallback;
}

function renderMcp(payload) {
  const servers = payload?.servers || payload?.mcpServers || [];
  elements.mcpList.replaceChildren();
  elements.mcpState.hidden = Boolean(servers.length);
  elements.mcpState.textContent = servers.length ? "" : "没有发现 MCP 服务";
  $("#mcp-summary").textContent = `${servers.length} 个服务 · ${servers.filter((server) => server.session?.enabled).length} 个已启用`;
  servers.forEach((server) => {
    const session = server.session || {};
    const enabled = Boolean(session.enabled);
    const tools = session.tools || [];
    const type = server.type === "stdio" ? "本地命令" : server.type === "http" ? "HTTP" : "托管连接器";
    const { row, actions } = resourceRow(
      server.displayName || server.name,
      [type, server.sourceLabel || server.source, session.status || "未连接", `${tools.length} 个工具`].filter(Boolean).join(" · "),
    );
    actions.append(iconAction(enabled ? "power-off" : "power", enabled ? "停用服务" : "启用服务", async () => {
      const response = await api.toggleMcp({ serverName: server.name, enabled: !enabled });
      if (!response.ok) return showError(responseError(response));
      await refreshMcp();
    }));
    if (session.authRequired || session.auth_required) {
      actions.append(iconAction("log-in", "登录此连接器", async () => {
        const response = await api.authenticateMcp(server.name);
        if (!response.ok) return showError(responseError(response));
        await refreshMcp(false);
      }));
    }
    if (String(server.source || "").toLowerCase() === "local") {
      actions.append(iconAction("trash-2", "删除本地配置", async () => {
        if (!window.confirm(`删除 MCP 服务“${server.displayName || server.name}”？`)) return;
        const response = await api.deleteMcp(server.name);
        if (!response.ok) return showError(responseError(response));
        await refreshMcp(false);
      }));
    }
    if (tools.length) {
      row.classList.add("expanded");
      const detail = document.createElement("div");
      detail.className = "resource-detail";
      tools.forEach((tool) => {
        const item = document.createElement("div");
        item.className = "resource-detail-row";
        const label = document.createElement("span");
        label.textContent = tool.displayName || tool.name;
        const toggle = iconAction(tool.enabled === false ? "circle" : "circle-check", tool.enabled === false ? "启用工具" : "停用工具", async () => {
          const response = await api.toggleMcpTool({ serverName: server.name, toolName: tool.name, enabled: tool.enabled === false });
          if (!response.ok) return showError(responseError(response));
          await refreshMcp();
        });
        item.append(label, toggle);
        detail.append(item);
      });
      row.append(detail);
    }
    elements.mcpList.append(row);
  });
  lucide.createIcons({ nodes: [elements.mcpList] });
}

async function refreshMcp(cache = true) {
  elements.mcpState.hidden = false;
  elements.mcpState.textContent = "正在读取 MCP 服务...";
  const response = await api.listMcp(cache);
  if (response.ok) renderMcp(response.data);
  else elements.mcpState.textContent = responseError(response, "MCP 服务读取失败");
}

function renderSkills(payload) {
  const skills = payload?.skills || [];
  elements.skillsList.replaceChildren();
  elements.skillsState.hidden = Boolean(skills.length);
  elements.skillsState.textContent = skills.length ? "" : "没有发现技能";
  $("#skills-summary").textContent = `${payload?.totalSkills ?? skills.length} 个技能 · ${(payload?.paths || []).length} 个自定义路径`;
  skills.forEach((skill) => {
    const enabled = skill.enabled !== false;
    const { row, actions } = resourceRow(
      skill.displayName || skill.name,
      [skill.shortDescription || skill.description, skill.pluginName ? `插件 ${skill.pluginName}` : skill.scope].filter(Boolean).join(" · "),
    );
    actions.append(iconAction(enabled ? "circle-check" : "circle", enabled ? "停用技能" : "启用技能", async () => {
      const response = await api.changeSkill("toggle", { name: skill.name, enabled: !enabled });
      if (!response.ok) return showError(responseError(response));
      renderSkills({ ...payload, ...response.data });
    }));
    elements.skillsList.append(row);
  });
  lucide.createIcons({ nodes: [elements.skillsList] });
}

async function refreshSkills() {
  elements.skillsState.hidden = false;
  elements.skillsState.textContent = "正在读取技能...";
  const response = await api.listSkills();
  if (response.ok) renderSkills(response.data);
  else elements.skillsState.textContent = responseError(response, "技能读取失败");
}

function renderPlugins(payload) {
  const plugins = payload?.plugins || [];
  elements.pluginsList.replaceChildren();
  elements.pluginsState.hidden = Boolean(plugins.length);
  elements.pluginsState.textContent = plugins.length ? "" : "没有安装插件";
  $("#plugins-summary").textContent = `${plugins.length} 个插件 · ${plugins.filter((plugin) => plugin.enabled).length} 个已启用`;
  plugins.forEach((plugin) => {
    const componentCount = Number(plugin.skillCount || 0) + Number(plugin.agentCount || 0) + Number(plugin.hookCount || 0) + Number(plugin.mcpServerCount || 0);
    const { row, actions } = resourceRow(
      plugin.name,
      [plugin.version, plugin.scope, componentCount ? `${componentCount} 个组件` : "", plugin.conflict || ""].filter(Boolean).join(" · "),
    );
    actions.append(iconAction(plugin.enabled ? "circle-check" : "circle", plugin.enabled ? "停用插件" : "启用插件", async () => {
      const response = await api.changePlugin(plugin.enabled ? "disable" : "enable", { pluginId: plugin.id });
      if (!response.ok) return showError(responseError(response));
      await refreshPlugins();
    }));
    actions.append(iconAction("refresh-cw", "更新插件", async () => {
      const response = await api.changePlugin("update", { pluginId: plugin.id });
      if (!response.ok) return showError(responseError(response));
      await refreshPlugins();
    }));
    actions.append(iconAction("trash-2", "移除插件", async () => {
      if (!window.confirm(`移除插件“${plugin.name}”？`)) return;
      const response = plugin.marketplaceSource
        ? await api.changePlugin("uninstall", { pluginId: plugin.id })
        : await api.changePlugin("remove", { path: plugin.root });
      if (!response.ok) return showError(responseError(response));
      await refreshPlugins();
    }));
    elements.pluginsList.append(row);
  });
  lucide.createIcons({ nodes: [elements.pluginsList] });
}

async function refreshPlugins() {
  elements.pluginsState.hidden = false;
  elements.pluginsState.textContent = "正在读取插件...";
  const response = await api.listPlugins();
  if (response.ok) renderPlugins(response.data);
  else elements.pluginsState.textContent = responseError(response, "插件读取失败");
}

function renderMarketplace(payload) {
  const sources = payload?.sources || [];
  const entries = sources.flatMap((source) => (source.plugins || []).map((plugin) => ({ source, plugin })));
  elements.marketplaceList.replaceChildren();
  elements.marketplaceState.hidden = Boolean(entries.length);
  elements.marketplaceState.textContent = entries.length ? "" : sources.some((source) => source.error) ? sources.map((source) => source.error).filter(Boolean).join("；") : "插件市场中没有项目";
  $("#marketplace-summary").textContent = `${sources.length} 个来源 · ${entries.length} 个插件`;
  entries.forEach(({ source, plugin }) => {
    const status = String(plugin.installStatus || "");
    const { row, actions } = resourceRow(plugin.name, [plugin.version, plugin.author, source.sourceName, status].filter(Boolean).join(" · "));
    if (status.includes("update")) {
      actions.append(iconAction("download", "更新", async () => changeMarketplacePlugin("update", source, plugin)));
    } else if (status.includes("install")) {
      actions.append(iconAction("trash-2", "卸载", async () => changeMarketplacePlugin("uninstall", source, plugin)));
    } else {
      actions.append(iconAction("download", "安装", async () => changeMarketplacePlugin("install", source, plugin)));
    }
    elements.marketplaceList.append(row);
  });
  lucide.createIcons({ nodes: [elements.marketplaceList] });
}

async function changeMarketplacePlugin(action, source, plugin) {
  const response = await api.changeMarketplace(action, {
    source: source.sourceUrlOrPath,
    pluginPath: plugin.relativePath,
  });
  if (!response.ok) return showError(responseError(response));
  await Promise.all([refreshMarketplace(), refreshPlugins()]);
}

async function refreshMarketplace() {
  elements.marketplaceState.hidden = false;
  elements.marketplaceState.textContent = "正在扫描插件市场...";
  const response = await api.listMarketplace();
  if (response.ok) renderMarketplace(response.data);
  else elements.marketplaceState.textContent = responseError(response, "插件市场读取失败");
}

function renderHooks(payload) {
  const hooks = payload?.hooks || [];
  state.hooksTrusted = Boolean(payload?.projectTrusted);
  elements.hooksList.replaceChildren();
  elements.hooksState.hidden = Boolean(hooks.length);
  elements.hooksState.textContent = hooks.length ? "" : "没有发现 Hooks";
  $("#hooks-summary").textContent = `${hooks.length} 个 Hooks · ${state.hooksTrusted ? "项目已信任" : "项目未信任"}`;
  $("#toggle-hook-trust").textContent = state.hooksTrusted ? "取消信任" : "信任项目 Hooks";
  hooks.forEach((hook) => {
    const { row, actions } = resourceRow(
      hook.name,
      [hook.event, hook.handlerType, hook.matcher || "所有工具", hook.command || hook.url].filter(Boolean).join(" · "),
    );
    actions.append(iconAction(hook.disabled ? "circle" : "circle-check", hook.disabled ? "启用 Hook" : "停用 Hook", async () => {
      const response = await api.changeHook(hook.disabled ? "enable" : "disable", { hookName: hook.name });
      if (!response.ok) return showError(responseError(response));
      await refreshHooks();
    }));
    elements.hooksList.append(row);
  });
  lucide.createIcons({ nodes: [elements.hooksList] });
}

async function refreshHooks() {
  elements.hooksState.hidden = false;
  elements.hooksState.textContent = "正在读取 Hooks...";
  const response = await api.listHooks();
  if (response.ok) renderHooks(response.data);
  else elements.hooksState.textContent = responseError(response, "Hooks 读取失败");
}

const extensionRefreshers = {
  mcp: refreshMcp,
  skills: refreshSkills,
  plugins: refreshPlugins,
  marketplace: refreshMarketplace,
  hooks: refreshHooks,
};

async function selectExtensionTab(tab) {
  state.extensionTab = tab;
  document.querySelectorAll("[data-extension-tab]").forEach((button) => button.classList.toggle("active", button.dataset.extensionTab === tab));
  document.querySelectorAll("[data-extension-panel]").forEach((panel) => {
    const active = panel.dataset.extensionPanel === tab;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  await extensionRefreshers[tab]?.();
}

function renderRunningWork(payload) {
  const tasks = payload?.tasks || [];
  const subagents = payload?.subagents || [];
  const rows = [
    ...subagents.map((item) => ({ kind: "subagent", id: item.subagentId, title: item.description || item.subagentType, running: true, detail: [item.subagentType, `${item.turnCount || 0} 轮`, `${item.contextUsagePct || 0}% 上下文`, formatTokens(item.tokensUsed)].join(" · ") })),
    ...tasks.map((item) => ({ kind: "task", id: item.task_id || item.taskId, title: item.display_command || item.displayCommand || item.command || "后台命令", running: !item.completed, detail: [item.kind || "bash", item.completed ? (item.exit_code ?? item.exitCode) === 0 ? "已完成" : `退出码 ${item.exit_code ?? item.exitCode ?? "--"}` : "运行中", item.cwd].filter(Boolean).join(" · ") })),
  ];
  elements.workList.replaceChildren();
  elements.workState.hidden = Boolean(rows.length);
  elements.workState.textContent = rows.length ? "" : "当前没有后台任务或子代理";
  $("#work-summary").textContent = `${tasks.filter((task) => !task.completed).length} 个后台任务运行中 · ${subagents.length} 个子代理运行中`;
  rows.forEach((item) => {
    const { row, copy, actions } = resourceRow(item.title, item.detail);
    const status = document.createElement("i");
    status.className = `status-pip ${item.running ? "running" : "done"}`;
    copy.prepend(status);
    if (item.running) {
      actions.append(iconAction("square", item.kind === "task" ? "停止后台任务" : "取消子代理", async () => {
        if (!window.confirm(`确定停止“${item.title}”？`)) return;
        const response = await api.stopRunningWork(item.kind, item.id);
        if (!response.ok) return showError(responseError(response));
        await refreshRunningWork();
      }));
    }
    elements.workList.append(row);
  });
  lucide.createIcons({ nodes: [elements.workList] });
}

async function refreshRunningWork() {
  if (!state.connected) return;
  elements.workState.hidden = false;
  elements.workState.textContent = "正在读取任务状态...";
  const response = await api.listRunningWork();
  if (response.ok) renderRunningWork(response.data);
  else elements.workState.textContent = responseError(response, "任务状态读取失败");
}

async function refreshAccountInfo() {
  $("#account-summary").textContent = "正在读取 Grok 登录状态...";
  const response = await api.getAccountInfo();
  if (!response.ok) {
    $("#account-summary").textContent = responseError(response, "账号信息读取失败");
    return;
  }
  const info = response.data || {};
  const name = [info.firstName, info.lastName].filter(Boolean).join(" ");
  elements.accountEmail.textContent = info.email || name || "未登录 Grok";
  elements.accountTeam.textContent = info.teamName || info.organizationName || "个人账号";
  elements.retentionOptOut.checked = Boolean(info.codingDataRetentionOptOut);
  $("#account-summary").textContent = info.methodId ? `登录方式：${info.methodId}` : "可使用第三方 API 模型";
}

async function refreshPromptHistory() {
  elements.promptHistoryState.hidden = false;
  elements.promptHistoryState.textContent = "正在读取提示历史...";
  const response = await api.getPromptHistory(false);
  if (!response.ok) {
    elements.promptHistoryState.textContent = responseError(response, "提示历史读取失败");
    return;
  }
  const prompts = response.data?.prompts || [];
  elements.promptHistoryList.replaceChildren();
  elements.promptHistoryState.hidden = Boolean(prompts.length);
  elements.promptHistoryState.textContent = prompts.length ? "" : "当前工作区没有提示历史";
  prompts.slice(0, 30).forEach((prompt, index) => {
    const text = promptHistoryText(prompt);
    const { row, actions } = resourceRow(text, `最近第 ${index + 1} 条 · 在当前对话末尾复用`);
    actions.append(iconAction("corner-down-left", "填入输入框", async () => {
      editUserPrompt(text);
      elements.accountDialog.close();
    }));
    elements.promptHistoryList.append(row);
  });
  lucide.createIcons({ nodes: [elements.promptHistoryList] });
}

async function refreshProjectRules() {
  const response = await api.getProjectRules();
  if (!response.ok) return showError(responseError(response, "项目规则读取失败"));
  elements.projectRules.value = response.data.content || "";
  $("#project-rules-path").textContent = response.data.path;
}

elements.workspaceButton.addEventListener("click", chooseWorkspace);
elements.emptyWorkspaceButton.addEventListener("click", chooseWorkspace);
elements.attachmentButton.addEventListener("click", () => elements.attachmentInput.click());
elements.attachmentInput.addEventListener("change", () => addAttachments(elements.attachmentInput.files));

function canAddAttachments() {
  return state.connected && !state.editingQueueId;
}

function dragFiles(event) {
  return GrokAttachmentIngest.filesFromDataTransfer(event.dataTransfer);
}

elements.composer.addEventListener("dragover", (event) => {
  if (!canAddAttachments() || !GrokAttachmentIngest.hasFiles(event.dataTransfer)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  elements.composer.classList.add("drop-active");
});
elements.composer.addEventListener("dragleave", (event) => {
  if (!elements.composer.contains(event.relatedTarget)) elements.composer.classList.remove("drop-active");
});
elements.composer.addEventListener("drop", (event) => {
  const files = dragFiles(event);
  elements.composer.classList.remove("drop-active");
  if (!canAddAttachments() || !files.length) return;
  event.preventDefault();
  void addAttachments(files);
});
elements.composer.addEventListener("paste", (event) => {
  const files = GrokAttachmentIngest.filesFromDataTransfer(event.clipboardData);
  if (!canAddAttachments() || !files.length) return;
  event.preventDefault();
  void addAttachments(files);
});
elements.newSession.addEventListener("click", () => newWorkspaceConversation());
elements.workspaceMenuRemove.addEventListener("click", () => {
  const workspace = state.workspaceMenuTarget;
  elements.workspaceMenu.hidePopover();
  if (workspace) void removeWorkspace(workspace);
});
elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  submitPrompt();
});
elements.input.addEventListener("input", resizeInput);
elements.conversation.addEventListener("scroll", () => {
  state.autoFollow = GrokUxPolicy.isNearBottom(elements.conversation);
  if (state.autoFollow) state.hasUnseenUpdates = false;
  renderLatestState();
});
elements.jumpToLatest.addEventListener("click", () => {
  state.autoFollow = true;
  scrollToBottom(true);
});
elements.cancelQueueEdit.addEventListener("click", cancelQueueEdit);
elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submitPrompt();
  }
});
elements.stop.addEventListener("click", async () => {
  const response = await api.cancel();
  if (!response.ok) return showError(response.error.message);
  renderRecoverablePrompt(response.data);
  if (!elements.input.value.trim() && !state.attachments.length && !state.editingQueueId) {
    await consumeRecoveredPrompt();
  }
});
elements.restorePrompt.addEventListener("click", () => consumeRecoveredPrompt());
elements.dismissRecoveredPrompt.addEventListener("click", () => consumeRecoveredPrompt({ fill: false }));
elements.interruptSend.addEventListener("click", () => submitPrompt(true));
$("#clear-prompt-queue").addEventListener("click", async () => {
  if (!state.promptQueue.length || !window.confirm(`清空 ${state.promptQueue.length} 条待执行指令？`)) return;
  const response = await api.clearQueuedPrompts();
  if (!response.ok) showError(response.error.message);
});
$("#show-diagnostics").addEventListener("click", () => {
  elements.diagnosticPanel.hidden = !elements.diagnosticPanel.hidden;
});
$("#clear-diagnostics").addEventListener("click", () => {
  state.diagnostics = "";
  elements.diagnosticText.textContent = "";
  elements.diagnosticPanel.hidden = true;
});
elements.login.addEventListener("click", populateAuthDialog);
elements.permissionDialog.addEventListener("cancel", async (event) => {
  event.preventDefault();
  if (state.pendingPermission) await api.replyPermission(state.pendingPermission.id, null);
  state.pendingPermission = null;
  elements.permissionDialog.close();
  updateControls();
});
elements.trustDialog.addEventListener("cancel", async (event) => {
  event.preventDefault();
  if (state.pendingTrust) await api.replyFolderTrust(state.pendingTrust.id, false);
  state.pendingTrust = null;
  elements.trustDialog.close();
});
elements.authMethod.addEventListener("change", () => {
  elements.authDescription.textContent = elements.authMethod.selectedOptions[0]?.dataset.description || "";
});
$("#authenticate-button").addEventListener("click", async () => {
  const response = await api.authenticate(elements.authMethod.value);
  elements.authDialog.close();
  if (!response.ok) return showError(response.error.message);
  state.connected = Boolean(response.data?.connected);
  applyConnectionData(response.data);
  setStatus(state.connected ? "ready" : "cli-ready");
  updateControls();
  if (state.connected) elements.input.focus();
});
$("#accept-trust").addEventListener("click", async () => {
  if (state.pendingTrust) await api.replyFolderTrust(state.pendingTrust.id, true);
  state.pendingTrust = null;
  elements.trustDialog.close();
});
$("#reject-trust").addEventListener("click", async () => {
  if (state.pendingTrust) await api.replyFolderTrust(state.pendingTrust.id, false);
  state.pendingTrust = null;
  elements.trustDialog.close();
});

elements.modelSelector.addEventListener("change", async () => {
  const previous = state.modelState.currentModelId;
  const modelId = elements.modelSelector.value;
  state.modelSettingsBusy = true;
  updateControls();
  try {
    const response = await api.setModel(modelId, null);
    if (response.ok) renderModelState(response.data);
    else {
      elements.modelSelector.value = previous || "";
      showError(response.error.message);
    }
  } finally {
    state.modelSettingsBusy = false;
    updateControls();
  }
});
elements.effortSelector.addEventListener("input", () => {
  state.effortSelectionKnown = true;
  renderEffortPreview();
});
elements.effortSelector.addEventListener("change", async () => {
  const effort = state.effortOptions[Number(elements.effortSelector.value)];
  if (!effort || state.modelSettingsBusy) return;
  state.modelSettingsBusy = true;
  updateControls();
  try {
    const response = await api.setModel(state.modelState.currentModelId, effort.value);
    if (response.ok) renderModelState(response.data);
    else {
      renderModelState({});
      showError(response.error.message);
    }
  } finally {
    state.modelSettingsBusy = false;
    updateControls();
  }
});
elements.modelSettingsButton.addEventListener("click", positionModelSettings);
elements.modelSettingsPopover.addEventListener("toggle", (event) => {
  elements.modelSettingsButton.setAttribute("aria-expanded", String(event.newState === "open"));
});
window.addEventListener("resize", () => {
  if (elements.modelSettingsPopover.matches(":popover-open")) positionModelSettings();
});
elements.modeSelector.addEventListener("change", async () => {
  const previous = state.modeState.currentModeId;
  const response = await api.setMode(elements.modeSelector.value);
  if (response.ok) renderModeState(response.data);
  else {
    elements.modeSelector.value = previous || "";
    showError(response.error.message);
  }
});
elements.permissionModeSelector.addEventListener("change", async () => {
  const previous = state.permissionMode;
  const response = await api.setPermissionMode(elements.permissionModeSelector.value);
  if (response.ok) renderPermissionMode(response.data.mode);
  else {
    renderPermissionMode(previous);
    showError(response.error.message);
  }
});
$("#session-tools-button").addEventListener("click", openSessionTools);
$("#close-session-tools").addEventListener("click", () => elements.sessionToolsDialog.close());
$("#compact-session").addEventListener("click", async () => {
  const button = $("#compact-session");
  button.disabled = true;
  const response = await api.compactSession($("#compact-context").value);
  button.disabled = false;
  if (!response.ok) return showError(response.error.message);
  $("#compact-context").value = "";
  $("#session-info-summary").textContent = "上下文压缩完成";
  const info = await api.getSessionInfo();
  if (info.ok) renderSessionInfo(info.data);
});
$("#flush-memory").addEventListener("click", async () => {
  const button = $("#flush-memory");
  button.disabled = true;
  const response = await api.flushMemory();
  button.disabled = false;
  $("#session-info-summary").textContent = response.ok ? "长期记忆已刷新" : response.error.message;
});
$("#load-rewind-points").addEventListener("click", async () => {
  elements.rewindState.hidden = false;
  elements.rewindState.textContent = "正在读取回退点...";
  const [response, history] = await Promise.all([api.getRewindPoints(), api.getPromptHistory(true)]);
  response.ok
    ? renderRewindPoints(response.data, history.ok ? history.data?.prompts || [] : [])
    : (elements.rewindState.textContent = response.error.message);
});

$("#sessions-button").addEventListener("click", async () => {
  elements.sessionSearch.value = "";
  elements.sessionsDialog.showModal();
  elements.sessionSearch.focus();
  await refreshSessions();
});
elements.sidebarToggle.addEventListener("click", () => {
  if (!narrowNavigation.matches) setSidebarCollapsed(!state.sidebarCollapsed);
});
const narrowNavigation = window.matchMedia("(max-width: 920px)");
const navigationToggle = $("#mobile-sidebar-toggle");
const navigationBackdrop = $("#desktop-sidebar-backdrop");
const desktopSidebar = $("#desktop-sidebar");

function setNavigationOpen(open, { restoreFocus = true } = {}) {
  const expanded = narrowNavigation.matches && Boolean(open);
  document.documentElement.dataset.sidebarCollapsed = String(!narrowNavigation.matches && state.sidebarCollapsed);
  document.documentElement.dataset.navigationOpen = String(expanded);
  navigationToggle.setAttribute("aria-expanded", String(expanded));
  navigationBackdrop.hidden = !expanded;
  desktopSidebar.inert = narrowNavigation.matches && !expanded;
  $(".main-pane").inert = expanded;
  if (expanded) {
    elements.sidebarMore.hidePopover();
    requestAnimationFrame(() => elements.sidebarToggle.focus());
  } else if (restoreFocus && narrowNavigation.matches) {
    navigationToggle.focus();
  }
}

navigationToggle.addEventListener("click", () => setNavigationOpen(true));
navigationBackdrop.addEventListener("click", () => setNavigationOpen(false));
elements.sidebarToggle.addEventListener("click", () => {
  if (narrowNavigation.matches) setNavigationOpen(false);
});
narrowNavigation.addEventListener("change", () => setNavigationOpen(false, { restoreFocus: false }));
document.addEventListener("keydown", (event) => {
  if (document.documentElement.dataset.navigationOpen !== "true") return;
  if (event.key === "Escape" && elements.sidebarMore.matches(":popover-open")) return;
  if (event.key === "Escape") setNavigationOpen(false);
  if (event.key === "Tab") {
    const controls = [...desktopSidebar.querySelectorAll("button:not(:disabled):not([hidden]), summary, input:not(:disabled)")]
      .filter((element) => element.getClientRects().length);
    const first = controls[0];
    const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
});
elements.newSession.addEventListener("click", () => setNavigationOpen(false, { restoreFocus: false }));
elements.workspaceList.addEventListener("click", (event) => {
  if (event.target.closest(".workspace-select, .workspace-session, .workspace-new-session")) setNavigationOpen(false, { restoreFocus: false });
});
document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    if (elements.input.disabled) return;
    elements.input.value = button.dataset.prompt;
    elements.input.dispatchEvent(new Event("input", { bubbles: true }));
    elements.input.focus();
  });
});
setNavigationOpen(false, { restoreFocus: false });
elements.sidebarMore.addEventListener("toggle", (event) => {
  const open = event.newState === "open";
  $("#sidebar-menu-button").setAttribute("aria-expanded", String(open));
  if (open) elements.sidebarMore.querySelector("button:not(:disabled)")?.focus();
});
elements.sidebarMore.addEventListener("click", (event) => {
  if (event.target.closest("button")) elements.sidebarMore.hidePopover();
});
$("#rail-projects").addEventListener("click", () => {
  setSidebarCollapsed(false);
  const target = elements.newSession.disabled ? elements.workspaceButton : elements.newSession;
  target.focus();
});
document.querySelectorAll("[data-sidebar-action]").forEach((button) => {
  button.addEventListener("click", () => $("#" + button.dataset.sidebarAction).click());
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !$("dialog[open]")) {
    event.preventDefault();
    elements.sidebarSearch.click();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n" && !$("dialog[open]")) {
    event.preventDefault();
    elements.newSession.click();
  }
});
$("#close-sessions-dialog").addEventListener("click", () => elements.sessionsDialog.close());
elements.sessionSearch.addEventListener("input", () => {
  clearTimeout(state.sessionSearchTimer);
  state.sessionSearchTimer = setTimeout(refreshSessions, 250);
});

$("#usage-button").addEventListener("click", async () => {
  elements.usageDialog.showModal();
  await refreshBilling();
});
$("#close-usage-dialog").addEventListener("click", () => elements.usageDialog.close());
$("#refresh-usage").addEventListener("click", refreshBilling);
$("#manage-billing").addEventListener("click", () => api.openExternal("https://grok.com/?_s=usage"));

$("#models-button").addEventListener("click", openModelsDialog);
$("#close-models-dialog").addEventListener("click", async () => {
  if (await applyPendingModelConfig()) elements.modelsDialog.close();
});
elements.applyModelConfig.addEventListener("click", applyPendingModelConfig);
$("#close-model-check-dialog").addEventListener("click", () => elements.modelCheckDialog.close());
$("#cancel-model-check").addEventListener("click", () => elements.modelCheckDialog.close());
elements.runModelCheckButton.addEventListener("click", runModelCheck);
document.querySelectorAll("[data-model-check-mode]").forEach((button) => {
  button.addEventListener("click", () => setModelCheckMode(button.dataset.modelCheckMode));
});
$("#close-model-conflict").addEventListener("click", () => {
  state.pendingModelConflict = null;
  elements.modelConflictDialog.close();
});
$("#keep-manual-model").addEventListener("click", () => resolveModelConflict("manual"));
$("#rename-client-model").addEventListener("click", () => resolveModelConflict("rename"));
$("#use-client-model").addEventListener("click", () => resolveModelConflict("client"));
$("#new-provider").addEventListener("click", () => openProviderForm());
$("#cancel-provider").addEventListener("click", closeModelForms);
$("#cancel-provider-model").addEventListener("click", closeModelForms);
function updateAutomaticModelId() {
  if (elements.providerModelId.dataset.auto !== "true") return;
  const effectiveModel = elements.providerModelValue.value.trim() || elements.providerModelName.value.trim();
  const usedIds = new Set(state.modelProviders.flatMap((provider) => provider.models.map((model) => model.id)));
  elements.providerModelId.value = uniqueConfigId(
    `${elements.modelProviderId.value}-${effectiveModel}`,
    usedIds,
    "model",
  );
}
elements.providerModelName.addEventListener("input", updateAutomaticModelId);
elements.providerModelValue.addEventListener("input", updateAutomaticModelId);
elements.providerModelId.addEventListener("input", () => { elements.providerModelId.dataset.auto = "false"; });
elements.providerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = elements.providerForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  const response = await api.saveModelProvider({
    id: elements.providerId.value || uniqueConfigId(
      elements.providerName.value,
      new Set(state.modelProviders.map((provider) => provider.id)),
      "provider",
    ),
    name: elements.providerName.value,
    apiBackend: elements.providerBackend.value,
    baseUrl: elements.providerBaseUrl.value,
    apiKey: elements.providerApiKey.value,
    clearApiKey: elements.providerClearKey.checked,
  });
  submit.disabled = false;
  applyProviderMutation(response, () => elements.providerForm.requestSubmit());
});
elements.providerModelForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = elements.providerModelForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  const modelValue = elements.providerModelValue.value.trim() || elements.providerModelName.value.trim();
  const response = await api.saveProviderModel(elements.modelProviderId.value, {
    originalId: elements.modelOriginalId.value,
    id: elements.providerModelId.value || configId(`${elements.modelProviderId.value}-${modelValue}`, "model"),
    name: elements.providerModelName.value,
    model: modelValue,
    apiBackend: elements.providerModelBackend.value,
    contextWindow: elements.providerModelContext.value,
    maxCompletionTokens: elements.providerModelMaxOutput.value,
    temperature: elements.providerModelTemperature.value,
    topP: elements.providerModelTopP.value,
  });
  submit.disabled = false;
  applyProviderMutation(response, () => elements.providerModelForm.requestSubmit());
});

$("#extensions-button").addEventListener("click", async () => {
  elements.extensionsDialog.showModal();
  await selectExtensionTab(state.extensionTab);
});
$("#close-extensions-dialog").addEventListener("click", () => elements.extensionsDialog.close());
document.querySelectorAll("[data-extension-tab]").forEach((button) => {
  button.addEventListener("click", () => selectExtensionTab(button.dataset.extensionTab));
});
$("#refresh-mcp").addEventListener("click", () => refreshMcp(false));
$("#refresh-skills").addEventListener("click", refreshSkills);
$("#refresh-plugins").addEventListener("click", refreshPlugins);
$("#refresh-marketplace").addEventListener("click", async () => {
  const response = await api.changeMarketplace("refresh", {});
  if (!response.ok) return showError(responseError(response));
  await refreshMarketplace();
});
$("#refresh-hooks").addEventListener("click", refreshHooks);
$("#mcp-type").addEventListener("change", () => {
  const http = $("#mcp-type").value === "http";
  $("#mcp-endpoint").placeholder = http ? "https://example.com/mcp" : "启动命令";
  $("#mcp-args").hidden = http;
});
$("#mcp-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const type = $("#mcp-type").value;
  const args = ($("#mcp-args").value.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((value) => value.replace(/^"|"$/g, ""));
  const response = await api.saveMcp({
    type,
    serverName: $("#mcp-name").value,
    ...(type === "http" ? { url: $("#mcp-endpoint").value } : { command: $("#mcp-endpoint").value, args }),
  });
  if (!response.ok) return showError(responseError(response));
  event.currentTarget.reset();
  $("#mcp-args").hidden = false;
  await refreshMcp(false);
});
$("#skill-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await api.changeSkill("add", { path: $("#skill-path").value });
  if (!response.ok) return showError(responseError(response));
  event.currentTarget.reset();
  await refreshSkills();
});
$("#plugin-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await api.changePlugin("add", { path: $("#plugin-path").value });
  if (!response.ok) return showError(responseError(response));
  event.currentTarget.reset();
  await refreshPlugins();
});
$("#marketplace-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await api.changeMarketplace("add_source", { url: $("#marketplace-url").value });
  if (!response.ok) return showError(responseError(response));
  event.currentTarget.reset();
  await refreshMarketplace();
});
$("#hook-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await api.changeHook("add", { path: $("#hook-path").value });
  if (!response.ok) return showError(responseError(response));
  event.currentTarget.reset();
  await refreshHooks();
});
$("#toggle-hook-trust").addEventListener("click", async () => {
  const response = await api.changeHook(state.hooksTrusted ? "untrust" : "trust", {});
  if (!response.ok) return showError(responseError(response));
  await refreshHooks();
});

$("#work-button").addEventListener("click", async () => {
  elements.workDialog.showModal();
  await refreshRunningWork();
});
$("#close-work-dialog").addEventListener("click", () => elements.workDialog.close());
$("#refresh-work").addEventListener("click", refreshRunningWork);

$("#account-button").addEventListener("click", async () => {
  elements.accountDialog.showModal();
  await Promise.all([
    refreshAccountInfo(), refreshOfficialCli(),
    ...(state.connected ? [refreshPromptHistory(), refreshProjectRules()] : []),
  ]);
});
$("#settings-button").addEventListener("click", () => openSettings("grok-build"));
$("#open-official-cli-settings").addEventListener("click", () => openSettings("grok-build"));
$("#close-settings-dialog").addEventListener("click", () => elements.settingsDialog.close());
document.querySelectorAll("[data-settings-section]").forEach((button) => {
  button.addEventListener("click", () => openSettings(button.dataset.settingsSection));
});
$("#settings-open-cli").addEventListener("click", () => {
  elements.settingsDialog.close();
  $("#account-button").click();
});
$("#settings-open-appearance").addEventListener("click", () => {
  elements.settingsDialog.close();
  $("#background-button").click();
});
$("#settings-open-workspaces").addEventListener("click", () => {
  elements.settingsDialog.close();
  $("#workspace-button").click();
});
$("#settings-open-mobile").addEventListener("click", () => {
  elements.settingsDialog.close();
  $("#remote-details").click();
});
$("#settings-open-account").addEventListener("click", () => {
  elements.settingsDialog.close();
  $("#account-button").click();
});
$("#settings-open-diagnostics").addEventListener("click", () => {
  elements.settingsDialog.close();
  $("#show-diagnostics").click();
});
$("#close-account-dialog").addEventListener("click", () => elements.accountDialog.close());
elements.chooseOfficialCli.addEventListener("click", async () => {
  const response = await api.chooseOfficialCli();
  if (!response.ok) return showError(responseError(response, "无法选择官方 Grok Build CLI"));
  if (response.data) {
    state.officialCli = response.data;
    state.officialCliUpdate = null;
    renderOfficialCli();
    await connectAgent();
  }
});
elements.testOfficialCli.addEventListener("click", async () => {
  const response = await api.testOfficialCli();
  if (!response.ok) return showError(responseError(response, "官方 Grok Build CLI 不可用"));
  state.officialCli = response.data;
  renderOfficialCli();
});
elements.checkOfficialCliUpdate.addEventListener("click", async () => {
  elements.checkOfficialCliUpdate.disabled = true;
  const response = await api.checkOfficialCliUpdate();
  elements.checkOfficialCliUpdate.disabled = !state.officialCli?.available;
  if (!response.ok) return showError(responseError(response, "无法检查官方 Grok Build 更新"));
  state.officialCliUpdate = response.data;
  renderOfficialCli();
});
elements.installOfficialCliUpdate.addEventListener("click", () => {
  if (!state.officialCliUpdate?.updateAvailable) return;
  elements.officialCliUpdateDescription.textContent = `将更新官方 Grok Build 至 ${state.officialCliUpdate.latestVersion || "最新版本"}。当前连接会停止，完成后请重新连接。`;
  elements.officialCliUpdateDialog.showModal();
});
$("#cancel-official-cli-update").addEventListener("click", () => elements.officialCliUpdateDialog.close());
$("#confirm-official-cli-update").addEventListener("click", async () => {
  const confirm = $("#confirm-official-cli-update");
  confirm.disabled = true;
  const response = await api.installOfficialCliUpdate(true);
  confirm.disabled = false;
  elements.officialCliUpdateDialog.close();
  if (!response.ok) return showError(responseError(response, "官方 Grok Build 更新失败"));
  state.officialCliUpdate = null;
  await refreshOfficialCli();
  elements.officialCliUpdateState.textContent = `已更新至 ${response.data.version}，请重新连接工作区。`;
});
$("#official-cli-install-guide").addEventListener("click", () => api.openExternal("https://x.ai/cli"));
$("#refresh-prompt-history").addEventListener("click", refreshPromptHistory);
$("#save-project-rules").addEventListener("click", async () => {
  const button = $("#save-project-rules");
  button.disabled = true;
  const response = await api.saveProjectRules(elements.projectRules.value);
  button.disabled = false;
  if (!response.ok) return showError(responseError(response, "项目规则保存失败"));
  $("#project-rules-path").textContent = `${response.data.path} · 已保存，新会话生效`;
});
elements.retentionOptOut.addEventListener("change", async () => {
  elements.retentionOptOut.disabled = true;
  const requested = elements.retentionOptOut.checked;
  const response = await api.setDataRetention(requested);
  elements.retentionOptOut.disabled = false;
  if (!response.ok) {
    elements.retentionOptOut.checked = !requested;
    showError(responseError(response));
  }
});
$("#share-session").addEventListener("click", async () => {
  const button = $("#share-session");
  button.disabled = true;
  const response = await api.shareSession();
  button.disabled = false;
  if (!response.ok) return showError(responseError(response));
  const url = response.data?.share_url || response.data?.shareUrl;
  if (!url) return showError("后端没有返回分享地址");
  await api.copyText(url);
  $("#account-summary").textContent = "分享链接已复制";
});
$("#logout-account").addEventListener("click", async () => {
  if (!window.confirm("退出当前 Grok 账号？第三方 API 模型仍会保留。")) return;
  const response = await api.logout();
  if (!response.ok) return showError(responseError(response));
  await refreshAccountInfo();
});

elements.remoteToggle.addEventListener("change", () => {
  elements.remoteToggle.checked ? enableRemote(true) : disableRemote();
});
$("#remote-details").addEventListener("click", () => {
  if (state.controlInfo.running) elements.remoteDialog.showModal();
  else enableRemote(true);
});
$("#close-remote-dialog").addEventListener("click", () => elements.remoteDialog.close());
$("#disable-remote").addEventListener("click", disableRemote);
$("#refresh-pairing").addEventListener("click", async () => {
  const response = await api.rotatePairing();
  if (response.ok) renderControlInfo(response.data);
  else showError(response.error.message);
});
$("#copy-remote-url").addEventListener("click", async () => {
  const url = state.remoteSelectedUrl || state.controlInfo.url;
  if (!url) return;
  await api.copyText(url);
  elements.remoteStatus.textContent = "地址已复制";
  setTimeout(() => renderControlInfo(state.controlInfo), 1200);
});
elements.remoteAddress.addEventListener("change", () => {
  state.remoteSelectedUrl = elements.remoteAddress.value;
  renderControlInfo(state.controlInfo);
});

$("#background-button").addEventListener("click", () => elements.backgroundDialog.showModal());
$("#close-background-dialog").addEventListener("click", () => elements.backgroundDialog.close());
$("#done-background").addEventListener("click", () => elements.backgroundDialog.close());
document.querySelectorAll(".theme-picker [data-theme]").forEach((button) => {
  button.addEventListener("click", () => applyTheme(button.dataset.theme));
});
elements.backgroundPreview.addEventListener("click", async () => {
  const response = await api.chooseBackground();
  if (response.ok && response.data) applyBackground(response.data);
  else if (!response.ok) showError(response.error.message);
});
document.querySelectorAll("[data-position]").forEach((button) => {
  button.addEventListener("click", async () => {
    const response = await api.updateBackground({ position: button.dataset.position });
    if (response.ok) applyBackground(response.data);
  });
});
document.querySelectorAll("[data-fit]").forEach((button) => {
  button.addEventListener("click", async () => {
    const response = await api.updateBackground({ fit: button.dataset.fit });
    if (response.ok) applyBackground(response.data);
  });
});
$("#reset-background").addEventListener("click", async () => {
  const response = await api.resetBackground();
  if (response.ok) {
    applyTheme("mist");
    applyBackground(response.data);
  }
});
document.querySelectorAll("[data-choose-avatar]").forEach((button) => {
  button.addEventListener("click", async () => {
    const response = await api.chooseAvatar(button.dataset.chooseAvatar);
    if (response.ok && response.data) applyAvatars(response.data);
    else if (!response.ok) showError(response.error.message);
  });
});
document.querySelectorAll("[data-reset-avatar]").forEach((button) => {
  button.addEventListener("click", async () => {
    const response = await api.resetAvatar(button.dataset.resetAvatar);
    if (response.ok) applyAvatars(response.data);
    else showError(response.error.message);
  });
});

api.onUpdate(handleUpdate);
api.onModels(renderModelState);
api.onModes(renderModeState);
api.onPermissionMode(({ mode }) => renderPermissionMode(mode));
api.onExtensionsChanged(() => {
  if (elements.extensionsDialog.open) extensionRefreshers[state.extensionTab]?.();
});
api.onWorkChanged(() => {
  if (!elements.workDialog.open) return;
  clearTimeout(state.workRefreshTimer);
  state.workRefreshTimer = setTimeout(refreshRunningWork, 180);
});
api.onSessionLoading(() => {
  clearConversation();
  state.replaying = true;
});
api.onSessionLoadFinished(() => {
  state.replaying = false;
  settleConversationAtBottom();
});
api.onTurnError(({ message, source }) => showTurnError(message, { source }));
api.onTaskStatus((task) => {
  renderTaskStatus(task);
  updateConversationLayout();
  if (["completed", "interrupted", "failed"].includes(task?.state)) scheduleRecentSessionsRefresh(true);
});
api.onStatus(({ state: status }) => {
  if (status === "disconnected") {
    state.connected = false;
    state.cliConnected = false;
    state.busy = false;
    setStatus("disconnected", "后端已退出");
  } else {
    if (status === "cli-ready" || status === "ready") state.cliConnected = true;
    if (status === "cli-ready" || status === "switching") state.connected = false;
    setStatus(status);
  }
  updateConversationLayout();
  updateControls();
});
api.onRuntime((runtime) => {
  if (runtime.appVersion) $("#client-version").textContent = `v${runtime.appVersion}`;
  state.connected = Boolean(runtime.connected);
  state.cliConnected = Boolean(runtime.cliConnected ?? runtime.connected);
  state.busy = Boolean(runtime.busy);
  state.queueLength = Number(runtime.queueLength || 0);
  renderPromptQueue(runtime.promptQueue || []);
  state.sessionId = runtime.sessionId ?? null;
  if (runtime.avatars) applyAvatars(runtime.avatars);
  renderRecoverablePrompt(runtime.recoverablePrompt);
  renderTaskStatus(runtime.task);
  if (runtime.modelProviders) {
    state.modelProviderLabels = Object.fromEntries(runtime.modelProviders.flatMap((provider) => (
      (provider.modelIds || []).map((modelId) => [modelId, provider.name])
    )));
  }
  if (runtime.modelState) renderModelState(runtime.modelState);
  if (runtime.modeState) renderModeState(runtime.modeState);
  if (runtime.permissionMode) renderPermissionMode(runtime.permissionMode);
  if (runtime.planApprovals?.[0]) showPlanApproval(runtime.planApprovals[0]);
  if (runtime.status !== "switching" && runtime.status !== "connecting" && runtime.workspace && runtime.workspace !== state.workspace) {
    state.workspace = runtime.workspace;
    rememberWorkspace(runtime.workspace);
    setWorkspaceLabels();
  }
  updateConversationLayout();
  updateControls();
  scheduleRecentSessionsRefresh();
});
api.onRemoteUserMessage(({ text, attachments = [] }) => {
  createMessage("user", text, attachments);
  state.assistant = null;
  state.tools.clear();
});
api.onRemoteNewSession(clearConversation);
api.onDiagnostic((message) => {
  state.diagnostics = `${state.diagnostics}${message}`.slice(-30000);
  elements.diagnosticText.textContent = state.diagnostics;
  elements.diagnosticText.scrollTop = elements.diagnosticText.scrollHeight;
});
api.onPermission(showPermission);
api.onFolderTrust(showFolderTrust);
api.onPlanApproval(showPlanApproval);
api.onControlInfo(renderControlInfo);
api.onInteractionResolved(({ id, toolCallId }) => {
  if (state.pendingPermission?.id === id) {
    state.pendingPermission = null;
    if (elements.permissionDialog.open) elements.permissionDialog.close();
    updateControls();
  }
  if (state.pendingTrust?.id === id) {
    state.pendingTrust = null;
    if (elements.trustDialog.open) elements.trustDialog.close();
  }
  if (state.pendingPlanApproval && (state.pendingPlanApproval.id === id || state.pendingPlanApproval.toolCallId === toolCallId)) {
    clearPlanApproval();
  }
});

elements.approvePlan.addEventListener("click", () => submitPlanApproval("approved"));
elements.revisePlan.addEventListener("click", () => submitPlanApproval("cancelled"));
elements.abandonPlan.addEventListener("click", () => submitPlanApproval("abandoned"));
elements.deferPlan.addEventListener("click", deferPlanApproval);
elements.reopenPlanApproval.addEventListener("click", () => {
  if (state.pendingPlanApproval) showPlanApproval(state.pendingPlanApproval, { reopen: true });
});
elements.planApprovalFeedback.addEventListener("input", () => syncPlanApprovalActions(elements.approvePlan.disabled && elements.abandonPlan.disabled));
elements.planApprovalDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  deferPlanApproval();
});
elements.planApprovalDialog.addEventListener("close", renderPlanApprovalBanner);

async function initializeUi() {
  applyTheme(state.theme);
  setSidebarWidth(state.sidebarWidth);
  setSidebarCollapsed(state.sidebarCollapsed);
  bindSidebarResize();
  setWorkspaceLabels();
  setStatus("idle");
  updateControls();
  const [control, background, avatars, capabilities] = await Promise.all([
    api.getControlStatus(), api.getBackground(), api.getAvatars(), api.getCapabilities(),
  ]);
  if (control.ok) renderControlInfo(control.data);
  if (background.ok) applyBackground(background.data);
  if (avatars.ok) applyAvatars(avatars.data);
  if (capabilities.ok) applyConnectionData(capabilities.data);
  await connectAgent();
  scheduleRecentSessionsRefresh(true);
}

initializeUi();
