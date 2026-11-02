const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { BLOCK_END, BLOCK_START, ModelConfigStore, envKeyFor } = require("../src/model-config");

test("custom model store preserves unmanaged config and exposes decrypted environment", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-model-config-"));
  const configPath = path.join(root, ".grok", "config.toml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, "[ui]\ncompact = true\n");
  const store = new ModelConfigStore({
    directory: path.join(root, "desktop"),
    configPath,
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
  });
  store.save({
    id: "openai-main",
    name: "GPT",
    model: "gpt-4o",
    baseUrl: "https://api.openai.com/v1/",
    apiBackend: "responses",
    apiKey: "secret",
    contextWindow: 128000,
  });
  const config = fs.readFileSync(configPath, "utf8");
  assert.match(config, /\[ui\]\ncompact = true/);
  assert.match(config, /\[model\."openai-main"\]/);
  assert.match(config, /api_backend = "responses"/);
  assert.equal(store.environment()[envKeyFor("openai-main")], "secret");
  assert.equal(store.list()[0].hasApiKey, true);
});

function createStore(root) {
  return new ModelConfigStore({
    directory: path.join(root, "desktop"),
    configPath: path.join(root, ".grok", "config.toml"),
    encrypt: (value) => Buffer.from(value).toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
    now: () => 123456789,
  });
}

test("one provider expands multiple models with a shared API key and protocol defaults", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-provider-config-"));
  const store = createStore(root);

  store.saveProvider({
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1/",
    apiBackend: "responses",
    apiKey: "shared-secret",
  });
  store.saveModel("openai", {
    id: "openai-gpt-4o",
    name: "GPT-4o",
    model: "gpt-4o",
    contextWindow: 128000,
  });
  store.saveModel("openai", {
    id: "openai-gpt-4o-mini",
    name: "GPT-4o mini",
    model: "gpt-4o-mini",
    apiBackend: "chat_completions",
  });

  const [provider] = store.listProviders();
  assert.equal(provider.hasApiKey, true);
  assert.equal(provider.models.length, 2);
  assert.equal(store.environment()[envKeyFor("openai")], "shared-secret");

  const config = fs.readFileSync(path.join(root, ".grok", "config.toml"), "utf8");
  assert.match(config, /\[model\."openai-gpt-4o"\][\s\S]*api_backend = "responses"/);
  assert.match(config, /\[model\."openai-gpt-4o-mini"\][\s\S]*api_backend = "chat_completions"/);
  assert.equal((config.match(new RegExp(`env_key = "${envKeyFor("openai")}"`, "g")) || []).length, 2);
});

test("model identifier defaults to the display name", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-provider-model-default-"));
  const store = createStore(root);
  store.saveProvider({ id: "vendor", name: "Vendor", baseUrl: "https://vendor.example/v1", apiBackend: "responses" });

  store.saveModel("vendor", { id: "vendor-gpt", name: "gpt-5.6-sol" });

  assert.equal(store.listProviders()[0].models[0].model, "gpt-5.6-sol");
  assert.match(fs.readFileSync(path.join(root, ".grok", "config.toml"), "utf8"), /model = "gpt-5.6-sol"/);
});

test("legacy flat model settings migrate without changing model IDs or losing secrets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-provider-migration-"));
  const directory = path.join(root, "desktop");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "custom-models.json"), JSON.stringify([
    {
      id: "legacy-model",
      name: "Legacy Model",
      model: "legacy-v1",
      baseUrl: "https://legacy.example/v1",
      apiBackend: "chat_completions",
      contextWindow: 32000,
    },
  ]));
  fs.writeFileSync(path.join(directory, "model-secrets.json"), JSON.stringify({
    "legacy-model": Buffer.from("legacy-secret").toString("base64"),
  }));

  const store = createStore(root);
  const [provider] = store.listProviders();

  assert.equal(provider.id, "legacy-model");
  assert.equal(provider.models[0].id, "legacy-model");
  assert.equal(provider.models[0].model, "legacy-v1");
  assert.equal(store.environment()[envKeyFor(provider.id)], "legacy-secret");
  const migrated = JSON.parse(fs.readFileSync(path.join(directory, "custom-models.json"), "utf8"));
  assert.equal(migrated[0].models[0].id, "legacy-model");
});

