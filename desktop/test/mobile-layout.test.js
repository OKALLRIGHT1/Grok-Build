const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyViewport,
  changePanelState,
  groupSessions,
  isPanelOpen,
  readPanelState,
  writePanelState,
} = require("../src/mobile-layout");

test("viewport policy separates phones from iPad portrait and landscape", () => {
  assert.equal(classifyViewport({ width: 430, height: 850 }), "phone");
  assert.equal(classifyViewport({ width: 932, height: 430 }), "phone");
  assert.equal(classifyViewport({ width: 768, height: 1024 }), "tablet-portrait");
  assert.equal(classifyViewport({ width: 1024, height: 768 }), "tablet-landscape");
});

test("panel state defaults, persists, and rejects malformed storage", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };

  assert.deepEqual(readPanelState(storage), { leftOpen: true, rightOpen: false });
  assert.deepEqual(
    writePanelState(storage, { leftOpen: false, rightOpen: true }),
    { leftOpen: false, rightOpen: true },
  );
  assert.deepEqual(readPanelState(storage), { leftOpen: false, rightOpen: true });

  values.set("grok-remote.ipad-panels", "not-json");
  assert.deepEqual(readPanelState(storage), { leftOpen: true, rightOpen: false });
});

test("sessions group by workspace path without dropping metadata", () => {
  const groups = groupSessions([
    { id: "a", cwd: "C:/work/alpha", title: "Alpha", modelId: "m1" },
    { id: "b", cwd: "C:/work/beta", title: "Beta", modelId: "m2" },
    { id: "c", cwd: "C:/work/alpha", title: "Again", modelId: "m3" },
    { id: "d", title: "Loose" },
  ]);

  assert.deepEqual(
    groups.map((group) => [group.key, group.label, group.sessions.map((item) => item.id)]),
    [
      ["C:/work/alpha", "alpha", ["a", "c"]],
      ["C:/work/beta", "beta", ["b"]],
      ["__other__", "其他会话", ["d"]],
    ],
  );
  assert.equal(groups[0].sessions[0].modelId, "m1");
});

test("panel transitions persist landscape choices and isolate overlay drawers", () => {
  const initial = {
    mode: "tablet-landscape",
    landscapePanels: { leftOpen: true, rightOpen: false },
    drawerOpen: null,
  };
  const landscape = changePanelState(initial, "right", true);
  assert.deepEqual(landscape.landscapePanels, { leftOpen: true, rightOpen: true });
  assert.equal(isPanelOpen(landscape, "right"), true);

  const portrait = { ...landscape, mode: "tablet-portrait" };
  const leftDrawer = changePanelState(portrait, "left", true);
  assert.equal(leftDrawer.drawerOpen, "left");
  assert.equal(isPanelOpen(leftDrawer, "left"), true);
  assert.equal(isPanelOpen(leftDrawer, "right"), false);
  assert.deepEqual(leftDrawer.landscapePanels, { leftOpen: true, rightOpen: true });

  const closed = changePanelState(leftDrawer, "left", false);
  assert.equal(closed.drawerOpen, null);
  assert.equal(isPanelOpen(closed, "left"), false);
});
