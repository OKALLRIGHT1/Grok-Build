const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const desktopRoot = path.resolve(__dirname, "..");
const mainSource = () => fs.readFileSync(path.join(desktopRoot, "src", "main.js"), "utf8");
const preloadSource = () => fs.readFileSync(path.join(desktopRoot, "src", "preload.js"), "utf8");

test("main process routes official plan approval through desktop and mobile clients", () => {
  const source = mainSource();
  const preload = preloadSource();

  assert.match(source, /require\("\.\/plan-approval-policy"\)/);
  assert.match(source, /const planApprovalsById = new Map\(\)/);
  assert.match(source, /planApprovals: \[\.\.\.planApprovalsById\.values\(\)\]/);
  assert.match(source, /"agent:plan-approval": "plan-approval"/);
  assert.match(source, /function replyPlanApproval\(id, outcome, feedback\)/);
  assert.match(source, /case "plan-approval-reply":/);
  assert.match(source, /ipcMain\.handle\("agent:plan-approval-reply"/);
  assert.match(preload, /replyPlanApproval: \(id, outcome, feedback\)/);
  assert.match(preload, /onPlanApproval: \(callback\)/);
});

test("plan approval resolution broadcasts both volatile request id and stable tool id", () => {
  const source = mainSource();
  assert.match(source, /send\("control:interaction-resolved", \{ id, toolCallId: pending\.toolCallId \}\)/);
  assert.match(source, /planApprovalIdByToolCall\.set\(request\.toolCallId, message\.id\)/);
  assert.match(source, /planApprovalIdByToolCall\.delete\(pending\.toolCallId\)/);
});

test("main process records reverse request shape and normalization failures", () => {
  const source = mainSource();
  assert.match(source, /requestDiagnostic/);
  assert.match(source, /emitBackendDiagnostic\(requestDiagnostic\(message\)\)/);
  assert.match(source, /Plan approval request .* rejected:/);
});
