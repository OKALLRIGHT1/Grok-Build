const test = require("node:test");
const assert = require("node:assert/strict");
const {
  automaticPermissionOption,
  normalizePermissionMode,
  normalizePermissionRequest,
  permissionResult,
} = require("../src/permission-policy");

test("always approve prefers allow-always and never selects rejection", () => {
  const request = { options: [
    { optionId: "reject", kind: "reject_once", name: "拒绝" },
    { optionId: "once", kind: "allow_once", name: "允许一次" },
    { optionId: "always", kind: "allow_always", name: "始终允许" },
  ] };
  assert.equal(automaticPermissionOption(request, "always-approve").optionId, "always");
  assert.equal(automaticPermissionOption(request, "ask"), null);
});

test("permission modes reject unknown persisted values", () => {
  assert.equal(normalizePermissionMode("always-approve"), "always-approve");
  assert.equal(normalizePermissionMode("unknown"), "ask");
});

test("permission replies use the nested ACP outcome shape", () => {
  assert.deepEqual(permissionResult("once"), {
    outcome: { outcome: "selected", optionId: "once" },
  });
  assert.deepEqual(permissionResult(null), {
    outcome: { outcome: "cancelled" },
  });
});

test("gateway-wrapped permission requests are unwrapped before approval", () => {
  const wrapped = {
    method: "session/request_permission",
    params: {
      sessionId: "s1",
      toolCall: { toolCallId: "write-1", title: "write" },
      options: [{ optionId: "once", kind: "allow_once", name: "允许一次" }],
    },
  };

  assert.deepEqual(normalizePermissionRequest(wrapped), wrapped.params);
  assert.equal(automaticPermissionOption(normalizePermissionRequest(wrapped), "always-approve").optionId, "once");
});

test("permission request normalization accepts direct and snake-case option ids", () => {
  const direct = {
    session_id: "s1",
    tool_call: { tool_call_id: "terminal-1", title: "run_terminal_command" },
    options: [{ option_id: "allow", kind: "allow_once" }],
  };

  const normalized = normalizePermissionRequest(direct);
  assert.equal(normalized.toolCall.toolCallId, "terminal-1");
  assert.equal(normalized.options[0].optionId, "allow");
  assert.equal(automaticPermissionOption(normalized, "always-approve").optionId, "allow");
});
