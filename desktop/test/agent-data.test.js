const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeBilling, normalizeModelState, normalizeSessionList, unwrapExtResult } = require("../src/agent-data");

test("normalizes ACP model state", () => {
  assert.deepEqual(normalizeModelState({
    currentModelId: "grok-build",
    availableModels: [{ modelId: "grok-build", name: "Grok Build", _meta: { supportsReasoningEffort: true } }],
  }), {
    currentModelId: "grok-build",
    reasoningEffort: null,
    models: [{ id: "grok-build", name: "Grok Build", description: "", meta: { supportsReasoningEffort: true } }],
  });
});

test("unwraps extension responses and normalizes billing", () => {
  assert.deepEqual(unwrapExtResult({ result: { result: { ok: true } } }), { ok: true });
  const billing = normalizeBilling({ result: { config: {
    creditUsagePercent: 42.5,
    currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: "2026-07-21T00:00:00Z" },
    prepaidBalance: { val: 500 },
  }, subscriptionTier: "SuperGrok" } });
  assert.equal(billing.usagePercent, 42.5);
  assert.equal(billing.prepaidBalanceCents, 500);
  assert.equal(billing.subscriptionTier, "SuperGrok");
});

test("normalizes unified session list", () => {
  const result = normalizeSessionList({ result: { sessions: [{
    sessionId: "s1", title: "Fix tests", cwd: "C:/repo", modelId: "grok-build", updatedAt: "2026-07-20T00:00:00Z",
  }] } });
  assert.equal(result.sessions[0].id, "s1");
  assert.equal(result.sessions[0].title, "Fix tests");
});

test("normalizes all-project local history, including legacy titles and metadata", () => {
  const result = normalizeSessionList({ result: { all_sessions: {
    "C:/project-a": [{ info: { id: "a1" }, generated_title: "项目 A 的旧对话", last_active_at: "2026-10-01", num_messages: 4 }],
    "D:/project-b": [{ info: { id: "b1" }, session_summary: "项目 B 的对话" }],
  } } });
  assert.deepEqual(result.sessions.map((row) => [row.id, row.cwd, row.title]), [
    ["a1", "C:/project-a", "项目 A 的旧对话"], ["b1", "D:/project-b", "项目 B 的对话"],
  ]);
  assert.equal(result.sessions[0].messageCount, 4);
  assert.equal(result.sessions[0].updatedAt, "2026-10-01");
});

test("billing supports the official CLI's snake-case response fields", () => {
  const result = normalizeBilling({ config: { creditUsagePercent: 30 }, subscription_tier: "SuperGrok", on_demand_enabled: true });
  assert.equal(result.subscriptionTier, "SuperGrok");
  assert.equal(result.onDemandEnabled, true);
});

test("only confirmed empty unnamed history is hidden; real, named and unknown history stays", () => {
  const result = normalizeSessionList({ sessions: [
    { id: "blank", num_messages: 0 },
    { id: "blank-zh", numMessages: 0, title: "未命名会话" },
    { id: "blank-en", num_messages: 0, generated_title: "Untitled Session" },
    { id: "unknown" },
    { id: "real", num_messages: 2 },
    { id: "first", num_messages: 0, first_prompt: "Hello" },
    { id: "summary", num_messages: 0, session_summary: "Hello" },
    { id: "named", num_messages: 0, title: "My project" },
    { id: "manual", num_messages: 0, title: "未命名会话", title_is_manual: true },
  ] });
  assert.deepEqual(result.sessions.map((row) => row.id), ["unknown", "real", "first", "summary", "named", "manual"]);
});
