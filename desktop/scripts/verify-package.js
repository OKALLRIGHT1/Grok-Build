const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const asar = require("@electron/asar");

const desktopRoot = path.resolve(__dirname, "..");
const unpackedRoot = path.join(desktopRoot, "dist", "win-unpacked");
const appArchive = path.join(unpackedRoot, "resources", "app.asar");
const packagedBackend = path.join(unpackedRoot, "resources", "bin", "grok.exe");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").toUpperCase();
}

assert.equal(fs.existsSync(packagedBackend), false, "official grok.exe must remain separately installed");

const archiveFiles = asar.listPackage(appArchive);
function extractArchiveFile(suffix) {
  const normalizedSuffix = `/${suffix.replaceAll("\\", "/")}`;
  const archivePath = archiveFiles.find((file) => file.replaceAll("\\", "/") === normalizedSuffix)
    || archiveFiles.find((file) => file.replaceAll("\\", "/").endsWith(normalizedSuffix));
  assert.ok(archivePath, `${suffix} is missing from app.asar`);
  const readablePath = archivePath.replace(/^[/\\]+/, "").replaceAll("/", path.sep);
  return asar.extractFile(appArchive, readablePath).toString("utf8");
}

const mobileHtml = extractArchiveFile("src/mobile/index.html");
const mobileScript = extractArchiveFile("src/mobile/app.js");
const mainScript = extractArchiveFile("src/main.js");
const rendererHtml = extractArchiveFile("src/renderer/index.html");
const rendererScript = extractArchiveFile("src/renderer/renderer.js");
const rendererStyles = extractArchiveFile("src/renderer/styles.css");
for (const file of ["src/renderer/styles.css", "src/renderer/workspace.css", "src/renderer/sidebar.css", "src/renderer/themes.css", "src/renderer/renderer.js", "src/renderer/index.html", "src/main.js", "src/preload.js", "src/network-policy.js", "src/proxy-discovery.js", "src/agent-data.js", "src/control-server.js", "src/mobile/app.js", "src/mobile/styles.css", "src/attachment-ingest.js", "src/reasoning-effort-policy.js", "src/cli-connection-policy.js", "src/official-cli.js", "src/agent-events.js", "src/ux-policy.js"]) {
  assert.equal(extractArchiveFile(file), fs.readFileSync(path.join(desktopRoot, file), "utf8"), `${file} must match the current source`);
}
assert.match(extractArchiveFile("src/renderer/themes.css"), /body\[data-theme="dark"\]/);
const toolPresentation = extractArchiveFile("src/tool-presentation.js");
const permissionPolicy = extractArchiveFile("src/permission-policy.js");
const avatarStore = extractArchiveFile("src/avatar-store.js");
const promptRecovery = extractArchiveFile("src/prompt-recovery.js");
const modelProbe = extractArchiveFile("src/model-probe.js");
const agentEvents = extractArchiveFile("src/agent-events.js");
const sessionPolicy = extractArchiveFile("src/session-policy.js");
const packagedPackage = JSON.parse(extractArchiveFile("package.json"));
assert.match(mobileHtml, /id="sessions"[^>]*title="切换对话"/);
assert.match(mobileHtml, /src="\/tool-presentation\.js"/);
assert.match(mobileScript, /case "session-loading":/);
assert.match(mobileScript, /case "session-load-finished":/);
assert.match(mobileScript, /promptSubmitting/);
assert.match(mobileHtml, /id="mobile-recover-prompt"/);
assert.match(mobileScript, /applyAvatars/);
assert.match(mobileScript, /recover-prompt/);
assert.match(mobileScript, /function selectControlTab\(tab\)/);
assert.match(mainScript, /return acceptPrompt\(payload, "mobile"/);
assert.match(mainScript, /agent:session-load-finished/);
assert.match(mainScript, /promptQueue/);
assert.match(mainScript, /automaticPermissionOption/);
assert.match(mainScript, /client-settings\.json/);
assert.match(mainScript, /models:check/);
assert.match(mainScript, /avatars:choose/);
assert.match(mainScript, /prompt-recovery:consume/);
assert.match(mainScript, /normalizePermissionRequest/);
assert.match(mainScript, /backgroundTaskFailure/);
assert.match(mainScript, /buildSessionMetadata/);
assert.match(rendererScript, /GrokToolPresentation\.format/);
assert.match(rendererScript, /GrokToolPresentation\.upsertActivity/);
assert.match(rendererScript, /activity-group/);
assert.match(rendererScript, /final-answer/);
assert.match(rendererScript, /queueLength/);
assert.ok(rendererHtml.includes(`id="client-version">v${packagedPackage.version}<`), "displayed client version must match the packaged version");
assert.match(rendererHtml, /class="sidebar-footer"/);
assert.match(rendererStyles, /\.activity-group\s*\{/);
assert.match(rendererStyles, /\.activity-row\s*\{/);
assert.match(rendererStyles, /\.sidebar-footer\s*\{/);
assert.match(toolPresentation, /处修改/);
assert.match(toolPresentation, /MAX_DISPLAY_CHARS/);
assert.match(toolPresentation, /summarizeActivity/);
assert.match(permissionPolicy, /always-approve/);
assert.match(avatarStore, /class AvatarStore/);
assert.match(promptRecovery, /class PromptRecovery/);
assert.match(modelProbe, /runModelProbe/);
assert.match(agentEvents, /fatalModelFailure/);
assert.match(agentEvents, /backgroundTaskFailure/);
assert.match(sessionPolicy, /choosePreferredModel/);
assert.equal(packagedPackage.version, "0.1.17");

console.log(`Frontend-only package, protocol policies, and mobile controls OK (${sha256(appArchive)})`);
