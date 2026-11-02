# Shared Avatars, Prompt Recovery, and Model Checks Design

## Scope

This change adds three user-facing capabilities without changing the existing ACP chat backend, login/API coexistence, queue semantics, remote pairing, themes, or iPad layout:

1. One locally stored user avatar and one locally stored Grok avatar, shared by every model and displayed by desktop, phone, and iPad clients.
2. Recovery of an explicitly canceled in-flight prompt, plus editing and reuse of historical user prompts. Current-session prompts can be rewound and rerun when the backend exposes a reliable prompt index.
3. A fast provider/model check and an optional real minimal request that may consume a very small amount of credit.

## Architecture

The Electron main process remains the source of truth for cross-device state. Avatar images are selected on desktop, center-cropped and resized with Electron `nativeImage`, stored as bounded PNG files under the application user-data directory, and exposed as data URLs through IPC and the existing control-server runtime snapshot. Mobile and iPad clients only render the synchronized images; they do not persist copies.

Prompt recovery is owned by a small main-process state object. It records the active prompt, only marks it recoverable after an explicit user stop, and exposes a one-shot consume operation. Queue-triggered interruption does not create a recovery draft. Runtime snapshots contain only a lightweight summary; the full prompt and attachments are returned only when consumed. A client automatically fills an empty composer after stopping, but preserves any existing draft and shows a restore action instead.

Historical user messages receive an edit action that copies their text into the composer for sending at the current end. The rewind panel combines exact current-session prompt history with backend rewind points by `prompt_index`; only those reliably indexed prompts offer destructive "rewind and edit". Workspace-wide history from another session never pretends to rewind and is labeled as reuse-at-current-end.

Model checks use an isolated provider request and never call `session/set_model`. A pure helper builds protocol-specific requests for OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages. The model store resolves a selected provider/model with its decrypted key only inside the main process. Quick checks validate configuration and perform a bounded connectivity request; real checks send a minimal prompt and report provider, model, latency, status, and sanitized technical details.

## User Interface

The existing appearance dialog gains two compact avatar controls with preview, choose, and reset actions. Message avatar elements use the synchronized user/Grok image when configured and retain current letter fallbacks otherwise.

The desktop and mobile composers gain a small recoverable-prompt strip. User messages expose an edit icon. The existing rewind list gains an edit-and-rewind action when exact current-session text is available.

Each configured model row gains a check action. Its result area offers "快速检测" and "真实请求" modes, clearly labels the real request as potentially consuming a small amount of credit, and shows a structured success or failure result without exposing secrets.

## Error Handling and Security

- Avatar files are restricted to supported raster formats, 30 MB source size, a 256 by 256 PNG output, and local application storage.
- Invalid avatar roles and corrupt images are rejected; reset restores letter fallbacks.
- Prompt recovery is one-shot to prevent duplicate resend across desktop and mobile.
- Existing composer drafts are never overwritten by recovery.
- Network checks time out and classify configuration, authentication, reachability, HTTP, and response-shape failures.
- Authorization headers and API keys are never returned to renderers or logged in results.
- A real check is disabled until the user explicitly chooses it in the model-check dialog.

## Testing

Node unit tests cover avatar persistence, prompt recovery state transitions, model resolution, request construction, response parsing, timeouts, and secret sanitization. Contract tests assert the desktop/mobile controls and synchronized avatar rendering. Existing full Node, backend smoke, Electron desktop/mobile/iPad QA, and Windows packaging checks remain the final acceptance gate.

