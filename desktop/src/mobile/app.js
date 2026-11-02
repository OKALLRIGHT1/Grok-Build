/* global DOMPurify, GrokAttachmentIngest, GrokLayoutPolicy, GrokMarkdownDisplay, GrokMobileLayout, GrokMobileSessionSync, GrokToolPresentation, GrokUxPolicy, lucide, marked */

const STREAM_RENDER_DELAY = 100;
const TOOL_RENDER_DELAY = 120;

const state = {
  token: localStorage.getItem("grok-remote.token"),
  socket: null,
  connectedOnce: false,
  runtime: { connected: false, busy: false, status: "idle" },
  assistant: null,
  tools: new Map(),
  pending: new Map(),
  nextRequestId: 1,
  pendingPermission: null,
  pendingTrust: null,
  pendingPlanApproval: null,
  attachments: [],
  lastTurnError: "",
  promptSubmitting: false,
  editingQueueId: null,
  avatars: { user: null, assistant: null },
  recoverablePrompt: null,
  replaying: false,
  scrollScheduled: false,
  autoFollow: true,
  hasUnseenUpdates: false,
  layoutMode: GrokMobileLayout.classifyViewport({ width: innerWidth, height: innerHeight }),
  landscapePanels: GrokMobileLayout.readPanelState(localStorage),
  drawerOpen: null,
  panelTrigger: null,
  taskStatus: null,
  taskStatusTimer: null,
  sessionSync: GrokMobileSessionSync.createSyncState(),
  syncRequestedFor: null,
  syncStatus: "",
};

const $ = (selector) => document.querySelector(selector);
const elements = {
  pairView: $("#pair-view"),
  appView: $("#app-view"),
  pairForm: $("#pair-form"),
  pairCode: $("#pair-code"),
  pairButton: $("#pair-button"),
  pairError: $("#pair-error"),
  navigationPanel: $("#navigation-panel"),
  controlsPanel: $("#controls-panel"),
  panelBackdrop: $("#panel-backdrop"),
  sessionsButton: $("#sessions"),
  controlsButton: $("#controls"),
  closeNavigation: $("#close-navigation"),
  closeControls: $("#close-controls"),
  navigationWorkspace: $("#navigation-workspace"),
  panelNewSession: $("#panel-new-session"),
  workspace: $("#workspace-name"),
  connectionDot: $("#connection-dot"),
  connectionLabel: $("#connection-label"),
  conversation: $("#conversation"),
  emptyState: $("#empty-state"),
  emptyWorkspace: $("#empty-workspace"),
  messageList: $("#message-list"),
  composer: $("#composer"),
  prompt: $("#prompt"),
  send: $("#send"),
  attachmentButton: $("#attachment-button"),
  attachmentInput: $("#attachment-input"),
  attachmentList: $("#attachment-list"),
  stop: $("#stop"),
  interruptSend: $("#mobile-interrupt-send"),
  promptQueue: $("#mobile-prompt-queue"),
  promptQueueList: $("#mobile-prompt-queue-list"),
  recoverPrompt: $("#mobile-recover-prompt"),
  recoverPromptLabel: $("#mobile-recover-prompt-label"),
  restorePrompt: $("#mobile-restore-prompt"),
  dismissRecoveredPrompt: $("#mobile-dismiss-recovered-prompt"),
  mobileTaskStatus: $("#mobile-task-status"),
  mobileTaskStatusIcon: $("#mobile-task-status-icon"),
  mobileTaskStatusLabel: $("#mobile-task-status-label"),
  taskState: $("#task-state"),
  composerSubmitMode: $("#mobile-composer-submit-mode"),
  cancelQueueEdit: $("#mobile-cancel-queue-edit"),
  jumpToLatest: $("#mobile-jump-to-latest"),
  permissionDialog: $("#permission-dialog"),
  permissionDescription: $("#permission-description"),
  permissionCommand: $("#permission-command"),
  permissionDetails: $("#mobile-permission-details"),
  permissionRisk: $("#mobile-permission-risk"),
  permissionTarget: $("#mobile-permission-target"),
  permissionOptions: $("#permission-options"),
  trustDialog: $("#trust-dialog"),
  trustDescription: $("#trust-description"),
  trustKinds: $("#trust-kinds"),
  planApprovalDialog: $("#mobile-plan-approval-dialog"),
  planApprovalSession: $("#mobile-plan-approval-session"),
  planApprovalContent: $("#mobile-plan-approval-content"),
  planApprovalFeedback: $("#mobile-plan-approval-feedback"),
  planApprovalStatus: $("#mobile-plan-approval-status"),
  approvePlan: $("#mobile-approve-plan"),
  revisePlan: $("#mobile-revise-plan"),
  abandonPlan: $("#mobile-abandon-plan"),
  deferPlan: $("#mobile-defer-plan"),
  planApprovalBanner: $("#mobile-plan-approval-banner"),
  reopenPlanApproval: $("#mobile-reopen-plan-approval"),
  mobileModel: $("#mobile-model"),
  mobileMode: $("#mobile-mode"),
  mobileUsage: $("#mobile-usage"),
  mobileSessions: $("#mobile-sessions"),
  mobileWork: $("#mobile-work"),
  syncStatus: $("#mobile-sync-status"),
  retrySync: $("#mobile-retry-sync"),
};

marked.setOptions({ breaks: true, gfm: true });
lucide.createIcons();

function panelState() {
  return {
    mode: state.layoutMode,
    landscapePanels: state.landscapePanels,
    drawerOpen: state.drawerOpen,
  };
}

function panelElement(side) {
  return side === "left" ? elements.navigationPanel : elements.controlsPanel;
}

function panelButton(side) {
  return side === "left" ? elements.sessionsButton : elements.controlsButton;
}

