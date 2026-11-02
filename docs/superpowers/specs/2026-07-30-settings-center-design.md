# Settings Center Design

## Goal

Provide an always-available desktop settings center so initial official CLI setup is discoverable before a workspace connection exists.

## Navigation

The left sidebar gains an enabled Settings entry. It opens a wide dialog with a stable category rail: Grok Build, Appearance, Workspaces, Phone and Network, Account and Privacy, and Advanced. Category changes occur in place; existing dialogs remain available as shortcuts.

## Content

Grok Build owns official CLI selection, validation, update checks, update confirmation, and the official installation link. Appearance links to the existing background/theme controls. Workspaces shows stored roots and lets the user add a folder. Phone and Network opens existing pairing controls. Account and Privacy opens the existing account dialog. Advanced exposes the diagnostic log.

When a connection fails because no official CLI is available, the user receives an explicit Open Settings action that selects Grok Build. No mobile protocol or backend data contract changes.

## Verification

Source tests require the settings entry, category panels, and error-to-settings routing. Electron QA opens Settings while disconnected, verifies Grok Build is selected, and captures the settings screen.