test("removing one model keeps its provider and shared secret", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-provider-remove-"));
  const store = createStore(root);
  store.saveProvider({
    id: "vendor",
    name: "Vendor",
    baseUrl: "https://vendor.example/v1",
    apiBackend: "chat_completions",
    apiKey: "secret",
  });
  store.saveModel("vendor", { id: "model-a", name: "A", model: "a" });
  store.saveModel("vendor", { id: "model-b", name: "B", model: "b" });

  store.removeModel("vendor", "model-a");

  const [provider] = store.listProviders();
  assert.deepEqual(provider.models.map((model) => model.id), ["model-b"]);
  assert.equal(store.environment()[envKeyFor("vendor")], "secret");
});

test("provider model resolution returns one decrypted main-process probe target", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-provider-resolve-"));
  const store = createStore(root);
  store.saveProvider({
    id: "vendor",
    name: "Vendor",
    baseUrl: "https://vendor.example/v1",
    apiBackend: "responses",
    apiKey: "secret",
  });
  store.saveModel("vendor", { id: "model-a", name: "Model A", model: "model-v1" });

  assert.deepEqual(store.resolveModel("vendor", "model-a"), {
    providerId: "vendor",
    providerName: "Vendor",
    modelId: "model-a",
    name: "Model A",
    model: "model-v1",
    baseUrl: "https://vendor.example/v1",
    apiBackend: "responses",
    apiKey: "secret",
  });
});

test("provider model resolution rejects missing providers, models, and API keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-provider-resolve-errors-"));
  const store = createStore(root);
  store.saveProvider({ id: "vendor", name: "Vendor", baseUrl: "https://vendor.example/v1", apiBackend: "responses" });
  store.saveModel("vendor", { id: "model-a", name: "Model A" });

  assert.throws(() => store.resolveModel("missing", "model-a"), /供应商/);
  assert.throws(() => store.resolveModel("vendor", "missing"), /模型/);
  assert.throws(() => store.resolveModel("vendor", "model-a"), /API Key/);
});

test("editing a model ID replaces the original model instead of duplicating it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-provider-rename-"));
  const store = createStore(root);
  store.saveProvider({
    id: "vendor",
    name: "Vendor",
    baseUrl: "https://vendor.example/v1",
    apiBackend: "responses",
  });
  store.saveModel("vendor", { id: "old-id", name: "Model", model: "v1" });

  store.saveModel("vendor", { originalId: "old-id", id: "new-id", name: "Model", model: "v2" });

  const [provider] = store.listProviders();
  assert.deepEqual(provider.models.map((model) => model.id), ["new-id"]);
});

test("equivalent unmanaged TOML model is backed up and adopted into the managed block", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-provider-adopt-"));
  const configPath = path.join(root, ".grok", "config.toml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = [
    "[model.gpt]",
    'model = "gpt-5.6-sol"',
    'base_url = "http://vendor.example/v1"',
    'name = "gpt-5.6-sol"',
    'api_backend = "responses"',
    `env_key = "${envKeyFor("gpt")}"`,
    "",
    "[ui]",
    "compact = true",
    "",
  ].join("\n");
  fs.writeFileSync(configPath, original);
  const store = createStore(root);
  store.saveProvider({ id: "gpt", name: "Vendor", baseUrl: "http://vendor.example/v1", apiBackend: "responses" });
  const beforeAdoption = fs.readFileSync(configPath, "utf8");

  store.saveModel("gpt", { id: "gpt", name: "gpt-5.6-sol", model: "gpt-5.6-sol" });

  const config = fs.readFileSync(configPath, "utf8");
  assert.match(config, new RegExp(BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal((config.match(/\[model\.(?:gpt|"gpt")\]/g) || []).length, 1);
  assert.match(config, /\[ui\]\ncompact = true/);
  assert.equal(fs.readFileSync(`${configPath}.desktop-backup-123456789`, "utf8"), beforeAdoption);
});

test("different unmanaged TOML model remains untouched and returns a structured conflict", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-provider-conflict-"));
  const configPath = path.join(root, ".grok", "config.toml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = [
    "[model.gpt]",
    'model = "manual-model"',
    'base_url = "http://manual.example/v1"',
    'name = "Manual"',
    'api_backend = "responses"',
    `env_key = "${envKeyFor("gpt")}"`,
    "",
  ].join("\n");
  fs.writeFileSync(configPath, original);
  const store = createStore(root);
  store.saveProvider({ id: "gpt", name: "Vendor", baseUrl: "http://client.example/v1", apiBackend: "responses" });
  const beforeConflict = fs.readFileSync(configPath, "utf8");

  assert.throws(
    () => store.saveModel("gpt", { id: "gpt", name: "Client", model: "client-model" }),
    (error) => error.code === "MODEL_CONFIG_CONFLICT" && error.data?.modelId === "gpt",
  );
  assert.equal(fs.readFileSync(configPath, "utf8"), beforeConflict);
  assert.equal(fs.existsSync(`${configPath}.desktop-backup-123456789`), false);
});