function renderPanelState({ focusPanel = null, restoreFocus = null } = {}) {
  const landscape = state.layoutMode === "tablet-landscape";
  const leftOpen = GrokMobileLayout.isPanelOpen(panelState(), "left");
  const rightOpen = GrokMobileLayout.isPanelOpen(panelState(), "right");
  elements.appView.dataset.layout = state.layoutMode;
  elements.appView.classList.toggle("left-open", leftOpen);
  elements.appView.classList.toggle("right-open", rightOpen);
  elements.navigationPanel.classList.toggle("is-open", leftOpen);
  elements.controlsPanel.classList.toggle("is-open", rightOpen);
  elements.navigationPanel.setAttribute("aria-hidden", String(!landscape && !leftOpen));
  elements.controlsPanel.setAttribute("aria-hidden", String(!landscape && !rightOpen));
  elements.sessionsButton.setAttribute("aria-expanded", String(leftOpen));
  elements.controlsButton.setAttribute("aria-expanded", String(rightOpen));
  elements.panelBackdrop.hidden = landscape || (!leftOpen && !rightOpen);
  elements.navigationPanel.inert = !landscape && !leftOpen;
  elements.controlsPanel.inert = !landscape && !rightOpen;
  const drawerOpen = !landscape && (leftOpen || rightOpen);
  $(".chat-column").inert = drawerOpen;
  $(".mobile-header").inert = drawerOpen;

  const navigationIcon = leftOpen ? "panel-left-close" : "panel-left-open";
  const controlsIcon = rightOpen ? "panel-right-close" : "panel-right-open";
  elements.closeNavigation.title = leftOpen ? "收起会话栏" : "展开会话栏";
  elements.closeNavigation.setAttribute("aria-label", elements.closeNavigation.title);
  elements.closeNavigation.innerHTML = `<i data-lucide="${navigationIcon}"></i>`;
  elements.closeControls.title = rightOpen ? "收起控制栏" : "展开控制栏";
  elements.closeControls.setAttribute("aria-label", elements.closeControls.title);
  elements.closeControls.innerHTML = `<i data-lucide="${controlsIcon}"></i>`;
  lucide.createIcons({ nodes: [elements.closeNavigation, elements.closeControls] });

  if (focusPanel && !landscape) {
    requestAnimationFrame(() => {
      panelElement(focusPanel).querySelector("button:not(:disabled), select:not(:disabled)")?.focus();
    });
  } else if (restoreFocus) {
    requestAnimationFrame(() => restoreFocus.focus());
  }
}

function setPanelOpen(side, open, trigger = null) {
  const wasOverlayOpen = state.layoutMode !== "tablet-landscape" && state.drawerOpen === side;
  const next = GrokMobileLayout.changePanelState(panelState(), side, open);
  state.landscapePanels = next.landscapePanels;
  state.drawerOpen = next.drawerOpen;
  if (state.layoutMode === "tablet-landscape") {
    state.landscapePanels = GrokMobileLayout.writePanelState(localStorage, state.landscapePanels);
  } else if (open) {
    state.panelTrigger = trigger || panelButton(side);
  }
  const restoreFocus = !open && wasOverlayOpen ? state.panelTrigger : null;
  if (!open && wasOverlayOpen) state.panelTrigger = null;
  renderPanelState({ focusPanel: open ? side : null, restoreFocus });
}

function togglePanel(side, trigger) {
  setPanelOpen(side, !GrokMobileLayout.isPanelOpen(panelState(), side), trigger);
}

function closeDrawer() {
  if (state.layoutMode === "tablet-landscape" || !state.drawerOpen) return;
  setPanelOpen(state.drawerOpen, false);
}

function updateLayoutMode() {
  const mode = GrokMobileLayout.classifyViewport({ width: innerWidth, height: innerHeight });
  if (mode !== state.layoutMode) state.drawerOpen = null;
  state.layoutMode = mode;
  renderPanelState();
}

function showPair(error = "") {
  elements.appView.hidden = true;
  elements.pairView.hidden = false;
  elements.pairError.textContent = error;
  elements.pairError.hidden = !error;
  setTimeout(() => elements.pairCode.focus(), 0);
}

function showApp() {
  elements.pairView.hidden = true;
  elements.appView.hidden = false;
  updateLayoutMode();
}

