# Grok Build Desktop

Windows desktop client for the separately installed official Grok Build CLI. The
Electron UI talks to `grok agent stdio` over ACP JSON-RPC; the agent, tools,
authentication, configuration, and conversation persistence remain owned by the
official CLI.

## Client features

- The app connects to the official CLI at startup, before a project is selected.
  Opening projects and creating tasks reuse that connection; only their ACP
  sessions change. Closing the last project keeps the CLI connected. The status
  distinguishes CLI availability from having a project session ready for tasks.
- Grok browser login and encrypted third-party API models can coexist. Models,
  reasoning effort, ACP mode, and permission mode can be switched per session.
- Grok billing usage, local session history, resume/rename/fork/delete, context
  compaction, memory flush, and rewind points are available in the desktop UI.
- MCP servers and tools, skills, plugins, plugin marketplaces, and Hooks use the
  backend's existing `x.ai/*` ACP extension methods.
- Background commands and subagents can be monitored and cancelled without
  leaving the conversation.
- Account info, coding-data-retention preference, prompt history, session sharing,
  and project-root `AGENTS.md` rules are exposed under account settings.
- The sidebar keeps multiple project folders for quick switching. Each backend
  session remains scoped to one active root so folder trust and project rules stay
  predictable.
- Desktop and phone web chat accept up to five images or files per message. Images
  use ACP visual content; text and binary files use embedded ACP resources.
- Closing the desktop window keeps the backend and phone-control server available
  from the Windows system tray. The tray menu can reopen or fully exit the app.

Custom API keys are encrypted with Electron `safeStorage` for the current Windows
user and are injected only into the spawned Rust backend environment. They are
never sent to the renderer's mobile control protocol.

## Development

Requirements: Node.js 22.12+, npm, and a separately installed official Grok Build
CLI. Install it from `https://x.ai/cli`, then select its `grok.exe` in Account and
Privacy if it is not already available on `PATH`.

```powershell
cd desktop
npm install
npm start
```

Regenerate the application icon after changing its design:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/create-icon.ps1
```

During development and in packaged builds, the app uses only the selected official
`grok.exe`, or discovers `grok.exe` on `PATH`. It never falls back to a bundled or
repository-built backend. The Account and Privacy screen can validate the CLI,
check `grok update --check --json`, and run a confirmed manual `grok update`.

## Windows package

Build the frontend-only NSIS installer and portable executable:

```powershell
cd desktop
npm install
npm run dist:win
```

## Android package

The Android app is a small WebView remote client. The Rust CLI, Grok login, API
keys, and project files remain on the Windows PC; the app connects to the same
paired mobile interface served by the desktop client.

Install JDK 17, Android SDK Platform 35, Build Tools 35, and Gradle 8.9, then run:

```powershell
cd desktop
powershell -ExecutionPolicy Bypass -File scripts/build-android.ps1
```

Pass `-AndroidSdk`, `-JavaHome`, or `-GradlePath` when those tools are not exposed
through environment variables. Use `-Offline` when all Gradle dependencies are
already cached. The first build creates a local release key under
`android/.signing/`; keep that directory to allow future APKs to upgrade the
installed app. The key password is protected for the current Windows user with
DPAPI and the directory is excluded from Git.

To install, copy `dist/Grok-Remote-Android-0.1.2.apk` to an Android 8.0 or newer
phone, allow installation from the file manager when prompted, and open Grok
Remote. Scan the Windows client's pairing QR code with the built-in scanner, or
enter the full address manually.

## Phone control on a local network

1. Connect the Windows PC and phone to the same trusted Wi-Fi/LAN or Tailscale
   tailnet.
2. Select the working directory in the Windows client.
3. Turn on **手机控制**, then scan the QR code or enter the displayed address in
   the Android app.
4. Keep the Windows client running while the phone sends tasks or responds to
   permission and folder-trust requests.

When both LAN and Tailscale addresses are available, select the desired address in
the pairing dialog. The QR code and copy button follow that selection. Tailscale
IPv4 addresses in `100.64.0.0/10` are labelled explicitly and work without exposing
port 2420 to the public internet.

After pairing, the phone can switch backend-advertised models and modes, view Grok
usage and session history, resume a session, and monitor or stop running background
tasks. API keys, MCP credentials, plugin installation, Hooks, privacy settings, and
project-rule editing remain desktop-only.

The QR-code address is also a standalone local web chat and works in a normal phone
or desktop browser without installing the Android app. The attachment button accepts
images and files: at most five items, 5 MB per item, 8 MB total, with text files
limited to 1 MB. Attachments travel only through the authenticated paired session and
are not exposed as public static files.

The six-digit pairing code is single-use and expires after five minutes. The phone
can operate only the working directory selected on the PC. Do not expose the
control port directly to the public internet. For access away from the LAN, place
both devices on a private Tailscale or WireGuard network.

Windows Firewall may ask whether Grok Build can accept incoming connections. Allow
it only on **Private networks**. Guest Wi-Fi and access-point client isolation can
prevent phones from reaching other devices even when both appear to use the same
Wi-Fi.

## Custom background

Open the image button in the top-right toolbar, then choose a local PNG, JPEG,
WebP, or BMP image. Use the 3x3 position picker to anchor the image and select
**填充** (cover) or **适应** (contain). The client stores a resized local copy and
its display settings under Electron's per-user application data directory; the
image is never served to connected phones.

The appearance dialog offers persistent **浅色** (light) and **深色** (dark) themes.
Each theme uses one palette across the sidebar, chat, composer, dialogs, and native
window controls. Existing color-theme preferences migrate to light. Custom
backgrounds can be used independently.
