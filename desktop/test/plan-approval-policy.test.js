const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isPlanApprovalMethod,
  normalizePlanApprovalRequest,
  planApprovalResult,
} = require("../src/plan-approval-policy");

test("plan approval recognizes direct and gateway-wrapped extension methods", () => {
  assert.equal(isPlanApprovalMethod("x.ai/exit_plan_mode"), true);
  assert.equal(isPlanApprovalMethod("_x.ai/exit_plan_mode"), true);
  assert.equal(isPlanApprovalMethod({
    method: "ext_method",
    params: { method: "x.ai/exit_plan_mode", params: {} },
  }), true);
  assert.equal(isPlanApprovalMethod("session/request_permission"), false);
});

test("plan approval normalizes direct, wrapped, and snake-case payloads", () => {
  assert.deepEqual(
    normalizePlanApprovalRequest({
      sessionId: "session-direct",
      toolCallId: "call-direct",
      planContent: "# Direct plan",
    }),
    { sessionId: "session-direct", toolCallId: "call-direct", planContent: "# Direct plan" },
  );

  assert.deepEqual(
    normalizePlanApprovalRequest({
      method: "_x.ai/exit_plan_mode",
      params: {
        method: "x.ai/exit_plan_mode",
        params: {
          session_id: "session-wrapped",
          tool_call_id: "call-wrapped",
          planContent: "# Wrapped plan",
        },
      },
    }),
    { sessionId: "session-wrapped", toolCallId: "call-wrapped", planContent: "# Wrapped plan" },
  );

  assert.deepEqual(
    normalizePlanApprovalRequest({
      method: "ext_method",
      params: {
        method: "_x.ai/exit_plan_mode",
        params: {
          request: {
            params: {
              sessionId: "session-adapter",
              toolCallId: "call-adapter",
              planContent: "# Adapter plan",
            },
          },
        },
      },
    }),
    { sessionId: "session-adapter", toolCallId: "call-adapter", planContent: "# Adapter plan" },
  );
});

test("plan approval response matches official approved, revised, and abandoned forms", () => {
  assert.deepEqual(planApprovalResult("approved"), { outcome: "approved" });
  assert.deepEqual(
    planApprovalResult("cancelled", "  请补充错误处理  "),
    { outcome: "cancelled", feedback: "请补充错误处理" },
  );
  assert.deepEqual(planApprovalResult("abandoned"), { outcome: "abandoned" });
  assert.throws(() => planApprovalResult("cancelled", "  "), /feedback/i);
  assert.throws(() => planApprovalResult("unknown"), /outcome/i);
});

test("plan approval rejects requests without stable session and tool identifiers", () => {
  assert.throws(() => normalizePlanApprovalRequest({ toolCallId: "call" }), /sessionId/i);
  assert.throws(() => normalizePlanApprovalRequest({ sessionId: "session" }), /toolCallId/i);
});
