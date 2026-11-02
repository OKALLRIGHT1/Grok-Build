(function attachMobileSessionSync(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GrokMobileSessionSync = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function keyOf(entry) {
    return `${entry.sessionId}:${entry.generation}:${entry.sequence}`;
  }

  function matches(active, data) {
    return Boolean(active)
      && String(data?.sessionId || "") === active.sessionId
      && Number(data?.generation) === active.generation;
  }

  function createSyncState() {
    return { active: null, seen: new Set(), liveBuffer: [] };
  }

  function beginSync(state, data) {
    const sessionId = String(data?.sessionId || "");
    const generation = Number(data?.generation);
    if (!sessionId || !Number.isInteger(generation)) throw new Error("同步数据无效");
    state.active = { sessionId, generation, nextChunk: 0, chunkCount: Number(data.chunkCount || 0) };
    state.seen.clear();
    state.liveBuffer = [];
    return state.active;
  }

  function acceptEntry(state, entry) {
    if (!matches(state.active, entry)) throw new Error("会话已切换，请重新同步");
    if (!Number.isInteger(Number(entry.sequence))) throw new Error("同步序号无效");
    const key = keyOf(entry);
    if (state.seen.has(key)) return null;
    state.seen.add(key);
    return entry;
  }

  function acceptChunk(state, data) {
    if (!matches(state.active, data)) throw new Error("会话已切换，请重新同步");
    if (Number(data.index) !== state.active.nextChunk) throw new Error("同步分块顺序无效");
    const accepted = (Array.isArray(data.entries) ? data.entries : [])
      .map((entry) => acceptEntry(state, entry))
      .filter(Boolean);
    state.active.nextChunk += 1;
    return accepted;
  }

  function acceptLive(state, entry) {
    if (!entry?.sessionId || !Number.isInteger(Number(entry.sequence))) return entry || null;
    if (state.active) {
      if (!matches(state.active, entry)) return null;
      state.liveBuffer.push(entry);
      return null;
    }
    const key = keyOf(entry);
    if (state.seen.has(key)) return null;
    state.seen.add(key);
    return entry;
  }

  function completeSync(state, data) {
    if (!matches(state.active, data)) throw new Error("会话已切换，请重新同步");
    if (state.active.nextChunk !== state.active.chunkCount) throw new Error("同步分块不完整");
    const buffered = state.liveBuffer
      .map((entry) => acceptEntry(state, entry))
      .filter(Boolean)
      .sort((left, right) => left.sequence - right.sequence);
    state.active = null;
    state.liveBuffer = [];
    return buffered;
  }

  return { acceptChunk, acceptLive, beginSync, completeSync, createSyncState };
});
