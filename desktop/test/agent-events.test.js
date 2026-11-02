const test = require("node:test");
const assert = require("node:assert/strict");
const { backgroundTaskFailure, fatalModelFailure } = require("../src/agent-events");

test("non-zero background task completion becomes a visible failure", () => {
  const failure = backgroundTaskFailure({
    update: {
      sessionUpdate: "task_completed",
      task_snapshot: { task_id: "call-1", exit_code: 1, display_command: "pytest" },
      will_wake: true,
    },
  });

  assert.equal(failure.taskId, "call-1");
  assert.equal(failure.exitCode, 1);
  assert.match(failure.message, /pytest/);
  assert.match(failure.message, /1/);
  assert.equal(backgroundTaskFailure({ update: { sessionUpdate: "task_completed", task_snapshot: { exit_code: 0 } } }), null);
});

test("explicitly stopped background tasks are not reported as failures", () => {
  assert.equal(backgroundTaskFailure({
    update: {
      sessionUpdate: "task_completed",
      task_snapshot: { task_id: "bg-1", signal: "killed", explicitly_killed: true, display_command: "pytest" },
    },
  }), null);
  assert.equal(backgroundTaskFailure({
    update: {
      sessionUpdate: "task_completed",
      taskSnapshot: { taskId: "bg-2", signal: "cancelled", displayCommand: "pytest" },
    },
  }), null);
});

test("background task failures use readable reasons and include captured output", () => {
  const timeout = backgroundTaskFailure({
    update: {
      sessionUpdate: "task_completed",
      task_snapshot: { task_id: "bg-3", signal: "timeout", display_command: "pytest", output: "collected 12 items" },
    },
  });
  assert.match(timeout.message, /超时/);
  assert.doesNotMatch(timeout.message, /信号 killed/);
  assert.match(timeout.message, /collected 12 items/);

  const crashed = backgroundTaskFailure({
    sessionUpdate: "task_completed",
    task: { task_id: "bg-4", exit_code: 1, display_command: "pytest tests/test_llm_cooldown.py", output: "FAILED tests/test_llm_cooldown.py" },
  });
  assert.match(crashed.message, /退出码 1/);
  assert.match(crashed.message, /FAILED tests\/test_llm_cooldown.py/);
});

test("missing model retry is fatal instead of retrying forever", () => {
  const failure = fatalModelFailure({
    update: {
      sessionUpdate: "retry_state",
      type: "retrying",
      message: "HTTP 404: model grok-4.5 does not exist",
    },
  });

  assert.match(failure.message, /grok-4\.5/);
  assert.equal(fatalModelFailure({ update: { sessionUpdate: "retry_state", type: "retrying", message: "HTTP 503 temporarily unavailable" } }), null);
});

test("explicit service access rejection stops model retry without declaring an account ineligible", () => {
  const details = "API error (status 403 Forbidden): Grok Build is coming soon. You don't have access now.";
  const failure = fatalModelFailure({ update: { sessionUpdate: 'retry_state', message: details } });
  assert.match(failure.message, /403/);
  assert.match(failure.message, /停止继续重试/);
  assert.doesNotMatch(failure.message, /需要.*开通|账号.*没有.*资格/);
  assert.equal(fatalModelFailure({ update: { sessionUpdate: 'retry_state', message: 'Permission denied reading file 403.txt' } }), null);
});
