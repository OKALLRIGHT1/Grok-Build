const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const policy = require("../src/ux-policy");

const desktopRoot = path.resolve(__dirname, "..");

test("conversation follow policy respects user scroll position", () => {
  assert.equal(policy.isNearBottom({ scrollTop: 800, clientHeight: 200, scrollHeight: 1050 }), true);
  assert.equal(policy.isNearBottom({ scrollTop: 400, clientHeight: 200, scrollHeight: 1050 }), false);
  assert.equal(policy.isNearBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 }), true);
});

test("technical failures become actionable user copy", () => {
  const serialization = policy.describeError('serialization error: missing field `output`');
  assert.equal(serialization.kind, "serialization");
  assert.match(serialization.title, /响应格式/);
  assert.match(serialization.guidance, /重试|模型/);
  assert.match(serialization.details, /missing field/);

  const timeout = policy.describeError(new Error("request timed out"));
  assert.equal(timeout.kind, "timeout");
  assert.match(timeout.guidance, /连接|重试/);
});

test("Build access-gate errors distinguish service refusal from an expired login", () => {
  const error = policy.describeError("API error (status 403 Forbidden): Grok Build is coming soon. You don't have access now.");
  assert.equal(error.kind, 'model-service-access');
  assert.match(error.guidance, /终端 CLI/);
  assert.match(error.guidance, /路径|版本/);
  assert.doesNotMatch(error.guidance, /重新登录|开通|充值/);
});

test("Chrome updater stderr in a failed background command is not a workspace denial", () => {
  const output = [
    '\x1b[31;1mDevTools listening on ws://127.0.0.1:9333/devtools/browser/qa\x1b[0m',
    'Created TensorFlow Lite XNNPACK delegate for CPU.',
    '[35516:35824:ERROR:chrome\\updater\\ipc\\update_service_dialer_win.cc:77] Failed to open named pipe server process 8028: 拒绝访问 (0x5)',
  ].join('\n');
  const failure = policy.describeBackgroundTask({
    task_id: "chrome-qa", exit_code: 1, display_command: "chrome --headless=new", output,
  });
  const described = policy.describeError(failure.message);
  assert.equal(described.kind, "command");
  assert.match(described.title, /后台命令/);
  assert.match(described.guidance, /Chrome 已启动调试服务/);
  assert.doesNotMatch(described.guidance, /工作区权限|重新登录|切换模型/);
  assert.match(described.details, /退出码 1/);
  assert.match(described.details, /拒绝访问 \(0x5\)/);
  assert.doesNotMatch(described.details, /\x1b/);
});

test("command context takes priority over words inside commands and their output", () => {
  for (const text of [
    "Access denied: reading package.json",
    "JSON parse error in auth.json",
    "HTTP 403 Forbidden from a command subprocess",
  ]) {
    assert.equal(policy.describeError(text, { source: "background-task" }).kind, "command");
  }
  assert.equal(policy.describeError("permission denied reading a file").kind, "permission");
});

test("mentioning a JSON file does not imply a model protocol failure", () => {
  assert.equal(policy.describeError("Cannot read package.json: permission denied").kind, "permission");
  assert.equal(policy.describeError("ENOENT: no such file or directory, open package.json").kind, "generic");
  assert.equal(policy.describeError({ message: "Command exited with code 1", file: "config.json" }).kind, "generic");
  for (const text of ["invalid JSON response", "JSON parse error: expected value", "Unexpected token '<' in JSON at position 0", "deserialization error: missing field output"]) {
    assert.equal(policy.describeError(text).kind, "serialization", text);
  }
});

test("permission presentation exposes impact without leading with raw arguments", () => {
  const destructive = policy.describePermission({
    toolCall: { title: "删除文件", rawInput: "Remove-Item a.txt" },
  });
  assert.equal(destructive.level, "high");
  assert.equal(destructive.label, "高影响操作");
  assert.match(destructive.summary, /删除文件/);
  assert.match(destructive.details, /Remove-Item/);

  const readOnly = policy.describePermission({ toolCall: { title: "读取配置", rawInput: "Get-Content app.toml" } });
  assert.equal(readOnly.level, "normal");
});

test("health rows describe disconnected, authentication, and ready states", () => {
  const disconnected = policy.describeHealth({ connected: false, status: "error", workspaceName: "" });
  assert.deepEqual(disconnected.map((item) => item.id), ["backend", "workspace", "access", "model"]);
  assert.equal(disconnected[0].state, "problem");
  assert.equal(disconnected[1].state, "waiting");

  const ready = policy.describeHealth({
    connected: true,
    status: "ready",
    workspaceName: "demo",
    modelState: { currentModelId: "grok-4" },
  });
  assert.equal(ready.every((item) => item.state === "ready"), true);
});

