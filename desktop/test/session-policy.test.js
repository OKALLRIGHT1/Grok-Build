const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildSessionMetadata,
  choosePreferredModel,
  mergeClientSettings,
} = require("../src/session-policy");

test("session metadata applies permission mode before the session starts", () => {
  assert.deepEqual(buildSessionMetadata("always-approve", "cpa-gpt", { clientIdentifier: "grok-desktop" }), {
    clientIdentifier: "grok-desktop",
    yoloMode: true,
    autoMode: false,
    permissionMode: "always-approve",
    modelId: "cpa-gpt",
  });
  assert.equal(buildSessionMetadata("auto", null).autoMode, true);
  assert.equal(buildSessionMetadata("ask", null).yoloMode, false);
});

test("preferred model is reused only while it remains in the advertised catalog", () => {
  const models = [{ id: "grok-4.5" }, { id: "cpa-gpt" }];
  assert.equal(choosePreferredModel(models, "cpa-gpt"), "cpa-gpt");
  assert.equal(choosePreferredModel(models, "removed-model"), null);
  assert.equal(choosePreferredModel([], "cpa-gpt"), null);
});

test("client settings updates preserve unrelated preferences", () => {
  assert.deepEqual(mergeClientSettings({ permissionMode: "ask", preferredModelId: "m1" }, { permissionMode: "always-approve" }), {
    permissionMode: "always-approve",
    preferredModelId: "m1",
  });
});
