const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const { isIPv4 } = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { WebSocket, WebSocketServer } = require("ws");

const MAX_HTTP_BODY = 4096;
const MAX_WS_PAYLOAD = 12 * 1024 * 1024;
const PAIRING_TTL_MS = 5 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 40;

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function localIpv4Addresses(interfaces = os.networkInterfaces()) {
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    // Proxy TUN and host-only adapters are not phone-accessible endpoints.
    if (/flclash|clash|mihomo|sing[- ]?box|(?:^|[\s_-])tun(?:$|[\s_-])|vethernet|wsl|docker|virtualbox|vmware/i.test(name)) continue;
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal || !isIPv4(entry.address)) continue;
      const [a, b] = entry.address.split(".").map(Number);
      if (a === 0 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 198 && (b === 18 || b === 19))) continue;
      addresses.push(entry.address);
    }
  }
  const priority = (address) => {
    const [a, b] = address.split(".").map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 0;
    return classifyNetworkAddress(address) === "tailscale" ? 1 : 2;
  };
  return [...new Set(addresses)].sort((left, right) => priority(left) - priority(right));
}

function classifyNetworkAddress(address) {
  const octets = String(address).split(".").map(Number);
  if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet))) {
    if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return "tailscale";
  }
  return "lan";
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_HTTP_BODY) {
        reject(new Error("请求内容过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("JSON 格式无效"));
      }
    });
    req.on("error", reject);
  });
}

class ControlServer extends EventEmitter {
  constructor(options) {
    super();
    this.mobileRoot = options.mobileRoot;
    this.vendorRoot = options.vendorRoot;
    this.sharedAssets = options.sharedAssets || {};
    this.getSnapshot = options.getSnapshot;
    this.onAction = options.onAction;
    this.server = null;
    this.webSocketServer = null;
    this.port = null;
    this.authToken = null;
    this.pairing = null;
    this.pairAttempts = new Map();
  }

