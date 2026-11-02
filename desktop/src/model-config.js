const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const BLOCK_START = "# >>> grok-build-desktop managed models >>>";
const BLOCK_END = "# <<< grok-build-desktop managed models <<<";
const API_BACKENDS = new Set(["chat_completions", "responses", "messages"]);

function tomlString(value) {
  return JSON.stringify(String(value));
}

function requiredId(value, label) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) {
    throw new Error(`${label}只能包含字母、数字、点、下划线和短横线`);
  }
  return id;
}

function optionalNumber(value, minimum, maximum) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error("模型数值配置超出允许范围");
  }
  return number;
}

function normalizeBaseUrl(value) {
  const baseUrl = String(value || "").trim().replace(/\/$/, "");
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error("请输入有效的 API 地址");
  }
  if (!new Set(["http:", "https:"]).has(parsedUrl.protocol)) {
    throw new Error("API 地址必须使用 HTTP 或 HTTPS");
  }
  return baseUrl;
}

function validateBackend(value, fallback = "chat_completions") {
  if (value == null || value === "") return fallback;
  if (!API_BACKENDS.has(value)) throw new Error("不支持的接口协议");
  return value;
}

function validateProvider(input) {
  const id = requiredId(input?.id, "供应商 ID");
  const name = String(input?.name || id).trim();
  if (!name) throw new Error("供应商名称不能为空");
  return {
    id,
    name,
    baseUrl: normalizeBaseUrl(input?.baseUrl),
    apiBackend: validateBackend(input?.apiBackend),
  };
}

function validateProviderModel(input) {
  const id = requiredId(input?.id, "模型配置 ID");
  const name = String(input?.name || id).trim();
  const model = String(input?.model || name).trim();
  if (!name || !model) throw new Error("模型名称和模型标识不能为空");
  return {
    id,
    name,
    model,
    apiBackend: input?.apiBackend ? validateBackend(input.apiBackend) : null,
    contextWindow: optionalNumber(input?.contextWindow, 1024, 10000000),
    maxCompletionTokens: optionalNumber(input?.maxCompletionTokens, 1, 1000000),
    temperature: optionalNumber(input?.temperature, 0, 2),
    topP: optionalNumber(input?.topP, 0, 1),
  };
}

function validateModel(input) {
  const provider = validateProvider(input);
  return { ...validateProviderModel(input), baseUrl: provider.baseUrl, apiBackend: provider.apiBackend };
}

function envKeyFor(id) {
  return `GROK_DESKTOP_API_${crypto.createHash("sha256").update(id).digest("hex").slice(0, 12).toUpperCase()}`;
}

function parseTomlScalar(raw) {
  const value = String(raw || "").trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (/^(?:true|false)$/.test(value)) return value === "true";
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
  return value;
}

function modelBlocks(toml) {
  const blocks = [];
  const header = /^\s*\[model\.(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9._-]+))\]\s*(?:#.*)?$/gm;
  let match;
  while ((match = header.exec(toml))) {
    const contentStart = header.lastIndex;
    const nextHeader = /^\s*\[[^\]]+\].*$/m.exec(toml.slice(contentStart));
    const end = nextHeader ? contentStart + nextHeader.index : toml.length;
    const text = toml.slice(match.index, end);
    const fields = {};
    for (const line of text.split(/\r?\n/).slice(1)) {
      const assignment = /^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/.exec(line);
      if (assignment) fields[assignment[1]] = parseTomlScalar(assignment[2]);
    }
    blocks.push({ id: match[1] || match[2] || match[3], start: match.index, end, text, fields });
    header.lastIndex = end;
  }
  return blocks;
}

function expectedTomlFields(model) {
  const fields = {
    model: model.model,
    base_url: model.baseUrl,
    name: model.name,
    api_backend: model.apiBackend,
    env_key: model.envKey,
  };
  if (model.contextWindow != null) fields.context_window = model.contextWindow;
  if (model.maxCompletionTokens != null) fields.max_completion_tokens = model.maxCompletionTokens;
  if (model.temperature != null) fields.temperature = model.temperature;
  if (model.topP != null) fields.top_p = model.topP;
  return fields;
}

