# Provider Multi-Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow one API provider to own multiple models while sharing credentials and defaults.

**Architecture:** Keep the CLI TOML model blocks unchanged. Store nested providers in the desktop data file, migrate legacy flat records on read, and flatten providers only when rendering TOML.

**Tech Stack:** Node.js 22, Electron IPC, vanilla HTML/CSS/JavaScript, `node:test`.

## Global Constraints

- Preserve unmanaged `config.toml` content and existing model IDs.
- Encrypt API keys with the existing Electron `safeStorage` callbacks.
- Use a provider default API protocol with an optional per-model override.
- Keep routine forms limited to required fields; advanced fields stay collapsed.

---

### Task 1: Provider Store And Migration

**Files:**
- Modify: `desktop/src/model-config.js`
- Modify: `desktop/test/model-config.test.js`

**Interfaces:**
- Produces: `ModelConfigStore.listProviders()`, `saveProvider(input)`, `removeProvider(id)`, `saveModel(providerId, input)`, `removeModel(providerId, modelId)`.
- Produces: `validateProvider(input)` and `validateProviderModel(input, provider)`.

- [ ] Add failing tests proving two models share one provider env key, inherit/override protocol, and flatten into two TOML blocks.
- [ ] Run `C:\useful\nodejs\node.exe --test test/model-config.test.js` from `desktop`; expect assertions to fail because provider APIs do not exist.
- [ ] Implement provider validation, nested storage, shared secret lookup, flattened TOML rendering, and atomic JSON writes.
- [ ] Add failing migration tests using the legacy flat array and model-keyed secrets.
- [ ] Implement migration that preserves model IDs and writes nested providers without losing encrypted secrets.
- [ ] Add and pass deletion/conflict tests, then run the complete model config test file.

### Task 2: Main Process Provider IPC

**Files:**
- Modify: `desktop/src/main.js`
- Modify: `desktop/src/preload.js`

**Interfaces:**
- Consumes: provider store methods from Task 1.
- Produces IPC: `models:list-providers`, `models:save-provider`, `models:remove-provider`, `models:save-model`, `models:remove-model`.

- [ ] Replace flat custom-model handlers with provider handlers returning `{ providers, reloaded }` after mutations.
- [ ] Expose matching preload functions and remove renderer dependency on the old flat methods.
- [ ] Run `C:\useful\nodejs\node.exe --check src/main.js` and `--check src/preload.js`; expect both to pass.

### Task 3: Grouped Provider UI

**Files:**
- Modify: `desktop/src/renderer/index.html`
- Modify: `desktop/src/renderer/renderer.js`
- Modify: `desktop/src/renderer/styles.css`

**Interfaces:**
- Consumes: provider IPC from Task 2.
- Produces: provider cards, nested model rows, separate provider/model forms, and collapsed advanced model settings.

- [ ] Replace the flat form with a provider form containing name, URL, API key and default protocol.
- [ ] Add a model form containing name/model plus a native `details` advanced section for ID, protocol override and numeric settings.
- [ ] Render grouped provider cards with edit/add-model/delete actions and nested model edit/delete actions.
- [ ] Keep IDs auto-generated for new records and preserve IDs during edit.
- [ ] Add responsive styles with stable action button dimensions and no nested cards.
- [ ] Run JavaScript syntax checks and the Electron QA script; inspect the model dialog at desktop and narrow widths.

### Task 4: Provider Regression Verification

**Files:**
- Test: `desktop/test/*.test.js`

- [ ] Run `C:\useful\nodejs\node.exe --test test/*.test.js` from `desktop`; expect all tests to pass.
- [ ] Run `C:\useful\nodejs\node.exe test/backend-smoke.js`; expect the packaged backend smoke check to pass.
- [ ] Record any unrelated pre-existing failure without changing unrelated code.

