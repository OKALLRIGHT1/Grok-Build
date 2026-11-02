const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { once } = require("node:events");
const { WebSocket } = require("ws");
const { ControlServer, classifyNetworkAddress, localIpv4Addresses } = require("../src/control-server");

test("phone URLs prioritize physical LAN and exclude proxy and host-only interfaces", () => {
  const ipv4 = (address) => ({ family: "IPv4", internal: false, address });
  assert.deepEqual(localIpv4Addresses({
    FlClash: [ipv4("198.18.0.1")],
    Tailscale: [ipv4("100.100.20.30"), ipv4("169.254.83.107")],
    "vEthernet (WSL)": [ipv4("172.18.64.1")],
    "本地连接": [ipv4("2.0.0.1")],
    WLAN: [ipv4("172.16.30.137")],
    Ethernet: [ipv4("192.168.1.20"), ipv4("172.16.30.137")],
    lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
    tunnel: [ipv4("198.19.0.2"), ipv4("invalid"), ipv4("224.0.0.1")],
  }), ["172.16.30.137", "192.168.1.20", "100.100.20.30", "2.0.0.1"]);
});

test("network addresses distinguish Tailscale CGNAT from LAN", () => {
  assert.equal(classifyNetworkAddress("100.64.0.1"), "tailscale");
  assert.equal(classifyNetworkAddress("100.127.255.254"), "tailscale");
  assert.equal(classifyNetworkAddress("100.128.0.1"), "lan");
  assert.equal(classifyNetworkAddress("192.168.1.20"), "lan");
});

test("no usable adapter does not advertise a loopback or proxy address to phones", () => {
  assert.deepEqual(localIpv4Addresses({
    FlClash: [{ family: "IPv4", internal: false, address: "198.18.0.1" }],
    Tailscale: [{ family: "IPv4", internal: false, address: "169.254.83.107" }],
    lo: [{ family: "IPv4", internal: true, address: "127.0.0.1" }],
  }), []);
});

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const onMessage = (buffer) => {
      cleanup();
      resolve(JSON.parse(buffer.toString("utf8")));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

test("control server pairs once and forwards authenticated WebSocket actions", async () => {
  const actions = [];
  const desktopRoot = path.resolve(__dirname, "..");
  const server = new ControlServer({
    mobileRoot: path.join(desktopRoot, "src", "mobile"),
    vendorRoot: path.join(desktopRoot, "node_modules"),
    sharedAssets: { wallpaper: path.join(desktopRoot, "src", "renderer", "assets", "wallpaper.png") },
    getSnapshot: () => ({ status: "ready", workspaceName: "demo" }),
    onAction: async (action, payload) => {
      actions.push({ action, payload });
      return { accepted: true };
    },
  });

  try {
    const info = await server.start(0);
    const origin = `http://127.0.0.1:${info.port}`;

    const page = await fetch(`${origin}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'none'/);
    const pageBody = await page.text();
    assert.match(pageBody, /Grok Remote/);
    assert.match(pageBody, /id="sessions"[^>]*title="切换对话"/);
    assert.match(pageBody, /id="navigation-panel"/);
    assert.match(pageBody, /id="controls-panel"/);
    assert.match(pageBody, /id="panel-backdrop"/);
    assert.match(pageBody, /src="\/mobile-layout\.js"/);
    assert.match(pageBody, /src="\/markdown-display\.js"/);
    assert.doesNotMatch(pageBody, /id="controls-dialog"/);
    const presentationScript = await fetch(`${origin}/tool-presentation.js`);
    assert.equal(presentationScript.status, 200);
    assert.match(await presentationScript.text(), /GrokToolPresentation/);
    const layoutScript = await fetch(`${origin}/mobile-layout.js`);
    assert.equal(layoutScript.status, 200);
    assert.match(await layoutScript.text(), /GrokMobileLayout/);
    const uxPolicyScript = await fetch(`${origin}/ux-policy.js`);
    assert.equal(uxPolicyScript.status, 200);
    assert.match(await uxPolicyScript.text(), /GrokUxPolicy/);
    const markdownDisplayScript = await fetch(`${origin}/markdown-display.js`);
    assert.equal(markdownDisplayScript.status, 200);
    assert.match(await markdownDisplayScript.text(), /GrokMarkdownDisplay/);

    const wrongPair = await fetch(`${origin}/api/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "000000" }),
    });
    assert.equal(wrongPair.status, 401);

    const pair = await fetch(`${origin}/api/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: info.pairingCode }),
    });
    assert.equal(pair.status, 200);
    const { token } = await pair.json();
    assert.ok(token.length >= 40);

    const reusedPair = await fetch(`${origin}/api/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: info.pairingCode }),
    });
    assert.equal(reusedPair.status, 401);

    const socket = new WebSocket(`ws://127.0.0.1:${info.port}/control?token=${encodeURIComponent(token)}`, {
      origin,
    });
    const snapshotPromise = nextMessage(socket);
    await once(socket, "open");
    const snapshot = await snapshotPromise;
    assert.equal(snapshot.type, "snapshot");
    assert.equal(snapshot.data.workspaceName, "demo");

    socket.send(JSON.stringify({
      type: "action",
      requestId: 7,
      action: "prompt",
      payload: { text: "status" },
    }));
    const result = await nextMessage(socket);
    assert.equal(result.type, "action-result");
    assert.equal(result.data.requestId, 7);
    assert.equal(result.data.ok, true);
    assert.deepEqual(actions, [{ action: "prompt", payload: { text: "status" } }]);

    const attachmentData = Buffer.alloc(160 * 1024, 7).toString("base64");
    socket.send(JSON.stringify({
      type: "action",
      requestId: 8,
      action: "prompt",
      payload: {
        text: "inspect",
        attachments: [{ name: "sample.bin", kind: "file", mimeType: "application/octet-stream", data: attachmentData }],
      },
    }));
    const attachmentResult = await nextMessage(socket);
    assert.equal(attachmentResult.data.ok, true);
    assert.equal(actions[1].payload.attachments[0].data.length, attachmentData.length);

    const broadcastPromise = nextMessage(socket);
    server.broadcast("state", { busy: true });
    const broadcast = await broadcastPromise;
    assert.deepEqual(broadcast, { type: "state", data: { busy: true } });
    socket.close();
    await once(socket, "close");
  } finally {
    await server.stop();
  }
});