test("CLI remains healthy without an open project and does not claim an authenticated session", () => {
  const rows = policy.describeHealth({ cliConnected: true, connected: false, status: "cli-ready" });
  assert.equal(rows[0].state, "ready");
  assert.equal(rows[0].detail, "已连接");
  assert.equal(rows[1].state, "waiting");
  assert.equal(rows[2].detail, "打开项目后检查");
  assert.doesNotMatch(rows.map((row) => row.detail).join(" "), /重新连接|连接失败/);
});

test("composer presentation distinguishes send, queue, save, and disconnected states", () => {
  assert.deepEqual(
    policy.describeComposer({ connected: true, busy: false, editing: false, hasContent: true }),
    { mode: "send", hint: "立即发送", sendLabel: "发送", disabled: false },
  );
  assert.equal(policy.describeComposer({ connected: true, busy: true, editing: false, hasContent: true }).mode, "queue");
  assert.equal(policy.describeComposer({ connected: true, busy: true, editing: true, hasContent: true }).mode, "save");
  assert.equal(policy.describeComposer({ connected: false, busy: false, editing: false, hasContent: true }).disabled, true);
});

test("plan approval context prefers a readable workspace name over a raw session id", () => {
  assert.deepEqual(
    policy.describePlanApprovalContext({ workspaceName: "C:\\\\Users\\\\demo\\\\project" }),
    { label: "project", title: "C:\\\\Users\\\\demo\\\\project" },
  );
  const session = policy.describePlanApprovalContext({ sessionId: "019feeaf-f6b4-71c1-acb1-24464aaa1f5e" });
  assert.equal(session.label, "会话 019feeaf-f6b4");
  assert.equal(session.title, "019feeaf-f6b4-71c1-acb1-24464aaa1f5e");
  assert.deepEqual(policy.describePlanApprovalContext({}), { label: "当前会话", title: "当前会话" });
});

test("desktop UI includes a dedicated plan approval dialog and event handlers", () => {
  const html = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "renderer.js"), "utf8");

  assert.match(html, /id="plan-approval-dialog"/);
  assert.match(html, /id="plan-approval-content"/);
  assert.match(html, /id="plan-approval-feedback"/);
  assert.match(html, /id="approve-plan"/);
  assert.match(html, /id="revise-plan"/);
  assert.match(html, /id="abandon-plan"/);
  assert.match(html, /id="plan-approval-banner"/);
  assert.match(html, /id="reopen-plan-approval"/);
  assert.match(html, /id="defer-plan"/);
  assert.match(html, /class="modal-form plan-approval-body"/);
  assert.doesNotMatch(html, /class="modal-body plan-approval-body"/);
  assert.match(renderer, /function showPlanApproval\(request/);
  assert.match(renderer, /function submitPlanApproval\(outcome\)/);
  assert.match(renderer, /api\.onPlanApproval\(showPlanApproval\)/);
  assert.match(renderer, /if \(!reopen && state\.pendingPlanApproval\?\.id === request\.id\) return;/);
  assert.match(renderer, /GrokUxPolicy\.describePlanApprovalContext/);
  assert.match(renderer, /确定放弃这份计划/);
  assert.match(renderer, /function renderPlanApprovalBanner/);
  assert.match(renderer, /case "task_completed":/);
});