async function pair(code) {
  elements.pairButton.disabled = true;
  elements.pairError.hidden = true;
  try {
    const response = await fetch("/api/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "配对失败");
    state.token = result.token;
    localStorage.setItem("grok-remote.token", state.token);
    history.replaceState({}, "", "/");
    connect();
  } catch (error) {
    showPair(error.message);
  } finally {
    elements.pairButton.disabled = false;
  }
}

function connect() {
  if (!state.token) {
    showPair();
    return;
  }
  showApp();
  elements.connectionLabel.textContent = "正在连接";
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${location.host}/control?token=${encodeURIComponent(state.token)}`);
  state.socket = socket;
  let opened = false;

  socket.addEventListener("open", () => {
    opened = true;
    state.connectedOnce = true;
    elements.connectionLabel.textContent = "已连接到电脑";
  });
  socket.addEventListener("message", (event) => {
    try {
      handleMessage(JSON.parse(event.data));
    } catch {
      showError("收到无法解析的电脑消息");
    }
  });
  socket.addEventListener("close", () => {
    if (state.socket !== socket) return;
    state.socket = null;
    elements.connectionDot.classList.remove("ready");
    elements.connectionLabel.textContent = "连接已断开";
    updateControls();
    if (!opened) {
      state.token = null;
      localStorage.removeItem("grok-remote.token");
      showPair("配对已失效，请在电脑端获取新配对码");
      return;
    }
    setTimeout(() => state.token && connect(), 2000);
  });
}

function setSyncStatus(message = "", retry = false) {
  state.syncStatus = message;
  elements.syncStatus.hidden = !message;
  elements.syncStatus.querySelector("span").textContent = message;
  elements.retrySync.hidden = !retry;
}

function requestSessionSync(sessionId = state.runtime.sessionId, { force = false } = {}) {
  if (!sessionId || (!force && state.syncRequestedFor === sessionId)) return;
  state.syncRequestedFor = sessionId;
  setSyncStatus("正在同步完整对话");
  sendAction("session-sync-request", { sessionId }).catch((error) => {
    state.syncRequestedFor = null;
    setSyncStatus(error.code === "STALE_SESSION" ? "会话已切换，请重新同步" : "完整对话同步失败", true);
  });
}

function applyLedgerEntry(entry) {
  if (!entry?.type) return;
  if (entry.type === "user-message") {
    createMessage("user", entry.data?.text, entry.data?.attachments || []);
    state.assistant = null;
    state.tools.clear();
  } else if (entry.type === "agent-update") {
    handleAgentUpdate(entry.data);
  } else if (entry.type === "task-status") {
    renderTaskStatus(entry.data);
  }
}

function applyLiveEvent(type, data) {
  const entry = data?.entry;
  if (!entry) {
    applyLedgerEntry({ type, data });
    return;
  }
  const accepted = GrokMobileSessionSync.acceptLive(state.sessionSync, entry);
  if (accepted) applyLedgerEntry(accepted);
}

function beginSessionSync(data) {
  GrokMobileSessionSync.beginSync(state.sessionSync, data);
  resetConversation();
  state.replaying = true;
  setSyncStatus("正在同步完整对话");
}

function acceptSessionSyncChunk(data) {
  GrokMobileSessionSync.acceptChunk(state.sessionSync, data).forEach(applyLedgerEntry);
}

function completeSessionSync(data) {
  GrokMobileSessionSync.completeSync(state.sessionSync, data).forEach(applyLedgerEntry);
  state.replaying = false;
  setSyncStatus("");
  settleConversationAtBottom();
}

function handleMessage(message) {
  const { type, data } = message;
  switch (type) {
    case "snapshot":
    case "state":
      state.runtime = { ...state.runtime, ...data };
      renderRuntime();
      requestSessionSync(data.sessionId);
      if (data.planApprovals?.[0]) showPlanApproval(data.planApprovals[0]);
      break;
    case "session-loading":
      resetConversation();
      state.replaying = true;
      break;
    case "session-load-finished":
      state.replaying = false;
      settleConversationAtBottom();
      break;
    case "user-message":
      applyLiveEvent("user-message", data);
      break;
    case "agent-update":
      applyLiveEvent("agent-update", data);
      break;
    case "permission":
      showPermission(data);
      break;
    case "folder-trust":
      showFolderTrust(data);
      break;
    case "plan-approval":
      showPlanApproval(data);
      break;
    case "interaction-resolved":
      if (state.pendingPermission?.id === data.id) {
        state.pendingPermission = null;
        if (elements.permissionDialog.open) elements.permissionDialog.close();
        renderRuntime();
      }
      if (state.pendingTrust?.id === data.id) {
        state.pendingTrust = null;
        if (elements.trustDialog.open) elements.trustDialog.close();
      }
      if (state.pendingPlanApproval && (state.pendingPlanApproval.id === data.id || state.pendingPlanApproval.toolCallId === data.toolCallId)) {
        clearPlanApproval();
      }
      break;
    case "action-result": {
      const pending = state.pending.get(data.requestId);
      if (!pending) break;
      state.pending.delete(data.requestId);
      clearTimeout(pending.timeout);
      if (data.ok) pending.resolve(data.result);
      else {
        const error = new Error(data.error?.message || "操作失败");
        error.code = data.error?.code || null;
        pending.reject(error);
      }
      break;
    }
    case "error":
      showError(data.message);
      break;
    case "turn-error":
      showTurnError(data.message, { source: data.source });
      break;
    case "task-status":
      applyLiveEvent("task-status", data);
      break;
    case "session-sync-begin":
      try {
        beginSessionSync(data);
      } catch (error) {
        setSyncStatus("完整对话同步失败", true);
      }
      break;
    case "session-sync-chunk":
      try {
        acceptSessionSyncChunk(data);
      } catch (error) {
        setSyncStatus("完整对话同步失败", true);
      }
      break;
    case "session-sync-complete":
      try {
        completeSessionSync(data);
      } catch (error) {
        setSyncStatus("完整对话同步失败", true);
      }
      break;
    default:
      break;
  }
}

function sendAction(action, payload = {}) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error("手机与电脑未连接"));
  const requestId = state.nextRequestId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      const pending = state.pending.get(requestId);
      if (!pending) return;
      state.pending.delete(requestId);
      reject(new Error("电脑响应超时"));
    }, 35000);
    state.pending.set(requestId, { resolve, reject, timeout });
    state.socket.send(JSON.stringify({ type: "action", requestId, action, payload }));
  });
}

function resetConversation() {
  elements.messageList.replaceChildren();
  elements.emptyState.hidden = false;
  state.assistant = null;
  state.tools.clear();
  state.lastTurnError = "";
  state.autoFollow = true;
  state.hasUnseenUpdates = false;
  updateConversationLayout();
  renderLatestState();
}

function updateConversationLayout() {
  elements.appView.dataset.conversationLayout = GrokLayoutPolicy.conversationLayout({
    messageCount: elements.messageList.children.length,
    busy: state.runtime.busy,
    queueLength: state.runtime.queueLength,
  });
}

function mobileQueueButton(icon, title, handler) {
  const button = document.createElement("button");
  button.className = "icon-button queue-icon";
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

function renderPromptQueue(items) {
  const queue = items || [];
  elements.promptQueue.hidden = !queue.length;
  elements.promptQueueList.replaceChildren();
  queue.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "mobile-queue-item";
    const copy = document.createElement("div");
    copy.className = "mobile-queue-copy";
    const text = document.createElement("strong");
    text.textContent = `${index + 1}. ${item.text}`;
    const detail = document.createElement("span");
    detail.textContent = [
      item.modelName || item.modelId,
      item.providerName,
      item.attachments?.length ? `${item.attachments.length} 个附件` : "无附件",
    ].filter(Boolean).join(" · ");
    copy.append(text, detail);
    const actions = document.createElement("div");
    actions.className = "mobile-queue-actions";
    const up = mobileQueueButton("arrow-up", "上移", () => sendAction("prompt-queue-move", { id: item.id, delta: -1 }));
    up.disabled = index === 0;
    const down = mobileQueueButton("arrow-down", "下移", () => sendAction("prompt-queue-move", { id: item.id, delta: 1 }));
    down.disabled = index === queue.length - 1;
    actions.append(
      mobileQueueButton("pencil", "编辑", () => {
        if ((elements.prompt.value.trim() || state.attachments.length) && !window.confirm("用这条待执行指令替换当前草稿？")) return;
        state.editingQueueId = item.id;
        elements.prompt.value = item.text;
        state.attachments = [];
        renderAttachments();
        updateControls();
        elements.prompt.focus();
      }),
      up,
      down,
      mobileQueueButton("forward", "打断当前任务并立即执行", () => sendAction("prompt-queue-interrupt", { id: item.id })),
      mobileQueueButton("trash-2", "删除", async () => {
        await sendAction("prompt-queue-remove", { id: item.id });
        if (state.editingQueueId === item.id) state.editingQueueId = null;
      }),
    );
    row.append(copy, actions);
    elements.promptQueueList.append(row);
  });
  if (state.editingQueueId && !queue.some((item) => item.id === state.editingQueueId)) state.editingQueueId = null;
  lucide.createIcons({ nodes: [elements.promptQueueList] });
  updateConversationLayout();
}

function cancelQueueEdit() {
  state.editingQueueId = null;
  elements.prompt.value = "";
  state.attachments = [];
  renderAttachments();
  elements.prompt.style.height = "auto";
  updateControls();
  elements.prompt.focus();
}

function renderRuntime() {
  const runtime = state.runtime;
  if (runtime.avatars) applyAvatars(runtime.avatars);
  renderRecoverablePrompt(runtime.recoverablePrompt);
  renderTaskStatus(runtime.task);
  elements.workspace.textContent = runtime.workspaceName || "未选择工作区";
  elements.navigationWorkspace.textContent = runtime.workspaceName || "未选择工作区";
  elements.emptyWorkspace.textContent = runtime.workspaceName || "等待电脑选择工作区";
  const ready = runtime.connected && state.socket?.readyState === WebSocket.OPEN;
  elements.connectionDot.classList.toggle("ready", ready);
  elements.connectionLabel.textContent = ready ? "已连接到电脑" : runtime.status === "connecting" ? "电脑正在连接" : "电脑未就绪";
  const queued = Number(runtime.queueLength || 0);
  renderPromptQueue(runtime.promptQueue || []);
  elements.taskState.textContent = state.pendingPermission
    ? "等待你确认"
    : runtime.busy
      ? queued ? `电脑正在执行 · ${queued} 条待执行` : "电脑正在执行"
    : ready ? runtime.workspaceName : "电脑未就绪";
  renderControlSelectors();
  updateConversationLayout();
  updateControls();
}

function renderControlSelectors() {
  const modelState = state.runtime.modelState || { models: [] };
  const providerLabels = Object.fromEntries((state.runtime.modelProviders || []).flatMap((provider) => (
    (provider.modelIds || []).map((modelId) => [modelId, provider.name])
  )));
  const modelSignature = (modelState.models || []).map((model) => `${model.id}:${providerLabels[model.id] || "Grok"}`).join("|");
  if (elements.mobileModel.dataset.signature !== modelSignature) {
    elements.mobileModel.replaceChildren();
    (modelState.models || []).forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.name || model.id} · ${providerLabels[model.id] || "Grok"}`;
      elements.mobileModel.append(option);
    });
    elements.mobileModel.dataset.signature = modelSignature;
  }
  elements.mobileModel.value = modelState.currentModelId || "";
  const modeState = state.runtime.modeState || { modes: [] };
  const modeSignature = (modeState.modes || []).map((mode) => mode.id).join("|");
  if (elements.mobileMode.dataset.signature !== modeSignature) {
    elements.mobileMode.replaceChildren();
    (modeState.modes || []).forEach((mode) => {
      const option = document.createElement("option");
      option.value = mode.id;
      option.textContent = mode.name || mode.id;
      elements.mobileMode.append(option);
    });
    elements.mobileMode.dataset.signature = modeSignature;
  }
  elements.mobileMode.value = modeState.currentModeId || "";
  $("#mobile-mode-row").hidden = !(modeState.modes || []).length;
}