  async start(preferredPort = 2420) {
    if (this.server) return this.info();
    this.authToken = crypto.randomBytes(32).toString("base64url");
    this.rotatePairing();
    this.webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });
    this.webSocketServer.on("connection", (socket) => this.handleSocket(socket));

    this.server = http.createServer((req, res) => this.handleHttp(req, res));
    this.server.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));
    this.server.on("clientError", (_error, socket) => socket.destroy());

    this.port = await this.listen(preferredPort);
    this.emit("started", this.info());
    return this.info();
  }

  async listen(preferredPort) {
    const ports = preferredPort === 0
      ? [0]
      : Array.from({ length: 10 }, (_, index) => preferredPort + index);
    for (const port of ports) {
      try {
        await new Promise((resolve, reject) => {
          const onError = (error) => {
            this.server.removeListener("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            this.server.removeListener("error", onError);
            resolve();
          };
          this.server.once("error", onError);
          this.server.once("listening", onListening);
          this.server.listen(port, "0.0.0.0");
        });
        return this.server.address().port;
      } catch (error) {
        if (error.code !== "EADDRINUSE" || port === ports.at(-1)) throw error;
      }
    }
    throw new Error("没有可用的局域网控制端口");
  }

  rotatePairing() {
    this.pairing = {
      code: String(crypto.randomInt(100000, 1000000)),
      expiresAt: Date.now() + PAIRING_TTL_MS,
      consumed: false,
    };
    const info = this.info();
    this.emit("pairing-rotated", info);
    return info;
  }

  info() {
    const addresses = localIpv4Addresses();
    const hosts = addresses;
    const urls = this.port ? hosts.map((address) => `http://${address}:${this.port}/`) : [];
    const endpoints = urls.map((url, index) => ({
      address: hosts[index],
      kind: classifyNetworkAddress(hosts[index]),
      url,
      pairUrl: this.pairing ? `${url}?code=${encodeURIComponent(this.pairing.code)}` : null,
    }));
    return {
      running: Boolean(this.server?.listening),
      port: this.port,
      addresses,
      urls,
      endpoints,
      url: urls[0] || null,
      pairUrl: urls[0] && this.pairing
        ? `${urls[0]}?code=${encodeURIComponent(this.pairing.code)}`
        : null,
      pairingCode: this.pairing?.code ?? null,
      pairingExpiresAt: this.pairing?.expiresAt ?? null,
      pairingConsumed: this.pairing?.consumed ?? false,
      connectedClients: this.webSocketServer
        ? [...this.webSocketServer.clients].filter((client) => client.readyState === WebSocket.OPEN).length
        : 0,
    };
  }

  allowedStaticFile(urlPath) {
    const files = {
      "/": path.join(this.mobileRoot, "index.html"),
      "/index.html": path.join(this.mobileRoot, "index.html"),
      "/styles.css": path.join(this.mobileRoot, "styles.css"),
      "/app.js": path.join(this.mobileRoot, "app.js"),
      "/mobile-layout.js": path.join(path.dirname(this.mobileRoot), "mobile-layout.js"),
      "/mobile-session-sync-policy.js": path.join(path.dirname(this.mobileRoot), "mobile-session-sync-policy.js"),
      "/layout-policy.js": path.join(path.dirname(this.mobileRoot), "layout-policy.js"),
      "/attachment-ingest.js": path.join(path.dirname(this.mobileRoot), "attachment-ingest.js"),
      "/ux-policy.js": path.join(path.dirname(this.mobileRoot), "ux-policy.js"),
      "/markdown-display.js": path.join(path.dirname(this.mobileRoot), "markdown-display.js"),
      "/manifest.webmanifest": path.join(this.mobileRoot, "manifest.webmanifest"),
      "/icon.png": path.join(this.mobileRoot, "icon.png"),
      "/tool-presentation.js": path.join(path.dirname(this.mobileRoot), "tool-presentation.js"),
      "/assets/wallpaper.png": this.sharedAssets.wallpaper,
      "/vendor/lucide.js": path.join(this.vendorRoot, "lucide", "dist", "umd", "lucide.min.js"),
      "/vendor/marked.js": path.join(this.vendorRoot, "marked", "marked.min.js"),
      "/vendor/dompurify.js": path.join(this.vendorRoot, "dompurify", "dist", "purify.min.js"),
    };
    return files[urlPath] || null;
  }

  securityHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws: wss:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  }

  async handleHttp(req, res) {
    this.securityHeaders(res);
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "POST" && requestUrl.pathname === "/api/pair") {
      try {
        if (!this.allowPairAttempt(req.socket.remoteAddress || "unknown")) {
          json(res, 429, { error: "尝试次数过多，请稍后再试" });
          return;
        }
        const body = await readJsonBody(req);
        if (
          !this.pairing
          || this.pairing.consumed
          || Date.now() > this.pairing.expiresAt
          || String(body.code || "") !== this.pairing.code
        ) {
          json(res, 401, { error: "配对码无效或已过期" });
          return;
        }
        this.pairing.consumed = true;
        this.emit("pairing-consumed", this.info());
        json(res, 200, { token: this.authToken });
      } catch (error) {
        json(res, 400, { error: error.message });
      }
      return;
    }

    if (req.method !== "GET") {
      json(res, 405, { error: "Method not allowed" });
      return;
    }

    const filePath = this.allowedStaticFile(requestUrl.pathname);
    if (!filePath || !fs.existsSync(filePath)) {
      json(res, 404, { error: "Not found" });
      return;
    }
    try {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
        "Content-Length": content.length,
        "Cache-Control": requestUrl.pathname.startsWith("/vendor/") ? "public, max-age=86400" : "no-cache",
      });
      res.end(content);
    } catch {
      json(res, 500, { error: "无法读取移动端资源" });
    }
  }

  allowPairAttempt(address) {
    const now = Date.now();
    const attempts = (this.pairAttempts.get(address) || []).filter((time) => now - time < RATE_WINDOW_MS);
    attempts.push(now);
    this.pairAttempts.set(address, attempts);
    return attempts.length <= 10;
  }

  validOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return false;
    try {
      const parsed = new URL(origin);
      return parsed.protocol === "http:" && parsed.host === req.headers.host;
    } catch {
      return false;
    }
  }

  handleUpgrade(req, socket, head) {
    const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (
      requestUrl.pathname !== "/control"
      || requestUrl.searchParams.get("token") !== this.authToken
      || !this.validOrigin(req)
    ) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.webSocketServer.handleUpgrade(req, socket, head, (webSocket) => {
      this.webSocketServer.emit("connection", webSocket, req);
    });
  }

  handleSocket(socket) {
    socket.controlRate = [];
    socket.on("message", async (buffer) => {
      const now = Date.now();
      socket.controlRate = socket.controlRate.filter((time) => now - time < RATE_WINDOW_MS);
      socket.controlRate.push(now);
      if (socket.controlRate.length > RATE_LIMIT) {
        socket.close(4408, "Rate limit exceeded");
        return;
      }

      let message;
      try {
        message = JSON.parse(buffer.toString("utf8"));
      } catch {
        this.sendSocket(socket, "error", { message: "消息格式无效" });
        return;
      }
      if (message?.type !== "action" || typeof message.action !== "string") {
        this.sendSocket(socket, "error", { message: "不支持的消息" });
        return;
      }
      try {
        const result = await this.onAction(message.action, message.payload || {}, socket);
        this.sendSocket(socket, "action-result", {
          requestId: message.requestId,
          action: message.action,
          ok: true,
          result,
        });
      } catch (error) {
        this.sendSocket(socket, "action-result", {
          requestId: message.requestId,
          action: message.action,
          ok: false,
          error: { message: error.message || String(error), code: error.code || null },
        });
      }
    });
    socket.on("close", () => this.emit("clients-changed", this.info()));
    this.sendSocket(socket, "snapshot", this.getSnapshot());
    this.emit("clients-changed", this.info());
  }

  sendSocket(socket, type, data) {
    return this.send(socket, type, data);
  }

  send(socket, type, data) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify({ type, data }));
    return true;
  }

  broadcast(type, data) {
    if (!this.webSocketServer) return;
    const message = JSON.stringify({ type, data });
    for (const socket of this.webSocketServer.clients) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  }

  async stop() {
    if (!this.server) return;
    const webSocketServer = this.webSocketServer;
    for (const socket of webSocketServer?.clients || []) socket.terminate();
    await Promise.all([
      new Promise((resolve) => this.server.close(resolve)),
      webSocketServer
        ? new Promise((resolve) => webSocketServer.close(resolve))
        : Promise.resolve(),
    ]);
    this.server = null;
    this.webSocketServer = null;
    this.port = null;
    this.authToken = null;
    this.pairing = null;
    this.emit("stopped", this.info());
  }
}

module.exports = { ControlServer, classifyNetworkAddress, localIpv4Addresses };
