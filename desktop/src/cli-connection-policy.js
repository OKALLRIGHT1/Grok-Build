function cliConnectionPolicy(version, supportsIsolatedStdio = false) {
  return {
    isolated: supportsIsolatedStdio,
    args: supportsIsolatedStdio ? ["agent", "--no-leader", "stdio"] : ["agent", "stdio"],
    initialize: {
      protocolVersion: "1",
      clientInfo: { name: "grok-build-desktop", version },
      clientCapabilities: { _meta: { "x.ai/folderTrust": { interactive: true } } },
      // Native CLI identity is used only in a private worker. Older shared-leader
      // CLIs retain a distinct session namespace so permissions cannot spill over.
      ...(supportsIsolatedStdio ? {} : { _meta: { clientIdentifier: "grok-desktop", clientType: "desktop" } }),
    },
    sessionMeta: supportsIsolatedStdio ? {} : { clientIdentifier: "grok-desktop" },
  };
}

module.exports = { cliConnectionPolicy };
