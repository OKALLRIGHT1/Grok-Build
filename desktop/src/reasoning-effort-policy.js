(function registerReasoningEffortPolicy(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrokReasoningEffort = api;
})(globalThis, () => {
  const levels = ["none", "minimal", "low", "medium", "high", "xhigh"];

  function key(value) {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return normalized === "max" ? "xhigh" : normalized;
  }

  function rank(option) {
    const index = levels.indexOf(key(option?.value));
    return index < 0 ? null : index;
  }

  function optionsForModel(model) {
    const meta = model?.meta || model?._meta || {};
    const advertised = meta.reasoningEfforts ?? meta.reasoning_efforts ?? meta.reasoningEffortOptions;
    const rows = Array.isArray(advertised) && advertised.length ? advertised
      : meta.supportsReasoningEffort || meta.supports_reasoning_effort ? ["low", "medium", "high", "xhigh"] : [];
    const options = new Map();
    for (const row of rows) {
      const raw = typeof row === "string" ? { value: row } : row;
      if (!raw || typeof raw !== "object") continue;
      const value = typeof (raw.value ?? raw.id) === "string" ? (raw.value ?? raw.id).trim() : "";
      if (!value) continue;
      const option = {
        id: String(raw.id || value), value,
        label: String(raw.label || raw.name || value),
        default: raw.default === true,
      };
      const existing = options.get(key(value));
      if (!existing) options.set(key(value), option);
      else if (option.default) existing.default = true;
    }
    // Wire values define strength; catalog order, display names and custom IDs do not.
    return [...options.values()].sort((left, right) => (rank(left) ?? Infinity) - (rank(right) ?? Infinity));
  }

  function selectedIndex(options, currentValue, model) {
    const find = (value) => {
      const wireIndex = options.findIndex((option) => key(option.value) === key(value));
      return wireIndex >= 0 ? wireIndex : options.findIndex((option) => key(option.id) === key(value));
    };
    if (key(currentValue)) return find(currentValue);
    const meta = model?.meta || model?._meta || {};
    const modelDefault = meta.reasoningEffort ?? meta.reasoning_effort;
    if (key(modelDefault)) return find(modelDefault);
    return options.findIndex((option) => option.default);
  }

  function isHighest(options, selected) {
    if (options.length < 2 || !selected) return false;
    const ranks = options.map(rank);
    // An unrecognized future tier cannot safely be called the highest or lowest.
    return ranks.every((value) => value !== null) && rank(selected) === Math.max(...ranks);
  }

  function visualLevel(option) {
    const index = rank(option);
    return index === null ? "default" : levels[index];
  }

  return { optionsForModel, selectedIndex, isHighest, visualLevel };
});
