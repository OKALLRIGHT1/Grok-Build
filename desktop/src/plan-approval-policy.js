const PLAN_APPROVAL_METHOD = "x.ai/exit_plan_mode";
const PLAN_OUTCOMES = new Set(["approved", "cancelled", "abandoned"]);

function normalizedMethod(method) {
  return String(method || "").replace(/^_(?=x\.ai\/)/, "");
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function nestedRequest(value) {
  const current = objectValue(value);
  if (!current) return null;
  for (const key of ["params", "request", "payload"]) {
    const nested = objectValue(current[key]);
    if (nested) return nested;
  }
  return null;
}

function unwrapPlanApprovalRequest(value) {
  let current = objectValue(value) || {};
  for (let depth = 0; depth < 8; depth += 1) {
    if (current.sessionId != null || current.session_id != null || current.toolCallId != null || current.tool_call_id != null) {
      return current;
    }
    const nested = nestedRequest(current);
    if (!nested || nested === current) break;
    current = nested;
  }
  return current;
}

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Plan approval request is missing ${name}`);
  }
  return value;
}

function normalizePlanApprovalRequest(value) {
  const request = unwrapPlanApprovalRequest(value);
  const sessionId = requiredString(request.sessionId ?? request.session_id, "sessionId");
  const toolCallId = requiredString(request.toolCallId ?? request.tool_call_id, "toolCallId");
  return {
    sessionId,
    toolCallId,
    planContent: typeof request.planContent === "string"
      ? request.planContent
      : (typeof request.plan_content === "string" ? request.plan_content : null),
  };
}

function planApprovalResult(outcome, feedback) {
  if (!PLAN_OUTCOMES.has(outcome)) throw new Error("Unsupported plan approval outcome");
  if (outcome !== "cancelled") return { outcome };
  if (typeof feedback !== "string" || !feedback.trim()) {
    throw new Error("Cancelled plan approval requires feedback");
  }
  return { outcome, feedback: feedback.trim() };
}

function isPlanApprovalMethod(method) {
  if (typeof method === "string") return normalizedMethod(method) === PLAN_APPROVAL_METHOD;
  let current = objectValue(method);
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (normalizedMethod(current.method) === PLAN_APPROVAL_METHOD) return true;
    current = nestedRequest(current);
  }
  return false;
}

module.exports = {
  PLAN_APPROVAL_METHOD,
  isPlanApprovalMethod,
  normalizePlanApprovalRequest,
  planApprovalResult,
};
