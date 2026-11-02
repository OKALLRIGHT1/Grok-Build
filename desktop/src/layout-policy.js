(function exposeLayoutPolicy(global) {
  function conversationLayout({ messageCount = 0, busy = false, queueLength = 0 } = {}) {
    return Number(messageCount) > 0 || Boolean(busy) || Number(queueLength) > 0 ? "active" : "welcome";
  }

  const api = { conversationLayout };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.GrokLayoutPolicy = api;
}(typeof globalThis === "undefined" ? this : globalThis));
