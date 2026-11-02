function unwrapExtResult(value) {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== "object" || Array.isArray(current)) break;
    if (Object.hasOwn(current, "error")) {
      const error = new Error(typeof current.error === "string" ? current.error : current.error?.message || "Grok 扩展请求失败");
      error.data = current.error;
      throw error;
    }
    if (!Object.hasOwn(current, "result")) break;
    current = current.result;
  }
  return current;
}

function modelId(model) {
  return model?.modelId ?? model?.id ?? model?.model_id ?? null;
}

function normalizeModelState(...sources) {
  const source = sources.find((item) => item && typeof item === "object") || {};
  const available = source.availableModels ?? source.available_models ?? source.models ?? [];
  const models = (Array.isArray(available) ? available : Object.values(available)).map((model) => ({
    id: modelId(model),
    name: model.name || model.displayName || modelId(model),
    description: model.description || "",
    meta: model._meta || model.meta || {},
  })).filter((model) => model.id);
  return {
    currentModelId: source.currentModelId ?? source.current_model_id ?? source.current ?? models[0]?.id ?? null,
    reasoningEffort: source.reasoningEffort ?? source.reasoning_effort ?? null,
    models,
  };
}

function normalizeModeState(...sources) {
  const source = sources.find((item) => item && typeof item === "object") || {};
  const available = source.availableModes ?? source.available_modes ?? source.modes ?? [];
  const modes = (Array.isArray(available) ? available : Object.values(available)).map((mode) => ({
    id: mode.id ?? mode.modeId ?? mode.mode_id,
    name: mode.name || mode.label || mode.id,
    description: mode.description || "",
  })).filter((mode) => mode.id);
  return {
    currentModeId: source.currentModeId ?? source.current_mode_id ?? source.current ?? modes[0]?.id ?? null,
    modes,
  };
}

function centValue(value) {
  if (typeof value === "number") return value;
  return Number(value?.val ?? value?.value ?? 0) || 0;
}

function normalizeBilling(response) {
  const billing = unwrapExtResult(response) || {};
  const config = billing.config || null;
  if (!config) return { available: false, subscriptionTier: billing.subscriptionTier || billing.subscription_tier || null };
  const legacyLimit = Math.abs(centValue(config.monthlyLimit));
  const legacyUsed = Math.abs(centValue(config.used));
  const usagePercent = Number.isFinite(config.creditUsagePercent)
    ? config.creditUsagePercent
    : legacyLimit > 0 ? (legacyUsed / legacyLimit) * 100 : 0;
  return {
    available: true,
    subscriptionTier: billing.subscriptionTier || billing.subscription_tier || null,
    usagePercent: Math.max(0, Math.min(100, usagePercent)),
    periodType: config.currentPeriod?.type || null,
    periodStart: config.currentPeriod?.start || config.billingPeriodStart || null,
    periodEnd: config.currentPeriod?.end || config.billingPeriodEnd || null,
    prepaidBalanceCents: Math.abs(centValue(config.prepaidBalance)),
    onDemandEnabled: Boolean(billing.onDemandEnabled ?? billing.on_demand_enabled),
    onDemandCapCents: Math.abs(centValue(config.onDemandCap)),
    onDemandUsedCents: Math.abs(centValue(config.onDemandUsed)),
    unifiedBilling: config.isUnifiedBillingUser ?? null,
    history: Array.isArray(config.history) ? config.history : [],
  };
}

function normalizeSessionList(response) {
  const payload = unwrapExtResult(response) || {};
  const overview = payload.all_sessions || payload.allSessions;
  const rows = overview && typeof overview === "object"
    ? Object.entries(overview).flatMap(([cwd, sessions]) => (Array.isArray(sessions) ? sessions : []).map((session) => ({ ...session, cwd: session.cwd || session.info?.cwd || cwd })))
    : Array.isArray(payload) ? payload : payload.sessions || payload.sessionSummaries || payload.session_summaries || [];
  return {
    sessions: rows.filter((session) => {
      const count = session.numMessages ?? session.num_messages ?? session.messageCount;
      const title = String(session.title || session.generatedTitle || session.generated_title || "").trim();
      const manuallyNamed = session.titleIsManual === true || session.title_is_manual === true;
      const hasContent = session.firstPrompt || session.first_prompt || session.summary || session.sessionSummary || session.session_summary;
      // An absent message count is unknown, not proof of an empty conversation.
      return !(count === 0 && !manuallyNamed && !hasContent && /^(?:未命名会话|untitled(?: session)?|new session)?$/i.test(title));
    }).map((session) => ({
      id: session.sessionId ?? session.session_id ?? session.info?.id ?? session.id,
      title: session.title || session.generatedTitle || session.generated_title || session.summary || session.sessionSummary || session.session_summary || session.firstPrompt || session.first_prompt || "未命名会话",
      firstPrompt: session.firstPrompt || session.first_prompt || "",
      cwd: session.cwd || session.info?.cwd || "",
      modelId: session.modelId || session.model_id || null,
      source: session.source || "local",
      messageCount: session.numMessages ?? session.num_messages ?? session.messageCount ?? 0,
      updatedAt: session.lastActiveAt || session.last_active_at || session.updatedAt || session.createdAt || session.created_at || null,
      kind: session._meta?.["x.ai/session"]?.kind || "build",
    })).filter((session) => session.id),
    nextCursor: payload.nextCursor || null,
    partial: payload._meta?.["x.ai/partial"] || null,
  };
}

module.exports = {
  normalizeBilling,
  normalizeModeState,
  normalizeModelState,
  normalizeSessionList,
  unwrapExtResult,
};
