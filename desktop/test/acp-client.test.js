const test = require("node:test");
const assert = require("node:assert/strict");
const {
  JsonRpcLineParser,
  authMethodId,
  errorDetail,
  requestDiagnostic,
  selectAuthMethod,
  serializeError,
  wireMethod,
} = require("../src/acp-client");

test("line parser handles fragmented and batched JSON-RPC messages", () => {
  const messages = [];
  const parser = new JsonRpcLineParser((message) => messages.push(message));
  parser.push('{"id":1,"res');
  parser.push('ult":{}}\n{"method":"session/update"}\n');
  assert.deepEqual(messages, [
    { id: 1, result: {} },
    { method: "session/update" },
  ]);
});

test("line parser reports malformed lines and continues", () => {
  const messages = [];
  const malformed = [];
  const parser = new JsonRpcLineParser(
    (message) => messages.push(message),
    (line) => malformed.push(line),
  );
  parser.push('not-json\n{"ok":true}\n');
  assert.deepEqual(malformed, ["not-json"]);
  assert.deepEqual(messages, [{ ok: true }]);
});

test("auth selection honors the server default then cached token", () => {
  const response = {
    authMethods: [{ id: "xai.api_key" }, { id: "cached_token" }],
    _meta: { defaultAuthMethodId: "xai.api_key" },
  };
  assert.equal(selectAuthMethod(response), "xai.api_key");
  delete response._meta;
  assert.equal(selectAuthMethod(response), "cached_token");
  assert.equal(authMethodId({ methodId: "grok.com" }), "grok.com");
});

test("errors become IPC-safe values", () => {
  const error = new Error("boom");
  error.code = 42;
  assert.deepEqual(serializeError(error), { message: "boom", code: 42, data: undefined });
});

test("internal ACP errors expose structured backend details", () => {
  const error = Object.assign(new Error("Internal error"), {
    code: -32603,
    data: { message: "serialization error: missing field `annotations`", error_kind: "serialization" },
  });
  assert.equal(errorDetail(error.data), "serialization error: missing field `annotations`");
  assert.deepEqual(serializeError(error), {
    message: "serialization error: missing field `annotations`",
    code: -32603,
    data: error.data,
    detail: "serialization error: missing field `annotations`",
    summary: "Internal error",
  });
});

test("x.ai extension methods use the ACP wire prefix", () => {
  assert.equal(wireMethod("x.ai/billing"), "_x.ai/billing");
  assert.equal(wireMethod("_x.ai/billing"), "_x.ai/billing");
  assert.equal(wireMethod("session/prompt"), "session/prompt");
});

test("reverse request diagnostics expose shape without sensitive values", () => {
  const diagnostic = requestDiagnostic({
    jsonrpc: "2.0",
    id: 42,
    method: "ext_method",
    params: {
      method: "x.ai/exit_plan_mode",
      params: {
        sessionId: "secret-session",
        toolCallId: "secret-tool",
        planContent: "top secret plan body",
      },
    },
  });

  assert.match(diagnostic, /id=42/);
  assert.match(diagnostic, /method=ext_method/);
  assert.match(diagnostic, /nestedMethod=x\.ai\/exit_plan_mode/);
  assert.match(diagnostic, /paramsKeys=method,params/);
  assert.match(diagnostic, /nestedParamsKeys=planContent,sessionId,toolCallId/);
  assert.doesNotMatch(diagnostic, /secret-session|secret-tool|top secret/);
});
