function mergeClientSettings(current, updates) {
  return {
    ...(current && typeof current === "object" ? current : {}),
    ...(updates && typeof updates === "object" ? updates : {}),
  };
}

function buildSessionMetadata(permissionMode, preferredModelId, extra = {}) {
  const mode = ["ask", "auto", "always-approve"].includes(permissionMode) ? permissionMode : "ask";
  const modelId = String(preferredModelId || "").trim();
  return {
    ...extra,
    yoloMode: mode === "always-approve",
    autoMode: mode === "auto",
    permissionMode: mode,
    ...(modelId ? { modelId } : {}),
  };
}

function choosePreferredModel(models, preferredModelId) {
  const preferred = String(preferredModelId || "").trim();
  if (!preferred || !Array.isArray(models)) return null;
  return models.some((model) => model?.id === preferred) ? preferred : null;
}

module.exports = { buildSessionMetadata, choosePreferredModel, mergeClientSettings };
