const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("desktop document exposes usability controls", () => {
  const html = read("src/renderer/index.html");
  for (const id of [
    "jump-to-latest",
    "startup-health",
    "permission-risk",
    "permission-target",
    "permission-details",
    "composer-submit-mode",
    "cancel-queue-edit",
    "user-avatar-preview",
    "assistant-avatar-preview",
    "recover-prompt",
    "task-status",
    "task-status-icon",
    "task-status-label",
    "plan-approval-banner",
    "reopen-plan-approval",
    "model-check-dialog",
    "model-check-fast",
    "model-check-real",
    "model-check-credit-warning",
    "model-check-result",
    "client-version",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing desktop #${id}`);
  }
});

test("mobile document exposes equivalent task controls", () => {
  const html = read("src/mobile/index.html");
  for (const id of [
    "mobile-jump-to-latest",
    "mobile-permission-risk",
    "mobile-permission-target",
    "mobile-permission-details",
    "mobile-composer-submit-mode",
    "mobile-cancel-queue-edit",
    "mobile-recover-prompt",
    "mobile-task-status",
    "mobile-task-status-icon",
    "mobile-task-status-label",
    "mobile-plan-approval-banner",
    "mobile-reopen-plan-approval",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing mobile #${id}`);
  }
});

test("desktop renderer uses shared UX policy for every high priority interaction", () => {
  const source = read("src/renderer/renderer.js");
  assert.match(source, /GrokUxPolicy\.isNearBottom/);
  assert.match(source, /GrokUxPolicy\.describeError/);
  assert.match(source, /GrokUxPolicy\.describePermission/);
  assert.match(source, /GrokUxPolicy\.describeHealth/);
  assert.match(source, /GrokUxPolicy\.describeComposer/);
  assert.match(source, /STREAM_RENDER_DELAY\s*=\s*100/);
  assert.match(source, /TOOL_RENDER_DELAY\s*=\s*120/);
  assert.match(source, /turn-progress/);
  assert.match(source, /error-card/);
  assert.match(source, /applyAvatars/);
  assert.match(source, /editUserPrompt/);
  assert.match(source, /consumeRecoveredPrompt/);
  assert.match(source, /runModelCheck/);
  assert.match(source, /checkModelAvailability/);
  assert.match(source, /onTaskStatus/);
  assert.match(source, /renderTaskStatus/);
  assert.match(source, /interrupted/);
  assert.match(source, /case "task_completed":/);
  assert.match(source, /connectionAttemptInFlight/);
  assert.match(source, /drop/);
  assert.match(source, /paste/);
  assert.match(source, /dragover/);
});

test("desktop connection startup uses generation ownership before cleanup", () => {
  const source = read("src/main.js");
  assert.match(source, /ConnectionGeneration/);
  assert.match(source, /connectionGeneration\.begin\(\)/);
  assert.match(source, /expectedGeneration/);
  assert.match(source, /isCurrent\(generation\)/);
});

test("main process applies session policy and classifies backend failures", () => {
  const source = read("src/main.js");
  assert.match(source, /buildSessionMetadata/);
  assert.match(source, /choosePreferredModel/);
  assert.match(source, /normalizePermissionRequest/);
  assert.match(source, /backgroundTaskFailure/);
  assert.match(source, /fatalModelFailure/);
  assert.match(source, /appVersion:\s*app\.getVersion\(\)/);
});

test("mobile renderer uses shared UX policy and matches stream cadence", () => {
  const source = read("src/mobile/app.js");
  assert.match(source, /GrokUxPolicy\.isNearBottom/);
  assert.match(source, /GrokUxPolicy\.describeError/);
  assert.match(source, /GrokUxPolicy\.describePermission/);
  assert.match(source, /GrokUxPolicy\.describeComposer/);
  assert.match(source, /STREAM_RENDER_DELAY\s*=\s*100/);
  assert.match(source, /TOOL_RENDER_DELAY\s*=\s*120/);
  assert.match(source, /turn-progress/);
  assert.match(source, /error-card/);
  assert.match(source, /applyAvatars/);
  assert.match(source, /editUserPrompt/);
  assert.match(source, /recover-prompt/);
  assert.match(source, /task-status/);
  assert.match(source, /renderTaskStatus/);
  assert.match(source, /interrupted/);
  assert.match(source, /case "task_completed":/);
});

test("task status strips inherit the global hidden attribute safeguard", () => {
  const desktopCss = read("src/renderer/styles.css");
  const mobileCss = read("src/mobile/styles.css");
  assert.match(desktopCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
  assert.match(mobileCss, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test("markdown tables keep Chinese labels readable and scroll on narrow screens", () => {
  const desktopCss = read("src/renderer/styles.css");
  const mobileCss = read("src/mobile/styles.css");

  for (const css of [desktopCss, mobileCss]) {
    assert.match(css, /\.message-content\s+table\s*\{/);
    assert.match(css, /\.message-content\s+(?:th|td):first-child/);
    assert.match(css, /white-space:\s*nowrap/);
    assert.match(css, /word-break:\s*keep-all/);
  }

  assert.match(mobileCss, /@media\s*\(max-width:\s*650px\)[\s\S]*?\.message-content\s+table[\s\S]*?overflow-x:\s*auto/);
});

test("desktop messages stay inside the conversation viewport", () => {
  const css = read("src/renderer/styles.css");

  assert.match(css, /\.conversation\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(css, /\.message-list\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.message\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.message-body\s*\{[^}]*max-width:\s*100%/);
  assert.match(css, /\.message-content\s*\{[^}]*max-width:\s*100%/);
});

test("desktop rich content cannot expand the main pane", () => {
  const css = read("src/renderer/styles.css");

  assert.match(css, /\.main-pane\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%/);
  assert.match(css, /\.main-pane\s*>\s*\*\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/);
  assert.match(css, /\.message-content\s+img\s*\{[^}]*max-width:\s*100%/);
  assert.match(css, /\.thought-block\s*\{[^}]*overflow-wrap:\s*anywhere/);
  assert.match(css, /\.activity-group\s*\{[^}]*width:\s*100%[^}]*max-width:\s*100%/);
  assert.match(css, /\.activity-row-title\s*\{[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/);
});

test("electron QA covers the new usability states", () => {
  const source = read("scripts/qa-desktop.js");
  assert.match(source, /src", "ux-policy\.js/);
  assert.match(source, /qa-desktop-usability\.png/);
  assert.match(source, /qa-mobile-usability\.png/);
  assert.match(source, /qa-desktop-avatars-recovery\.png/);
  assert.match(source, /qa-desktop-model-check\.png/);
  assert.match(source, /qa-desktop-task-status\.png/);
  assert.match(source, /qa-mobile-task-status\.png/);
  assert.match(source, /#jump-to-latest/);
  assert.match(source, /#mobile-jump-to-latest/);
  assert.match(source, /#model-check-dialog/);
  assert.match(source, /#mobile-recover-prompt/);
  assert.match(source, /recoverablePrompt/);
  assert.match(source, /avatars/);
  assert.match(source, /permission-risk/);
  assert.match(source, /error-card/);
  assert.match(source, /qa-desktop-activity-stream\.png/);
  assert.match(source, /qa-desktop-sidebar-short\.png/);
});