function updateControls() {
  const ready = state.runtime.connected && state.socket?.readyState === WebSocket.OPEN;
  const composer = GrokUxPolicy.describeComposer({
    connected: ready,
    busy: state.runtime.busy,
    editing: Boolean(state.editingQueueId),
    hasContent: Boolean(elements.prompt.value.trim() || state.attachments.length),
  });
  elements.prompt.disabled = !ready || state.promptSubmitting;
  elements.send.disabled = composer.disabled || state.promptSubmitting;
  elements.send.dataset.mode = composer.mode;
  elements.send.title = composer.sendLabel;
  elements.send.setAttribute("aria-label", composer.sendLabel);
  elements.composerSubmitMode.textContent = composer.hint;
  elements.composerSubmitMode.dataset.mode = composer.mode;
  elements.cancelQueueEdit.hidden = !state.editingQueueId;
  elements.attachmentButton.disabled = !ready || state.promptSubmitting || Boolean(state.editingQueueId);
  elements.stop.hidden = !state.runtime.busy;
  elements.interruptSend.hidden = !state.runtime.busy;
  elements.interruptSend.disabled = !ready || state.promptSubmitting || (!elements.prompt.value.trim() && !state.attachments.length);
  elements.interruptSend.title = "打断并发送";
  elements.interruptSend.setAttribute("aria-label", "打断并发送");
  if (state.editingQueueId) elements.taskState.textContent = "正在编辑待执行指令";
  $("#new-session").disabled = !ready || state.runtime.busy;
  elements.panelNewSession.disabled = !ready || state.runtime.busy;
  elements.sessionsButton.disabled = !ready;
  elements.controlsButton.disabled = !ready;
}

