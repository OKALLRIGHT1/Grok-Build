(function exposeMobileLayout(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GrokMobileLayout = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  const PANEL_STATE_KEY = "grok-remote.ipad-panels";
  const DEFAULT_PANEL_STATE = Object.freeze({ leftOpen: true, rightOpen: false });

  function defaultPanelState() {
    return { ...DEFAULT_PANEL_STATE };
  }

  function classifyViewport({ width, height }) {
    const viewportWidth = Number(width) || 0;
    const viewportHeight = Number(height) || 0;
    if (viewportWidth > viewportHeight && viewportWidth >= 980 && viewportHeight >= 650) {
      return "tablet-landscape";
    }
    if (viewportHeight >= viewportWidth && viewportWidth >= 700) return "tablet-portrait";
    return "phone";
  }

  function normalizePanelState(value) {
    if (!value || typeof value.leftOpen !== "boolean" || typeof value.rightOpen !== "boolean") {
      return defaultPanelState();
    }
    return { leftOpen: value.leftOpen, rightOpen: value.rightOpen };
  }

  function readPanelState(storage) {
    try {
      const raw = storage?.getItem(PANEL_STATE_KEY);
      return raw ? normalizePanelState(JSON.parse(raw)) : defaultPanelState();
    } catch {
      return defaultPanelState();
    }
  }

  function writePanelState(storage, value) {
    const normalized = normalizePanelState(value);
    try {
      storage?.setItem(PANEL_STATE_KEY, JSON.stringify(normalized));
    } catch {
      // Storage can be unavailable in private browsing; layout remains usable in memory.
    }
    return normalized;
  }

  function workspaceLabel(cwd) {
    const parts = String(cwd || "").split(/[\\/]/).filter(Boolean);
    return parts.at(-1) || "其他会话";
  }

  function groupSessions(sessions) {
    const groups = new Map();
    for (const session of Array.isArray(sessions) ? sessions : []) {
      const key = String(session?.cwd || "").trim() || "__other__";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: key === "__other__" ? "其他会话" : workspaceLabel(key),
          sessions: [],
        });
      }
      groups.get(key).sessions.push(session);
    }
    return [...groups.values()];
  }

  function isPanelOpen(state, side) {
    if (state?.mode === "tablet-landscape") {
      return Boolean(state.landscapePanels?.[side === "left" ? "leftOpen" : "rightOpen"]);
    }
    return state?.drawerOpen === side;
  }

  function changePanelState(state, side, open) {
    if (side !== "left" && side !== "right") throw new TypeError("side must be left or right");
    const next = {
      ...state,
      landscapePanels: normalizePanelState(state?.landscapePanels),
      drawerOpen: state?.drawerOpen === "left" || state?.drawerOpen === "right" ? state.drawerOpen : null,
    };
    if (next.mode === "tablet-landscape") {
      next.landscapePanels = {
        ...next.landscapePanels,
        [side === "left" ? "leftOpen" : "rightOpen"]: Boolean(open),
      };
      next.drawerOpen = null;
    } else if (open) {
      next.drawerOpen = side;
    } else if (next.drawerOpen === side) {
      next.drawerOpen = null;
    }
    return next;
  }

  return {
    PANEL_STATE_KEY,
    changePanelState,
    classifyViewport,
    groupSessions,
    isPanelOpen,
    readPanelState,
    writePanelState,
  };
}));
