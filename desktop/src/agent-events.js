function innerParams(value) {
  let current = value && typeof value === "object" ? value : {};
  if (current.params && typeof current.params === "object") {
    current = current.params.method && current.params.params
      ? current.params.params
      : current.params;
  }
  return current;
}

function updateFrom(value) {
  const params = innerParams(value);
  return params.update && typeof params.update === "object" ? params.update : params;
}

const { describeBackgroundTask, describeError } = require("./ux-policy");

function backgroundTaskFailure(value) {
  const update = updateFrom(value);
  if (update.sessionUpdate !== "task_completed") return null;
  const task = update.task_snapshot ?? update.taskSnapshot ?? update.task ?? {};
  const described = describeBackgroundTask(task);
  if (described.kind !== "failed") return null;
  return {
    taskId: described.taskId,
    exitCode: described.exitCode,
    signal: described.signal,
    message: described.message,
  };
}

function fatalModelFailure(value) {
  const update = updateFrom(value);
  if (update.sessionUpdate !== "retry_state") return null;
  const details = [update.message, update.error, update.error_type, update.errorType, update.agent_result]
    .filter(Boolean)
    .map((item) => typeof item === "string" ? item : JSON.stringify(item))
    .join("\n");
  const lower = details.toLowerCase();
  const described = describeError(details);
  if (described.kind === "model-service-access") {
    return { message: `${described.title}，已停止继续重试。${described.guidance}\n${details}`, details };
  }
  const missingModel = /model.{0,120}(?:not found|does not exist|doesn't exist|unknown|invalid|不存在|未找到|无此模型)/.test(lower)
    || /(?:unknown model|model not found|no such model)/.test(lower)
    || /\b404\b.{0,120}\bmodel\b|\bmodel\b.{0,120}\b404\b/.test(lower);
  if (!missingModel) return null;
  return {
    message: `当前模型不可用，已停止继续重试。${details ? `\n${details}` : ""}`,
    details,
  };
}

module.exports = { backgroundTaskFailure, fatalModelFailure, innerParams };
