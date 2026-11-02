const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const desktopRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(desktopRoot, "scripts", "qa-desktop.js"), "utf8");

test("mobile visual QA loads a resource-free document before injecting browser assets", () => {
  assert.match(source, /app\.disableHardwareAcceleration\(\)/);
  assert.match(source, /function createMobileQaDocument\(html\)/);
  assert.match(source, /await win\.loadFile\(path\.join\(__dirname, "qa-empty\.html"\)\)/);
  assert.match(source, /ipcMain\.handle\("agent:list-sessions"/);
  assert.match(source, /document\.body\.innerHTML =/);
  assert.doesNotMatch(source, /captureMobile\(\)[\s\S]*?await win\.loadURL/);
  assert.match(source, /path\.join\(desktopRoot, "src", "layout-policy\.js"\)/);
  assert.match(source, /path\.join\(desktopRoot, "src", "mobile-session-sync-policy\.js"\)/);
  assert.match(source, /qa-desktop-ide-shell\.png/);
  assert.match(source, /qa-desktop-activity-stream\.png/);
  assert.match(source, /qa-desktop-sidebar-short\.png/);
  assert.match(source, /\.activity-group/);
  assert.match(source, /\.activity-repeat/);
  assert.match(source, /sidebarFooterInside/);
});
