const PERMISSION_MODES = new Set(["ask", "auto", "always-approve"]);

function permissionOptionId(option) {
  return option?.optionId ?? option?.option_id ?? option?.id ?? null;
}

function normalizePermissionRequest(value) {
  let request = value && typeof value === "object" ? value : {};
  if (request.params && typeof request.params === "object") {
    request = request.params.method && request.params.params
      ? request.params.params
      : request.params;
  }
  const tool = request.toolCall ?? request.tool_call ?? request.tool ?? {};
  const options = Array.isArray(request.options) ? request.options : [];
  return {
    ...request,
    sessionId: request.sessionId ?? request.session_id,
    toolCall: {
      ...tool,
      toolCallId: tool.toolCallId ?? tool.tool_call_id ?? tool.id,
    },
    options: options.map((option) => ({
      ...option,
      optionId: permissionOptionId(option),
    })),
  };
}

function optionText(option) {
  return [option?.kind, option?.optionKind, option?.name, option?.label, permissionOptionId(option)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function automaticPermissionOption(request, mode) {
  if (mode !== "always-approve") return null;
  const options = Array.isArray(request?.options) ? request.options : [];
  const allowed = options.filter((option) => {
    if (!permissionOptionId(option)) return false;
    return !/(reject|deny|cancel)/.test(optionText(option));
  });
  return allowed.find((option) => /allow[_ -]?always|always[_ -]?allow/.test(optionText(option)))
    || allowed.find((option) => /allow[_ -]?once|allow|approve/.test(optionText(option)))
    || null;
}

function normalizePermissionMode(value) {
  return PERMISSION_MODES.has(value) ? value : "ask";
}

function permissionResult(optionId) {
  return {
    outcome: optionId
      ? { outcome: "selected", optionId }
      : { outcome: "cancelled" },
  };
}

module.exports = {
  automaticPermissionOption,
  normalizePermissionMode,
  normalizePermissionRequest,
  permissionOptionId,
  permissionResult,
};