function equivalentModelBlock(block, model) {
  const actual = { ...block.fields };
  const expected = expectedTomlFields(model);
  if (typeof actual.base_url === "string") actual.base_url = actual.base_url.replace(/\/$/, "");
  expected.base_url = expected.base_url.replace(/\/$/, "");
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)
    && expectedKeys.every((key) => actual[key] === expected[key]);
}

function removeBlocks(toml, blocks) {
  let next = toml;
  for (const block of [...blocks].sort((left, right) => right.start - left.start)) {
    next = `${next.slice(0, block.start)}${next.slice(block.end)}`;
  }
  return next.replace(/^\s*\n/, "");
}

class ModelConfigStore {
  constructor(options) {
    this.directory = options.directory;
    this.configPath = options.configPath;
    this.encrypt = options.encrypt;
    this.decrypt = options.decrypt;
    this.now = options.now || (() => Date.now());
    this.settingsPath = path.join(this.directory, "custom-models.json");
    this.secretsPath = path.join(this.directory, "model-secrets.json");
    this.resolutionsPath = path.join(this.directory, "model-conflict-resolutions.json");
  }

  readJson(file, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  }

  writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.desktop.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
    fs.renameSync(temporary, file);
  }

  readSecrets() {
    return this.readJson(this.secretsPath, {});
  }

  readProviders() {
    const settings = this.readJson(this.settingsPath, []);
    if (!Array.isArray(settings) || !settings.length) return [];
    if (settings.every((provider) => Array.isArray(provider?.models))) return settings;
    return this.migrateLegacy(settings);
  }

  migrateLegacy(models) {
    const oldSecrets = this.readSecrets();
    const providers = [];
    const providerBySignature = new Map();
    const nextSecrets = {};

    for (const legacy of models) {
      const validated = validateModel(legacy);
      const encryptedSecret = oldSecrets[validated.id] || "";
      const signature = `${validated.baseUrl}\n${validated.apiBackend}\n${encryptedSecret}`;
      let provider = providerBySignature.get(signature);
      if (!provider) {
        let host = validated.name;
        try {
          host = new URL(validated.baseUrl).hostname;
        } catch {}
        provider = {
          id: validated.id,
          name: host,
          baseUrl: validated.baseUrl,
          apiBackend: validated.apiBackend,
          models: [],
        };
        providers.push(provider);
        providerBySignature.set(signature, provider);
        if (encryptedSecret) nextSecrets[provider.id] = encryptedSecret;
      }
      provider.models.push({
        id: validated.id,
        name: validated.name,
        model: validated.model,
        apiBackend: null,
        contextWindow: validated.contextWindow,
        maxCompletionTokens: validated.maxCompletionTokens,
        temperature: validated.temperature,
        topP: validated.topP,
      });
    }

    this.writeJson(this.settingsPath, providers);
    this.writeJson(this.secretsPath, nextSecrets);
    this.syncConfig(providers);
    return providers;
  }

  listProviders() {
    const secrets = this.readSecrets();
    const resolutions = this.readJson(this.resolutionsPath, {});
    return this.readProviders().map((provider) => ({
      ...provider,
      models: (provider.models || []).map((model) => ({
        ...model,
        managedExternally: resolutions[model.id] === "manual",
      })),
      hasApiKey: Boolean(secrets[provider.id]),
    }));
  }

  resolveConflict(modelId, action) {
    const id = requiredId(modelId, "模型配置 ID");
    if (!new Set(["client", "manual", "rename"]).has(action)) throw new Error("不支持的冲突处理方式");
    const providers = this.readProviders();
    const resolutions = this.readJson(this.resolutionsPath, {});
    if (action === "rename") {
      const model = providers.flatMap((provider) => provider.models || []).find((item) => item.id === id);
      if (!model) throw new Error("冲突模型不存在或尚未保存");
      const used = new Set([
        ...providers.flatMap((provider) => (provider.models || []).map((item) => item.id)),
        ...modelBlocks(this.readConfig()).map((block) => block.id),
      ]);
      let suffix = 2;
      let nextId = `${id}-${suffix}`;
      while (used.has(nextId)) nextId = `${id}-${++suffix}`;
      model.id = nextId;
      delete resolutions[id];
      this.writeJson(this.resolutionsPath, resolutions);
      this.persist(providers, this.readSecrets());
      return this.listProviders();
    }
    resolutions[id] = action;
    this.writeJson(this.resolutionsPath, resolutions);
    this.syncConfig(providers);
    if (action === "client") {
      delete resolutions[id];
      this.writeJson(this.resolutionsPath, resolutions);
    }
    return this.listProviders();
  }

  saveProvider(input) {
    const value = validateProvider(input);
    const providers = this.readProviders();
    const index = providers.findIndex((provider) => provider.id === value.id);
    const provider = { ...value, models: index === -1 ? [] : providers[index].models || [] };
    if (index === -1) providers.push(provider);
    else providers[index] = provider;

    const secrets = this.readSecrets();
    if (input?.clearApiKey) delete secrets[provider.id];
    else if (typeof input?.apiKey === "string" && input.apiKey.trim()) {
      secrets[provider.id] = this.encrypt(input.apiKey.trim());
    }
    this.persist(providers, secrets);
    return this.listProviders();
  }

  removeProvider(id) {
    const providerId = String(id || "");
    const providers = this.readProviders().filter((provider) => provider.id !== providerId);
    const secrets = this.readSecrets();
    delete secrets[providerId];
    this.persist(providers, secrets);
    return this.listProviders();
  }

  saveModel(providerId, input) {
    const providers = this.readProviders();
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) throw new Error("供应商不存在或已被删除");
    const model = validateProviderModel(input);
    const originalId = input?.originalId ? requiredId(input.originalId, "原模型配置 ID") : model.id;
    for (const item of providers) {
      const conflicting = (item.models || []).some((candidate) => (
        candidate.id === model.id && !(item.id === providerId && candidate.id === originalId)
      ));
      if (conflicting) {
        throw new Error(`模型配置 ID ${model.id} 已被使用`);
      }
    }
    const models = provider.models || [];
    const index = models.findIndex((item) => item.id === originalId);
    if (index === -1) models.push(model);
    else models[index] = model;
    provider.models = models;
    this.persist(providers, this.readSecrets());
    return this.listProviders();
  }

  removeModel(providerId, modelId) {
    const providers = this.readProviders();
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) throw new Error("供应商不存在或已被删除");
    provider.models = (provider.models || []).filter((model) => model.id !== modelId);
    this.persist(providers, this.readSecrets());
    return this.listProviders();
  }

  persist(providers, secrets) {
    this.syncConfig(providers);
    this.writeJson(this.settingsPath, providers);
    this.writeJson(this.secretsPath, secrets);
  }

  environment() {
    const env = {};
    for (const [id, encrypted] of Object.entries(this.readSecrets())) {
      try {
        env[envKeyFor(id)] = this.decrypt(encrypted);
      } catch {
        // Ignore secrets that cannot be decrypted for the current Windows user.
      }
    }
    return env;
  }

  resolveModel(providerId, modelId) {
    const provider = this.readProviders().find((item) => item.id === providerId);
    if (!provider) throw new Error("供应商不存在或已被删除");
    const model = (provider.models || []).find((item) => item.id === modelId);
    if (!model) throw new Error("模型不存在或已被删除");
    const encrypted = this.readSecrets()[provider.id];
    if (!encrypted) throw new Error("该供应商尚未保存 API Key");
    let apiKey;
    try {
      apiKey = this.decrypt(encrypted);
    } catch {
      throw new Error("API Key 无法由当前 Windows 用户解密，请重新保存");
    }
    return {
      providerId: provider.id,
      providerName: provider.name,
      modelId: model.id,
      name: model.name,
      model: model.model,
      baseUrl: provider.baseUrl,
      apiBackend: model.apiBackend || provider.apiBackend,
      apiKey,
    };
  }

  flatten(providers) {
    return providers.flatMap((provider) => (provider.models || []).map((model) => ({
      ...model,
      baseUrl: provider.baseUrl,
      apiBackend: model.apiBackend || provider.apiBackend,
      envKey: envKeyFor(provider.id),
    })));
  }

  readConfig() {
    try {
      return fs.readFileSync(this.configPath, "utf8");
    } catch {
      return "";
    }
  }

  renderModelsBlock(models) {
    const lines = [BLOCK_START, "# 此区块由 Grok Build Windows 客户端维护，请在客户端中编辑。"]; 
    for (const model of models) {
      lines.push("", `[model.${tomlString(model.id)}]`);
      lines.push(`model = ${tomlString(model.model)}`);
      lines.push(`base_url = ${tomlString(model.baseUrl)}`);
      lines.push(`name = ${tomlString(model.name)}`);
      lines.push(`api_backend = ${tomlString(model.apiBackend)}`);
      lines.push(`env_key = ${tomlString(model.envKey)}`);
      if (model.contextWindow != null) lines.push(`context_window = ${model.contextWindow}`);
      if (model.maxCompletionTokens != null) lines.push(`max_completion_tokens = ${model.maxCompletionTokens}`);
      if (model.temperature != null) lines.push(`temperature = ${model.temperature}`);
      if (model.topP != null) lines.push(`top_p = ${model.topP}`);
    }
    lines.push("", BLOCK_END);
    return lines.join("\n");
  }

  renderBlock(providers) {
    return this.renderModelsBlock(this.flatten(providers));
  }

  syncConfig(providers = this.readProviders()) {
    const current = this.readConfig();
    const blockPattern = new RegExp(`${BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "m");
    let unmanaged = current.replace(blockPattern, "");
    const blocks = modelBlocks(unmanaged);
    const blockById = new Map(blocks.map((block) => [block.id, block]));
    const resolutions = this.readJson(this.resolutionsPath, {});
    const adopted = [];
    const managedModels = [];
    for (const model of this.flatten(providers)) {
      const existing = blockById.get(model.id);
      if (!existing) {
        managedModels.push(model);
      } else if (equivalentModelBlock(existing, model) || resolutions[model.id] === "client") {
        adopted.push(existing);
        managedModels.push(model);
      } else if (resolutions[model.id] !== "manual") {
        const error = new Error(`config.toml 中的模型 ${model.id} 与客户端配置不同`);
        error.code = "MODEL_CONFIG_CONFLICT";
        error.data = { modelId: model.id, actions: ["client", "manual", "rename"] };
        throw error;
      }
    }
    if (adopted.length) {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      fs.writeFileSync(`${this.configPath}.desktop-backup-${this.now()}`, current);
      unmanaged = removeBlocks(unmanaged, adopted);
    }
    const next = `${unmanaged.trimEnd()}${unmanaged.trim() ? "\n\n" : ""}${this.renderModelsBlock(managedModels)}\n`;
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const temporary = `${this.configPath}.desktop.tmp`;
    fs.writeFileSync(temporary, next);
    fs.renameSync(temporary, this.configPath);
  }

  // Compatibility for older renderer code during migration to provider IPC.
  list() {
    return this.listProviders().flatMap((provider) => provider.models.map((model) => ({
      ...model,
      baseUrl: provider.baseUrl,
      apiBackend: model.apiBackend || provider.apiBackend,
      hasApiKey: provider.hasApiKey,
    })));
  }

  save(input) {
    const id = requiredId(input?.id, "模型配置 ID");
    this.saveProvider({ ...input, id });
    this.saveModel(id, { ...input, id, apiBackend: null });
    return this.list();
  }

  remove(id) {
    return this.removeProvider(id) && this.list();
  }
}

module.exports = {
  BLOCK_END,
  BLOCK_START,
  ModelConfigStore,
  envKeyFor,
  validateModel,
  validateProvider,
  validateProviderModel,
};
