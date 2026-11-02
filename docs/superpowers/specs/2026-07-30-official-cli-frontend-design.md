# Official CLI Frontend Design

## Goal

Make Grok Build Desktop a standalone Electron frontend for a user-installed official `grok.exe`. The desktop application must not run a bundled or repository-built Grok backend as a fallback.

## Backend Selection

The main process owns one persisted backend preference in Electron user data. It contains the selected executable path and no credentials.

On first use, the application searches `grok.exe` on `PATH`. If it is found, that executable becomes the proposed official backend. Otherwise the user must select a `grok.exe` through a native file picker. The application never searches `resources/bin`, Rust build output, or other bundled fallback locations.

Before saving or starting a selected executable, the main process validates it by running:

```text
grok version
grok agent stdio --help
```

The validation reports the discovered version and rejects an executable that cannot run the ACP stdio agent. A failed validation leaves the existing saved backend unchanged. A selected backend is always launched as `grok agent stdio` and retains the present environment-based custom API model injection.

## User Interface

Account and privacy settings gain a compact "Official Grok Build" section. It shows the active executable filename/path, its version, and a status line. It offers three commands: select executable, test connection, and check for updates. The update result is rendered as user-facing status rather than raw JSON.

When no valid backend has been selected, the main workspace is disconnected and the settings section explains that official Grok Build must be installed before the client can connect. It provides an external link to the official installer page, but the client does not download or install it itself.

## Manual Update

Checking uses the selected executable with `grok update --check --json`. The main process parses its JSON and returns only a sanitized update status: current version, latest version when available, channel, update availability, installer source, and an actionable failure message.

Installing an update requires an explicit confirmation. Before invoking `grok update`, the main process stops the active ACP process, clears its connection state, and runs the selected official CLI detached from the renderer. It reports completion or failure, then validates the executable again. The user reconnects after a successful update; the client never silently installs updates.

## Compatibility And Errors

The client displays distinct remediation for a missing executable, a non-Grok executable, an ACP-incompatible version, a failed update check, and a failed update. Paths and raw process output remain in the diagnostic log; the renderer receives concise safe messages.

Existing desktop and mobile chat behavior remains unchanged after a successful connection. Mobile never receives executable paths or update-process output.

## Packaging

Windows packaging stops staging and including `resources/bin/grok.exe`. The installer and portable executable contain only the frontend. Build documentation changes to require official Grok Build on the target Windows computer.

## Verification

Node tests cover backend preference persistence, PATH discovery, executable validation result mapping, update JSON sanitization, and rejection without fallback. Electron QA verifies the settings controls and missing-backend state. Packaging verification asserts that the unpacked application has no bundled `resources/bin/grok.exe`.
