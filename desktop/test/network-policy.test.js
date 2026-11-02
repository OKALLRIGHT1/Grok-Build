const test = require("node:test");
const assert = require("node:assert/strict");
const { proxyEnvironment, billingFailure } = require("../src/network-policy");

test("CLI inherits an available Windows proxy without replacing explicit proxy settings", () => {
  assert.equal(proxyEnvironment({}, "PROXY 127.0.0.1:7890; DIRECT").HTTPS_PROXY, "http://127.0.0.1:7890");
  assert.equal(proxyEnvironment({}, "SOCKS5 localhost:1080").HTTPS_PROXY, "socks5h://localhost:1080");
  assert.deepEqual(proxyEnvironment({ https_proxy: "http://existing:1234" }, "PROXY localhost:7890"), {});
  assert.deepEqual(proxyEnvironment({}, "DIRECT; PROXY localhost:7890"), {});
  assert.deepEqual(proxyEnvironment({}, "PROXY invalid; DIRECT"), {});
  assert.equal(proxyEnvironment({ NO_PROXY: "internal.example" }, "PROXY localhost:7890").NO_PROXY, "internal.example");
});

test("billing errors distinguish login from connectivity without exposing credentials", () => {
  assert.equal(billingFailure(new Error("error sending request for url https://cli-chat-proxy.grok.com/v1/billing")).retryable, true);
  assert.equal(billingFailure(new Error("Authentication required to fetch billing data")).code, "BILLING_AUTH_REQUIRED");
  assert.equal(billingFailure(new Error("Billing service error: HTTP 500")).retryable, false);
  const error = billingFailure(new Error("network failure Bearer secret-value https://user:password@host.example"));
  assert.doesNotMatch(error.details, /secret-value|password/);
});
