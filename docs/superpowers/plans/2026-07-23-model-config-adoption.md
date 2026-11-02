# Model Config Adoption Implementation Plan

**Goal:** Automatically adopt equivalent legacy TOML models while preserving real conflicts and deduplicating errors.

**Architecture:** Add focused TOML model-block inspection to `ModelConfigStore`, compare parsed fields with flattened provider models, back up before removing equivalent unmanaged blocks, and expose structured conflict data through existing IPC errors.

**Tech Stack:** Node.js, Electron IPC, vanilla JavaScript, `node:test`.

1. Add failing store tests for equivalent adoption, backup creation and non-equivalent conflict preservation.
2. Implement model block parsing, equivalence comparison, backup and adoption in `model-config.js`.
3. Add conflict-resolution store/IPC operations for client-wins and automatic rename; manual-wins keeps the existing block.
4. Add renderer conflict actions and deduplicate identical error banners.
5. Run all tests, backend smoke, Electron QA and rebuild Windows artifacts.