test("keeping a manual conflict allows unrelated providers to be saved", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-provider-manual-"));
  const configPath = path.join(root, ".grok", "config.toml");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, [
    "[model.gpt]",
    'model = "manual"',
    'base_url = "http://manual.example/v1"',
    'name = "Manual"',
    'api_backend = "responses"',
    `env_key = "${envKeyFor("gpt")}"`,
    "",
  ].join("\n"));
  const store = createStore(root);
  store.saveProvider({ id: "gpt", name: "Vendor", baseUrl: "http://client.example/v1", apiBackend: "responses" });
  store.resolveConflict("gpt", "manual");

  store.saveProvider({ id: "other", name: "Other", baseUrl: "http://other.example/v1", apiBackend: "responses" });
  store.saveModel("other", { id: "other-model", name: "Other", model: "other-model" });

  const config = fs.readFileSync(configPath, "utf8");
  assert.match(config, /\[model\.gpt\]/);
  assert.match(config, /\[model\."other-model"\]/);
});

function writeManualConflict(configPath) {
  fs.writeFileSync(configPath, [
    "[model.gpt]",
    'model = "manual"',
    'base_url = "http://manual.example/v1"',
    'name = "Manual"',
    'api_backend = "responses"',
    `env_key = "${envKeyFor("gpt")}"`,
    "",
  ].join("\n"));
}

test("client conflict resolution backs up and replaces the manual block", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-provider-client-wins-"));
  const store = createStore(root);
  store.saveProvider({ id: "gpt", name: "Vendor", baseUrl: "http://client.example/v1", apiBackend: "responses" });
  store.saveModel("gpt", { id: "gpt", name: "Client", model: "client" });
  const configPath = path.join(root, ".grok", "config.toml");
  writeManualConflict(configPath);

  store.resolveConflict("gpt", "client");

  const config = fs.readFileSync(configPath, "utf8");
  assert.doesNotMatch(config, /model = "manual"/);
  assert.match(config, /\[model\."gpt"\][\s\S]*model = "client"/);
  assert.match(fs.readFileSync(`${configPath}.desktop-backup-123456789`, "utf8"), /model = "manual"/);
});

test("rename conflict resolution keeps manual config and renames the client model", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "grok-provider-rename-conflict-"));
  const store = createStore(root);
  store.saveProvider({ id: "gpt", name: "Vendor", baseUrl: "http://client.example/v1", apiBackend: "responses" });
  store.saveModel("gpt", { id: "gpt", name: "Client", model: "client" });
  const configPath = path.join(root, ".grok", "config.toml");
  writeManualConflict(configPath);

  const [provider] = store.resolveConflict("gpt", "rename");

  assert.equal(provider.models[0].id, "gpt-2");
  const config = fs.readFileSync(configPath, "utf8");
  assert.match(config, /\[model\.gpt\][\s\S]*model = "manual"/);
  assert.match(config, /\[model\."gpt-2"\][\s\S]*model = "client"/);
});
