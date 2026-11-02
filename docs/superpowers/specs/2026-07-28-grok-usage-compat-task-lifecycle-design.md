# Grok Usage Compatibility and Task Lifecycle Design

## Scope

This change fixes Responses API payloads that omit token-detail objects and adds clear page-level task state feedback. It does not change the ACP backend, provider selection, prompt queue behavior, remote pairing, permissions, themes, or responsive layout.

The same lifecycle feedback applies to desktop, phone, and iPad. It uses page UI only: no sound, Windows notification, or taskbar flashing.

## Response Compatibility

The sampler keeps `async-openai` as its typed Responses API boundary. Its existing compatibility pass will additionally normalize `response.usage` before retrying deserialization:

- Missing `input_tokens_details` becomes `{ "cached_tokens": 0 }`.
- Missing `output_tokens_details` becomes `{ "reasoning_tokens": 0 }`.
- A present detail object or token value is never replaced.
- The same normalization is used for streaming terminal events and non-streaming response bodies.
- Normalization only runs after strict typed deserialization fails, preserving the strict path for conforming providers.

Zero is appropriate only for omitted detail fields: the response still supplies aggregate input and output token counts, while an absent breakdown cannot contribute a known cached or reasoning count.

## Task Lifecycle

The Electron main process remains the lifecycle source of truth. Each accepted prompt receives a unique local turn identifier and moves through exactly one terminal state:

1. `started` is emitted immediately before the ACP `session/prompt` request.
2. `completed` is emitted when that request resolves normally.
3. `interrupted` is emitted immediately after an explicit cancel or an interrupting queued prompt requests cancellation.
4. `failed` is emitted when the request rejects without having been interrupted.

Terminal emission is idempotent per turn. Once a turn is interrupted, a late ACP response or rejection cannot overwrite it with completed or failed. The lifecycle payload contains the turn identifier, state, source, and timestamp. It is sent through Electron IPC and the existing control-server event stream so desktop and remote clients see the same state.

## Page Feedback

A compact task-status strip sits directly above the composer, where it remains visible without covering conversation content:

- `started`: blue progress indicator and “任务已开始”.
- `completed`: green check and “任务已完成”.
- `interrupted`: amber stop icon and “任务已中断”.
- `failed`: red alert icon and “任务失败”.

The strip remains visible for the whole active turn. A terminal state remains for five seconds and then collapses. The assistant message also keeps its existing inline progress element, extended with permanent completed, interrupted, and failed labels so historical outcomes remain understandable after the strip disappears.

Existing expandable error details remain unchanged. A serialization failure therefore shows both the failed lifecycle state and the actionable error card, without exposing raw JSON as ordinary chat content.

## Error and Race Handling

- Canceling while idle does not create a false interrupted event.
- Repeated cancel actions do not emit duplicate lifecycle events.
- A queued prompt starts only after the preceding turn has reached its terminal state; each gets a separate identifier.
- Disconnecting during an active prompt ends that turn as failed unless it was already interrupted.
- Session loading and settings updates continue to use the existing generic busy state and do not masquerade as prompt tasks.
- Mobile reconnection reads the current lifecycle state from the runtime snapshot, so an active or recently terminated task is not invisible after reconnecting.

## Testing

Rust regression tests first reproduce missing `output_tokens_details` and missing `input_tokens_details` for streaming and non-streaming Responses payloads. They verify normalized zero values and preservation of supplied values.

Node tests cover lifecycle transitions, terminal-state idempotency, cancel/late-response races, queue handoff, IPC/control-server mapping, and runtime snapshot recovery. Renderer contract tests cover the desktop and mobile/iPad status strip plus all four visible states.

Final verification runs the focused Rust sampler tests, the complete desktop Node suite, backend smoke tests, Electron desktop/mobile/iPad QA, and Windows packaging checks.