test("control server stops while a phone is still connected", async () => {
  const desktopRoot = path.resolve(__dirname, "..");
  const server = new ControlServer({
    mobileRoot: path.join(desktopRoot, "src", "mobile"),
    vendorRoot: path.join(desktopRoot, "node_modules"),
    sharedAssets: { wallpaper: path.join(desktopRoot, "src", "renderer", "assets", "wallpaper.png") },
    getSnapshot: () => ({ status: "ready" }),
    onAction: async () => ({}),
  });

  const info = await server.start(0);
  const origin = `http://127.0.0.1:${info.port}`;
  const pair = await fetch(`${origin}/api/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: info.pairingCode }),
  });
  const { token } = await pair.json();
  const socket = new WebSocket(`${origin.replace("http", "ws")}/control?token=${encodeURIComponent(token)}`, { origin });
  await once(socket, "open");

  await Promise.race([
    server.stop(),
    new Promise((_, reject) => setTimeout(() => reject(new Error("server stop timed out")), 2000)),
  ]);
  assert.equal(server.info().running, false);
  if (socket.readyState !== WebSocket.CLOSED) await once(socket, "close");
});

test("permission replies are handled while a prompt action is still running", async () => {
  const desktopRoot = path.resolve(__dirname, "..");
  let finishPrompt;
  const promptResult = new Promise((resolve) => { finishPrompt = resolve; });
  const server = new ControlServer({
    mobileRoot: path.join(desktopRoot, "src", "mobile"),
    vendorRoot: path.join(desktopRoot, "node_modules"),
    getSnapshot: () => ({ status: "ready" }),
    onAction: async (action) => {
      if (action === "prompt") return promptResult;
      if (action === "permission-reply") return { confirmed: true };
      return {};
    },
  });

  try {
    const info = await server.start(0);
    const origin = `http://127.0.0.1:${info.port}`;
    const pair = await fetch(`${origin}/api/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: info.pairingCode }),
    });
    const { token } = await pair.json();
    const socket = new WebSocket(`ws://127.0.0.1:${info.port}/control?token=${encodeURIComponent(token)}`, { origin });
    const snapshotPromise = nextMessage(socket);
    await once(socket, "open");
    await snapshotPromise;

    socket.send(JSON.stringify({ type: "action", requestId: 20, action: "prompt", payload: { text: "long task" } }));
    socket.send(JSON.stringify({
      type: "action",
      requestId: 21,
      action: "permission-reply",
      payload: { id: 5, optionId: "allow_once" },
    }));
    const permission = await nextMessage(socket);
    assert.equal(permission.data.requestId, 21);
    assert.deepEqual(permission.data.result, { confirmed: true });

    finishPrompt({ completed: true });
    const prompt = await nextMessage(socket);
    assert.equal(prompt.data.requestId, 20);
    socket.close();
    await once(socket, "close");
  } finally {
    await server.stop();
  }
});