function formatMobileDate(value) {
  if (!value) return "时间未知";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function mobileRow(titleText, detailText, actionTitle, handler, icon = "play") {
  const row = document.createElement("div");
  row.className = "mobile-resource-row";
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = titleText;
  const detail = document.createElement("span");
  detail.textContent = detailText;
  copy.append(title, detail);
  const action = document.createElement("button");
  action.className = "icon-button";
  action.type = "button";
  action.title = actionTitle;
  action.innerHTML = `<i data-lucide="${icon}"></i>`;
  action.addEventListener("click", async () => {
    action.disabled = true;
    try {
      await handler();
    } catch (error) {
      showError(error.message);
    } finally {
      action.disabled = false;
    }
  });
  row.append(copy, action);
  return row;
}

async function refreshMobileUsage() {
  elements.mobileUsage.textContent = "正在读取额度...";
  try {
    const billing = await sendAction("billing");
    if (!billing.available) {
      elements.mobileUsage.textContent = `${billing.subscriptionTier || "Grok 账号"} · 没有可显示的额度`;
      return;
    }
    const percent = Math.floor(billing.usagePercent || 0);
    const reset = billing.periodEnd ? formatMobileDate(billing.periodEnd) : "时间未知";
    const demand = billing.onDemandEnabled ? ` · 按量 $${(Number(billing.onDemandUsedCents || 0) / 100).toFixed(2)}` : "";
    elements.mobileUsage.textContent = `${billing.subscriptionTier || "Grok 账号"} · 已用 ${percent}% · ${reset} 重置${demand}`;
  } catch (error) {
    elements.mobileUsage.textContent = error.message;
  }
}

function renderSessionGroups(sessions) {
  elements.mobileSessions.replaceChildren();
  const groups = GrokMobileLayout.groupSessions(sessions);
  if (!groups.length) {
    elements.mobileSessions.textContent = "没有历史会话";
    return;
  }
  groups.forEach((group) => {
    const section = document.createElement("section");
    section.className = "session-group";
    const heading = document.createElement("div");
    heading.className = "session-group-heading";
    heading.title = group.key === "__other__" ? group.label : group.key;
    heading.textContent = group.label;
    section.append(heading);
    group.sessions.forEach((session) => {
      const current = session.id === state.runtime.sessionId;
      const row = mobileRow(
        session.title,
        [current ? "当前对话" : "", formatMobileDate(session.updatedAt), session.modelId].filter(Boolean).join(" · "),
        current ? "当前对话" : "切换到此对话",
        async () => {
          await sendAction("load-session", { id: session.id, cwd: session.cwd });
          if (state.layoutMode !== "tablet-landscape") setPanelOpen("left", false);
        },
        current ? "check" : "arrow-right",
      );
      row.classList.toggle("current", current);
      row.setAttribute("aria-current", current ? "true" : "false");
      row.querySelector("button").disabled = current;
      section.append(row);
    });
    elements.mobileSessions.append(section);
  });
  lucide.createIcons({ nodes: [elements.mobileSessions] });
}

async function refreshMobileSessions() {
  elements.mobileSessions.textContent = "正在读取历史...";
  try {
    const result = await sendAction("list-sessions");
    renderSessionGroups(result.sessions || []);
  } catch (error) {
    elements.mobileSessions.textContent = error.message;
  }
}

async function refreshMobileWork() {
  elements.mobileWork.textContent = "正在读取任务...";
  try {
    const result = await sendAction("list-running-work");
    const items = [
      ...(result.subagents || []).map((item) => ({ kind: "subagent", id: item.subagentId, title: item.description || item.subagentType, detail: `${item.subagentType} · ${item.turnCount || 0} 轮` })),
      ...(result.tasks || []).filter((item) => !item.completed).map((item) => ({ kind: "task", id: item.task_id || item.taskId, title: item.display_command || item.displayCommand || item.command, detail: item.cwd || "后台命令" })),
    ];
    elements.mobileWork.replaceChildren();
    if (!items.length) {
      elements.mobileWork.textContent = "当前没有运行中的任务";
      return;
    }
    items.forEach((item) => {
      elements.mobileWork.append(mobileRow(item.title, item.detail, "停止", async () => {
        await sendAction("stop-running-work", { kind: item.kind, id: item.id });
        await refreshMobileWork();
      }, "square"));
    });
    lucide.createIcons({ nodes: [elements.mobileWork] });
  } catch (error) {
    elements.mobileWork.textContent = error.message;
  }
}

function renderLatestState() {
  elements.jumpToLatest.hidden = state.autoFollow || !state.hasUnseenUpdates;
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
  state.autoFollow = true;
  state.hasUnseenUpdates = false;
  renderLatestState();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => scrollToBottom(true));
  });
  elements.messageList.querySelectorAll("img").forEach((image) => {
    if (!image.complete) image.addEventListener("load", () => scrollToBottom(true), { once: true });
  });
}