test("mobile UI includes plan approval controls and synchronizes resolution", () => {
  const html = fs.readFileSync(path.join(desktopRoot, "src", "mobile", "index.html"), "utf8");
  const mobile = fs.readFileSync(path.join(desktopRoot, "src", "mobile", "app.js"), "utf8");

  assert.match(html, /id="mobile-plan-approval-dialog"/);
  assert.match(html, /id="mobile-plan-approval-content"/);
  assert.match(html, /id="mobile-plan-approval-feedback"/);
  assert.match(html, /id="mobile-plan-approval-banner"/);
  assert.match(html, /id="mobile-reopen-plan-approval"/);
  assert.match(html, /id="mobile-defer-plan"/);
  assert.match(html, /确认下一步执行方案/);
  assert.match(html, /提出修改意见/);
  assert.match(html, /批准并执行/);
  assert.match(mobile, /case "plan-approval":/);
  assert.match(mobile, /sendAction\("plan-approval-reply"/);
  assert.match(mobile, /pendingPlanApproval/);
  assert.match(mobile, /if \(!reopen && state\.pendingPlanApproval\?\.id === request\.id\) return;/);
  assert.match(mobile, /GrokUxPolicy\.describePlanApprovalContext/);
  assert.match(mobile, /确定放弃这份计划/);
  assert.match(mobile, /function renderPlanApprovalBanner/);
  assert.match(mobile, /case "task_completed":/);
});

test("desktop and mobile renderers declare adaptive welcome and active layout hooks", () => {
  const desktopHtml = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "index.html"), "utf8");
  const desktopRenderer = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "renderer.js"), "utf8");
  const mobileHtml = fs.readFileSync(path.join(desktopRoot, "src", "mobile", "index.html"), "utf8");
  const mobileRenderer = fs.readFileSync(path.join(desktopRoot, "src", "mobile", "app.js"), "utf8");

  assert.match(desktopHtml, /data-conversation-layout="welcome"/);
  assert.match(desktopHtml, /class="welcome-shortcuts"/);
  assert.match(desktopHtml, /src="\.\.\/layout-policy\.js"/);
  assert.match(desktopRenderer, /function updateConversationLayout\(\)/);
  assert.match(desktopRenderer, /GrokLayoutPolicy\.conversationLayout/);
  assert.match(mobileHtml, /src="\/layout-policy\.js"/);
  assert.match(mobileRenderer, /function updateConversationLayout\(\)/);
  assert.match(mobileRenderer, /GrokLayoutPolicy\.conversationLayout/);
});

test("loaded desktop and mobile conversations settle at the newest message", () => {
  const desktopRenderer = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "renderer.js"), "utf8");
  const mobileRenderer = fs.readFileSync(path.join(desktopRoot, "src", "mobile", "app.js"), "utf8");

  assert.match(desktopRenderer, /function settleConversationAtBottom\(\)[\s\S]*requestAnimationFrame\(\(\) =>[\s\S]*requestAnimationFrame\(\(\) =>[\s\S]*scrollToBottom\(true\)/);
  assert.match(desktopRenderer, /api\.onSessionLoadFinished\(\(\) => \{[\s\S]*state\.replaying = false;[\s\S]*settleConversationAtBottom\(\);/);
  assert.match(mobileRenderer, /function settleConversationAtBottom\(\)[\s\S]*requestAnimationFrame\(\(\) =>[\s\S]*requestAnimationFrame\(\(\) =>[\s\S]*scrollToBottom\(true\)/);
  assert.match(mobileRenderer, /case "session-load-finished":[\s\S]*state\.replaying = false;[\s\S]*settleConversationAtBottom\(\);/);
});

test("desktop task start immediately switches the welcome page to the active layout", () => {
  const desktopRenderer = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "renderer.js"), "utf8");

  assert.match(desktopRenderer, /busy: state\.busy \|\| state\.taskStatus\?\.state === "started"/);
  assert.match(desktopRenderer, /api\.onTaskStatus\(\(task\) => \{[\s\S]*renderTaskStatus\(task\);[\s\S]*updateConversationLayout\(\);/);
  assert.match(fs.readFileSync(path.join(desktopRoot, "src", "renderer", "styles.css"), "utf8"), /data-conversation-layout="active"[^\n]*\.empty-state[\s\S]*display: none/);
});

test("desktop sidebar prioritizes recent conversations and supports a persistent compact mode", () => {
  const html = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "index.html"), "utf8");
  const renderer = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "renderer.js"), "utf8");
  const styles = fs.readFileSync(path.join(desktopRoot, "src", "renderer", "styles.css"), "utf8");

  assert.match(html, /id="sidebar-toggle"/);
  assert.match(html, /id="recent-sessions-list"/);
  assert.match(html, /id="sidebar-more"/);
  assert.match(html, /class="composer-config-row"/);
  assert.match(renderer, /grok-desktop\.sidebar-collapsed/);
  assert.match(renderer, /function renderRecentSessions\(sessions\)/);
  assert.match(renderer, /function setSidebarCollapsed\(collapsed\)/);
  assert.match(styles, /data-sidebar-collapsed="true"/);
  assert.match(styles, /\.recent-session-list/);
  assert.match(styles, /data-connection-ready="true"[\s\S]*\.welcome-shortcuts[\s\S]*\.startup-health/);
  assert.match(renderer, /dataset\.connectionReady/);
});
