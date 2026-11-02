# Connection Lifecycle Design

## Goal

Prevent overlapping desktop connection attempts from terminating the current Grok backend and make backend lifecycle failures diagnosable.

## Design

Each desktop connection attempt receives a monotonically increasing generation. Only the active generation may publish status, create session state, or stop its backend. A new request supersedes earlier attempts, and an earlier failure cannot stop the newer client.

The renderer treats a connection attempt as busy until its promise settles, so duplicate local connect actions are ignored. The main process records start, stop, spawn error, stderr, and exit details in the existing diagnostics stream. Intentional stops are identified as such and do not publish a backend-crash failure.

## Scope

- Preserve the existing ACP backend and authentication behavior.
- Preserve explicit restart operations such as new session and applying model settings.
- Do not change mobile control protocol behavior beyond reporting the corrected runtime state.