function renderMarkdown(container, text) {
  const normalized = GrokMarkdownDisplay.normalizeMarkdown(text || "");
  container.innerHTML = DOMPurify.sanitize(marked.parse(normalized), { USE_PROFILES: { html: true } });
  container.querySelectorAll("a").forEach((link) => {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
}

const TEXT_FILE_EXTENSIONS = new Set(["txt", "md", "json", "jsonl", "js", "ts", "tsx", "jsx", "css", "html", "xml", "yaml", "yml", "toml", "ini", "csv", "log", "py", "rs", "go", "java", "kt", "c", "h", "cpp", "hpp", "cs", "php", "rb", "sh", "ps1", "sql", "vue", "svelte"]);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isTextFile(file) {
  return file.type.startsWith("text/") || TEXT_FILE_EXTENSIONS.has(file.name.split(".").pop()?.toLowerCase());
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
  return { name: file.name, mimeType, size: file.size, kind: mimeType.startsWith("image/") ? "image" : "file", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}

function renderAttachmentChips(container, attachments, removable = false) {
  container.replaceChildren();
  attachments.forEach((attachment, index) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    if (attachment.kind === "image" && attachment.data) {
      const image = document.createElement("img");
      image.src = `data:${attachment.mimeType};base64,${attachment.data}`;
      image.alt = "";
      chip.append(image);
    } else {
      chip.innerHTML = `<i data-lucide="${attachment.kind === "image" ? "image" : "file"}"></i>`;
    }
    const label = document.createElement("span");
    label.textContent = `${attachment.name} · ${formatBytes(attachment.size || 0)}`;
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
  document.querySelectorAll(".message-avatar").forEach((element) => {
    applyAvatarElement(element, element.dataset.role || "assistant");
  });
}

function editUserPrompt(text, attachments = []) {
  state.editingQueueId = null;
  elements.prompt.value = String(text || "");
  state.attachments = JSON.parse(JSON.stringify(attachments || []));
  renderAttachments();
  elements.prompt.dispatchEvent(new Event("input"));
  elements.prompt.focus();
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
  const prompt = await sendAction("recover-prompt");
  renderRecoverablePrompt(null);
  state.runtime.recoverablePrompt = null;
  if (fill && prompt?.text != null) editUserPrompt(prompt.text, prompt.attachments || []);
}

async function addAttachments(files) {
  const incoming = [...files];
  if (state.attachments.length + incoming.length > 5) return showError("一次最多发送 5 个附件");
  if (state.attachments.reduce((sum, file) => sum + file.size, 0) + incoming.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) return showError("附件总大小不能超过 8 MB");
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
  elements.emptyState.hidden = true;
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  applyAvatarElement(avatar, role);
  const main = document.createElement("div");
  main.className = "message-main";
  const roleRow = document.createElement("div");
  roleRow.className = "message-role-row";
  if (role !== "user") {
    const roleLabel = document.createElement("div");
    roleLabel.className = "message-role";
    roleLabel.textContent = "Grok";
    roleRow.append(roleLabel);
  }
  if (role === "user") {
    const edit = document.createElement("button");
    edit.className = "icon-button message-edit";
    edit.type = "button";
    edit.title = "编辑并再次发送";
    edit.innerHTML = '<i data-lucide="pencil"></i>';
    edit.addEventListener("click", () => editUserPrompt(text, attachments));
    roleRow.append(edit);
  }
  const content = document.createElement("div");
  content.className = "message-content";
  main.append(roleRow);
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
    main.append(progress);
  }
  if (attachments.length) {
    const attachmentStrip = document.createElement("div");
    attachmentStrip.className = "message-attachments";
    renderAttachmentChips(attachmentStrip, attachments);
    main.append(attachmentStrip);
  }
  main.append(content);
  article.append(avatar, main);
  elements.messageList.append(article);
  renderMarkdown(content, text);
  lucide.createIcons({ nodes: [article] });
  updateConversationLayout();
  scrollToBottom();
  return {
    article, body: main, content, text, thought: null, thoughtText: "", renderTimer: null, thoughtTimer: null, hadTools: false,
    progress, progressLabel, finalLabel: null,
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
    elements.mobileTaskStatus.hidden = true;
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
  elements.mobileTaskStatus.hidden = false;
  elements.mobileTaskStatus.dataset.state = task.state;
  elements.mobileTaskStatusIcon.innerHTML = `<i data-lucide="${presentation.icon}"></i>`;
  elements.mobileTaskStatusLabel.textContent = presentation.label;
  lucide.createIcons({ nodes: [elements.mobileTaskStatusIcon] });
  setTurnProgress(state.assistant, presentation.progress);
  if (task.state === "started") return;
  const elapsed = Math.max(0, Date.now() - Number(task.timestamp || Date.now()));
  const remaining = Math.max(0, 5_000 - elapsed);
  state.taskStatusTimer = setTimeout(() => {
    if (state.taskStatus?.id !== task.id || state.taskStatus?.state !== task.state) return;
    elements.mobileTaskStatus.hidden = true;
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

function appendAssistant(text) {
  const assistant = ensureAssistant();
  ensureAssistantContent(assistant);
  setTurnProgress(assistant, assistant.hadTools ? "organizing" : "responding");
  assistant.text += text || "";
  scheduleAssistantRender(assistant);
}

function appendThought(text) {
  const assistant = ensureAssistant();
  if (!assistant.thought) {
    assistant.thought = document.createElement("div");
    assistant.thought.className = "thought";
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

function updateTool(update) {
  const id = toolId(update);
  let record = state.tools.get(id);
  if (!record) {
    const assistant = ensureAssistant();
    const card = document.createElement("section");
    card.className = "tool-card";
    const header = document.createElement("div");
    header.className = "tool-header";
    header.innerHTML = '<i data-lucide="wrench"></i>';
    const name = document.createElement("span");
    const status = document.createElement("span");
    status.className = "tool-status";
    const output = document.createElement("details");
    output.className = "tool-output";
    output.hidden = true;
    const outputSummary = document.createElement("summary");
    const outputText = document.createElement("pre");
    output.append(outputSummary, outputText);
    header.append(name, status);
    card.append(header, output);
    assistant.body.append(card);
    assistant.hadTools = true;
    setTurnProgress(assistant, "tools");
    sealAssistantSegment(assistant);
    lucide.createIcons({ nodes: [card] });
    record = { name, status, output, outputSummary, outputText, data: {}, renderTimer: null };
    state.tools.set(id, record);
  }
  record.data = { ...record.data, ...update };
  record.name.textContent = record.data.title || record.data.tool || "工具调用";
  const statuses = { pending: "等待中", in_progress: "执行中", completed: "已完成", failed: "失败" };
  record.status.textContent = statuses[record.data.status] || record.data.status || "执行中";
  if (!record.renderTimer) {
    record.renderTimer = setTimeout(() => {
      record.renderTimer = null;
      const presentation = GrokToolPresentation.format(record.data);
      record.outputSummary.textContent = presentation.summary;
      record.outputText.textContent = presentation.text;
      record.output.hidden = !presentation.text;
      if (!presentation.collapsed) record.output.open = true;
      scrollToBottom();
    }, TOOL_RENDER_DELAY);
  }
}

function finalizeAssistantTurn() {
  const assistant = state.assistant;
  if (!assistant) return;
  flushAssistantRender(assistant);
  state.tools.forEach((record) => {
    if (!record.renderTimer) return;
    clearTimeout(record.renderTimer);
    record.renderTimer = null;
    const presentation = GrokToolPresentation.format(record.data);
    record.outputSummary.textContent = presentation.summary;
    record.outputText.textContent = presentation.text;
    record.output.hidden = !presentation.text;
  });
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

function handleAgentUpdate(params) {
  const update = params?.update && typeof params.update === "object" ? params.update : params;
  if (!update?.sessionUpdate) return;
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      appendAssistant(update.content?.text);
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
    case "tool_call_update":
      updateTool(update);
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

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function showError(message, options = {}) {
  elements.emptyState.hidden = true;
  const presentation = GrokUxPolicy.describeError(message || "操作失败", options);
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
    await copyText(presentation.details);
    copy.textContent = "已复制";
  });
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
  renderRuntime();
  (request.options || []).forEach((option) => {
    const button = document.createElement("button");
    const kind = String(option.kind || option.optionKind || "").toLowerCase();
    button.className = `permission-option ${kind.includes("reject") ? "reject" : "allow"}`;
    button.type = "button";
    button.textContent = option.name || option.label || permissionOptionId(option);
    button.addEventListener("click", async () => {
      elements.permissionOptions.querySelectorAll("button").forEach((item) => { item.disabled = true; });
      elements.permissionDescription.textContent = "正在提交确认...";
      try {
        await sendAction("permission-reply", { id: request.id, optionId: permissionOptionId(option) });
        state.pendingPermission = null;
        elements.permissionDialog.close();
        renderRuntime();
      } catch (error) {
        elements.permissionDescription.textContent = "提交失败，请重试";
        showError(error);
        elements.permissionOptions.querySelectorAll("button").forEach((item) => { item.disabled = false; });
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
      reject.disabled = true;
      elements.permissionDescription.textContent = "正在提交确认...";
      try {
        await sendAction("permission-reply", { id: request.id, optionId: null });
        state.pendingPermission = null;
        elements.permissionDialog.close();
        renderRuntime();
      } catch (error) {
        elements.permissionDescription.textContent = "提交失败，请重试";
        showError(error);
        reject.disabled = false;
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
  const context = GrokUxPolicy.describePlanApprovalContext({
    ...request,
    workspaceName: request.workspaceName || state.runtime?.workspaceName,
  });
  if (elements.planApprovalSession) {
    elements.planApprovalSession.textContent = context.label;
    elements.planApprovalSession.title = context.title;
  }
  renderMarkdown(elements.planApprovalContent, request.planContent || "# 未提供计划内容");
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
    await sendAction("plan-approval-reply", { id: pending.id, outcome, feedback });
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
  updateTool({
    toolCallId: `background-${described.taskId}`,
    tool: "terminal",
    title: described.command,
    status: described.status,
    rawOutput: described.detail || described.output || described.message,
  });
  if (described.kind === "failed") showTurnError(described.message, { source: "background-task" });
}

elements.pairForm.addEventListener("submit", (event) => {
  event.preventDefault();
  pair(elements.pairCode.value.trim());
});
elements.prompt.addEventListener("input", () => {
  elements.prompt.style.height = "auto";
  elements.prompt.style.height = `${Math.min(elements.prompt.scrollHeight, 150)}px`;
  updateControls();
});
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
elements.attachmentButton.addEventListener("click", () => elements.attachmentInput.click());
elements.attachmentInput.addEventListener("change", () => addAttachments(elements.attachmentInput.files));

function canAddAttachments() {
  return state.runtime?.connected && !state.promptSubmitting && !state.editingQueueId;
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
async function submitMobilePrompt(interrupt = false) {
  if (state.promptSubmitting) return;
  const draft = elements.prompt.value;
  const text = draft.trim();
  if (!text && !state.attachments.length) return;
  state.lastTurnError = "";
  state.promptSubmitting = true;
  updateControls();
  try {
    if (state.editingQueueId) {
      const id = state.editingQueueId;
      await sendAction("prompt-queue-update", { id, text });
      if (interrupt) await sendAction("prompt-queue-interrupt", { id });
      if (elements.prompt.value === draft) elements.prompt.value = "";
      state.editingQueueId = null;
    } else {
      const attachments = state.attachments;
      await sendAction("prompt", { text, attachments, interrupt });
      if (elements.prompt.value === draft) elements.prompt.value = "";
      if (state.attachments === attachments) state.attachments = [];
      renderAttachments();
    }
  } catch (error) {
    showTurnError(error.message);
  } finally {
    state.promptSubmitting = false;
    updateControls();
    elements.prompt.focus();
  }
}
elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  submitMobilePrompt();
});
elements.stop.addEventListener("click", async () => {
  try {
    const summary = await sendAction("cancel");
    renderRecoverablePrompt(summary);
    if (!elements.prompt.value.trim() && !state.attachments.length && !state.editingQueueId) {
      await consumeRecoveredPrompt();
    }
  } catch (error) {
    showError(error.message);
  }
});
elements.restorePrompt.addEventListener("click", () => consumeRecoveredPrompt().catch((error) => showError(error.message)));
elements.dismissRecoveredPrompt.addEventListener("click", () => consumeRecoveredPrompt({ fill: false }).catch((error) => showError(error.message)));
elements.interruptSend.addEventListener("click", () => submitMobilePrompt(true));
$("#mobile-clear-queue").addEventListener("click", async () => {
  const count = state.runtime.promptQueue?.length || 0;
  if (!count || !window.confirm(`清空 ${count} 条待执行指令？`)) return;
  await sendAction("prompt-queue-clear").catch((error) => showError(error.message));
});
async function createNewSession() {
  try {
    await sendAction("new-session");
    resetConversation();
    if (state.layoutMode !== "tablet-landscape") closeDrawer();
  } catch (error) {
    showError(error.message);
  }
}

$("#new-session").addEventListener("click", createNewSession);
elements.panelNewSession.addEventListener("click", createNewSession);

function selectControlTab(tab) {
  renderControlSelectors();
  $("#controls-status").textContent = state.runtime.workspaceName || "当前会话";
  document.querySelectorAll("[data-control-tab]").forEach((item) => item.classList.toggle("active", item.dataset.controlTab === tab));
  document.querySelectorAll("[data-control-panel]").forEach((panel) => { panel.hidden = panel.dataset.controlPanel !== tab; });
  if (tab === "usage") refreshMobileUsage();
  if (tab === "work") refreshMobileWork();
}

elements.sessionsButton.addEventListener("click", () => {
  const opening = !GrokMobileLayout.isPanelOpen(panelState(), "left");
  togglePanel("left", elements.sessionsButton);
  if (opening) refreshMobileSessions();
});
elements.controlsButton.addEventListener("click", () => {
  const opening = !GrokMobileLayout.isPanelOpen(panelState(), "right");
  togglePanel("right", elements.controlsButton);
  if (opening) selectControlTab("usage");
});
elements.closeNavigation.addEventListener("click", () => togglePanel("left", elements.closeNavigation));
elements.closeControls.addEventListener("click", () => togglePanel("right", elements.closeControls));
elements.panelBackdrop.addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
  if (event.key !== "Tab" || state.layoutMode === "tablet-landscape" || !state.drawerOpen) return;
  const controls = [...panelElement(state.drawerOpen).querySelectorAll("button:not(:disabled), select:not(:disabled)")]
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
});
window.addEventListener("resize", updateLayoutMode);
elements.mobileModel.addEventListener("change", async () => {
  const previous = state.runtime.modelState?.currentModelId;
  try {
    await sendAction("set-model", { modelId: elements.mobileModel.value });
  } catch (error) {
    elements.mobileModel.value = previous || "";
    showError(error.message);
  }
});
elements.mobileMode.addEventListener("change", async () => {
  const previous = state.runtime.modeState?.currentModeId;
  try {
    await sendAction("set-mode", { modeId: elements.mobileMode.value });
  } catch (error) {
    elements.mobileMode.value = previous || "";
    showError(error.message);
  }
});
document.querySelectorAll("[data-control-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    selectControlTab(button.dataset.controlTab);
  });
});
$("#mobile-refresh-usage").addEventListener("click", refreshMobileUsage);
$("#mobile-refresh-sessions").addEventListener("click", refreshMobileSessions);
$("#mobile-refresh-work").addEventListener("click", refreshMobileWork);
elements.retrySync.addEventListener("click", () => requestSessionSync(state.runtime.sessionId, { force: true }));
$("#disconnect").addEventListener("click", () => {
  state.token = null;
  localStorage.removeItem("grok-remote.token");
  state.socket?.close();
  showPair();
});
elements.permissionDialog.addEventListener("cancel", async (event) => {
  event.preventDefault();
  if (state.pendingPermission) await sendAction("permission-reply", { id: state.pendingPermission.id, optionId: null }).catch(() => {});
  state.pendingPermission = null;
  elements.permissionDialog.close();
  renderRuntime();
});
$("#accept-trust").addEventListener("click", async () => {
  if (state.pendingTrust) await sendAction("folder-trust-reply", { id: state.pendingTrust.id, trusted: true }).catch(() => {});
  state.pendingTrust = null;
  elements.trustDialog.close();
});
$("#reject-trust").addEventListener("click", async () => {
  if (state.pendingTrust) await sendAction("folder-trust-reply", { id: state.pendingTrust.id, trusted: false }).catch(() => {});
  state.pendingTrust = null;
  elements.trustDialog.close();
});
elements.trustDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  $("#reject-trust").click();
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

const initialCode = new URLSearchParams(location.search).get("code");
if (initialCode) {
  elements.pairCode.value = initialCode;
  pair(initialCode);
} else if (state.token) {
  connect();
} else {
  showPair();
}
