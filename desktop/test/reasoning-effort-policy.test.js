const test = require("node:test");
const assert = require("node:assert/strict");
const { optionsForModel, selectedIndex, isHighest, visualLevel } = require("../src/reasoning-effort-policy");

const descendingModel = { meta: { reasoningEfforts: [
  { id: "deep", value: "xhigh", label: "Extra High" },
  { id: "high", value: "high", label: "High" },
  { id: "medium", value: "medium", label: "Medium", default: true },
  { id: "low", value: "low", label: "Low" },
] } };

test("descending CLI catalogs display Low on the left and Extra High on the right", () => {
  const options = optionsForModel(descendingModel);
  assert.deepEqual(options.map((option) => option.value), ["low", "medium", "high", "xhigh"]);
  const low = selectedIndex(options, "low", descendingModel);
  assert.equal(low, 0);
  assert.equal(options[low].label, "Low");
  assert.equal(isHighest(options, options[low]), false);
  assert.equal(visualLevel(options[low]), "low");
  assert.equal(isHighest(options, options[3]), true);
  assert.equal(options[3].label, "Extra High");
});

test("arbitrarily ordered string and object tiers sort by wire value, not labels or IDs", () => {
  const options = optionsForModel({ meta: { reasoningEfforts: [
    { id: "tiny", value: "xhigh", label: "Small" }, "none", "high",
    { id: "largest", value: "low", label: "Highest" }, "minimal", "medium",
  ] } });
  assert.deepEqual(options.map((option) => option.value), ["none", "minimal", "low", "medium", "high", "xhigh"]);
  assert.equal(isHighest(options, options[2]), false);
  assert.equal(isHighest(options, options[5]), true);
  assert.equal(selectedIndex(options, "tiny"), 5);
});

test("current state, model default and advertised default are resolved in that order", () => {
  const model = { meta: { ...descendingModel.meta, reasoningEffort: "high" } };
  const options = optionsForModel(model);
  assert.equal(selectedIndex(options, "low", model), 0);
  assert.equal(selectedIndex(options, null, model), 2);
  assert.equal(selectedIndex(options, null, descendingModel), 1);
  assert.equal(selectedIndex(options, "not-advertised", model), -1);
  assert.equal(selectedIndex(optionsForModel({ meta: { reasoningEfforts: ["xhigh", "low"] } }), null), -1);
});

test("canonical max alias selects xhigh; duplicate aliases do not create extra slider stops", () => {
  const options = optionsForModel({ _meta: { reasoning_efforts: ["max", "low", { value: "xhigh", default: true }] } });
  assert.deepEqual(options.map((option) => option.value), ["low", "max"]);
  assert.equal(selectedIndex(options, "XHIGH"), 1);
  assert.equal(selectedIndex(options, " MAX "), 1);
  assert.equal(selectedIndex(options, null), 1);
  assert.equal(isHighest(options, options[1]), true);
  assert.equal(visualLevel(options[1]), "xhigh");
});

test("wire values take precedence over colliding presentation IDs", () => {
  const options = optionsForModel({ meta: { reasoningEfforts: [{ id: "high", value: "low" }, { id: "deep", value: "high" }] } });
  assert.equal(selectedIndex(options, "high"), 1);
});

test("unsupported or unknown tiers never receive a guessed highest-strength badge", () => {
  assert.deepEqual(optionsForModel({}), []);
  const single = optionsForModel({ meta: { reasoningEfforts: ["low"] } });
  assert.equal(isHighest(single, single[0]), false);
  const unknown = optionsForModel({ meta: { reasoningEfforts: ["low", "quantum", "high"] } });
  assert.equal(selectedIndex(unknown, "quantum"), 2);
  assert.equal(isHighest(unknown, unknown[1]), false);
  assert.equal(isHighest(unknown, unknown[2]), false);
  assert.equal(isHighest(unknown, null), false);
  assert.equal(visualLevel(unknown[2]), "default");
});

test("legacy supports flag provides ascending built-in levels and ignores invalid rows", () => {
  assert.deepEqual(optionsForModel({ meta: { supportsReasoningEffort: true } }).map((option) => option.value), ["low", "medium", "high", "xhigh"]);
  assert.deepEqual(optionsForModel({ meta: { reasoningEfforts: [null, {}, 7, { value: "" }, "high", "low"] } }).map((option) => option.value), ["low", "high"]);
});
