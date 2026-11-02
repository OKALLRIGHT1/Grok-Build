const test = require("node:test");
const assert = require("node:assert/strict");
const { buildQuickRequest, buildRealRequest, runModelProbe } = require("../src/model-probe");

const base = {
  providerId: "vendor",
  providerName: "Vendor",
  modelId: "vendor-model",
  name: "Model",
  model: "model-v1",
  baseUrl: "https://api.example.test/v1/",
  apiKey: "top-secret-key",
};

test("quick request checks the provider model catalog without spending tokens", () => {
  const request = buildQuickRequest({ ...base, apiBackend: "responses" });
  assert.equal(request.url, "https://api.example.test/v1/models");
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers.Authorization, "Bearer top-secret-key");
  assert.equal(request.options.body, undefined);
});

test("real requests use minimal protocol-specific payloads", () => {
  const chat = buildRealRequest({ ...base, apiBackend: "chat_completions" });
  assert.equal(chat.url, "https://api.example.test/v1/chat/completions");
  assert.deepEqual(JSON.parse(chat.options.body), {
    model: "model-v1",
    messages: [{ role: "user", content: "Reply with OK" }],
    max_tokens: 4,
    temperature: 0,
  });

  const responses = buildRealRequest({ ...base, apiBackend: "responses" });
  assert.equal(responses.url, "https://api.example.test/v1/responses");
  assert.deepEqual(JSON.parse(responses.options.body), {
    model: "model-v1",
    input: "Reply with OK",
    max_output_tokens: 16,
  });

  const messages = buildRealRequest({ ...base, apiBackend: "messages" });
  assert.equal(messages.url, "https://api.example.test/v1/messages");
  assert.equal(messages.options.headers["x-api-key"], "top-secret-key");
  assert.equal(messages.options.headers["anthropic-version"], "2023-06-01");
  assert.deepEqual(JSON.parse(messages.options.body), {
    model: "model-v1",
    messages: [{ role: "user", content: "Reply with OK" }],
    max_tokens: 4,
    temperature: 0,
  });
});

test("known endpoint suffixes are replaced instead of duplicated", () => {
  const request = buildRealRequest({ ...base, baseUrl: "https://api.example.test/v1/chat/completions", apiBackend: "responses" });
  assert.equal(request.url, "https://api.example.test/v1/responses");
});

test("quick probe treats an unsupported models endpoint as reachable", async () => {
  const result = await runModelProbe({ ...base, apiBackend: "responses" }, "quick", {
    fetchImpl: async () => ({ ok: false, status: 404, statusText: "Not Found", text: async () => "missing" }),
    now: (() => { let value = 100; return () => (value += 25); })(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.category, "reachable");
  assert.equal(result.httpStatus, 404);
  assert.equal(result.latencyMs, 25);
});

test("real probe parses successful output without returning credentials", async () => {
  const result = await runModelProbe({ ...base, apiBackend: "chat_completions" }, "real", {
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Authorization, "Bearer top-secret-key");
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({ choices: [{ message: { content: "OK" } }] }),
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.category, "available");
  assert.equal(result.output, "OK");
  assert.equal(JSON.stringify(result).includes("top-secret-key"), false);
});

test("authentication, timeout, and network errors have actionable categories", async () => {
  const authentication = await runModelProbe({ ...base, apiBackend: "responses" }, "quick", {
    fetchImpl: async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "bad top-secret-key" }),
  });
  assert.equal(authentication.category, "authentication");
  assert.equal(authentication.ok, false);
  assert.equal(authentication.technicalDetails.includes("top-secret-key"), false);

  const timeout = await runModelProbe({ ...base, apiBackend: "responses" }, "quick", {
    fetchImpl: async () => { const error = new Error("timed out"); error.name = "AbortError"; throw error; },
  });
  assert.equal(timeout.category, "timeout");

  const network = await runModelProbe({ ...base, apiBackend: "responses" }, "quick", {
    fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND api.example.test"); },
  });
  assert.equal(network.category, "connectivity");
});

