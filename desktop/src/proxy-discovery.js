const http = require("node:http");
const tls = require("node:tls");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { proxyEnvironment } = require("./network-policy");

const executeFile = promisify(execFile);
const BILLING_HOST = "cli-chat-proxy.grok.com";

function proxyPorts(tasklist, netstat) {
  const ids = new Set();
  for (const line of String(tasklist).split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)","(\d+)"/);
    if (match && /^(?:FlClashCore|mihomo|clash[^.]*|v2ray|xray|sing-box|hiddify|shadowsocks[^.]*)\.exe$/i.test(match[1])) ids.add(match[2]);
  }
  const ports = new Set();
  for (const line of String(netstat).split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0] !== "TCP" || fields[3] !== "LISTENING" || !ids.has(fields[4])) continue;
    const match = fields[1].match(/^(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]|\[::1\]):(\d+)$/);
    if (match && Number(match[1]) > 1024 && Number(match[1]) <= 65535) ports.add(Number(match[1]));
  }
  return [...ports].sort((a, b) => (b === 7890) - (a === 7890) || a - b).slice(0, 6);
}

function probeHttpProxy(port, { timeout = 3500 } = {}) {
  return new Promise((resolve) => {
    let tunnel;
    let secure;
    let complete = false;
    const request = http.request({ hostname: "127.0.0.1", port, method: "CONNECT", path: `${BILLING_HOST}:443`, agent: false });
    const finish = (ok) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      secure?.destroy();
      tunnel?.destroy();
      request.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeout);
    request.on("error", () => finish(false));
    request.on("connect", (response, socket, head) => {
      tunnel = socket;
      socket.on("error", () => finish(false));
      if (response.statusCode !== 200) return finish(false);
      if (head.length) socket.unshift(head);
      secure = tls.connect({ socket, servername: BILLING_HOST, rejectUnauthorized: true }, () => {
        // No token is sent. An HTTP response over verified TLS proves this route works.
        secure.write(`HEAD /v1/billing?format=credits HTTP/1.1\r\nHost: ${BILLING_HOST}\r\nConnection: close\r\n\r\n`);
      });
      secure.on("error", () => finish(false));
      let header = "";
      secure.on("data", (chunk) => {
        header += chunk.toString("utf8");
        if (/^HTTP\/1\.[01] \d{3}\b/.test(header)) finish(true);
        else if (header.length > 1024) finish(false);
      });
      secure.on("end", () => finish(false));
    });
    request.end();
  });
}

async function discoverProxyEnvironment(env = process.env, { platform = process.platform, execute = executeFile, probe = probeHttpProxy } = {}) {
  if (platform !== "win32" || Object.entries(env).some(([key, value]) => /^(https?|all)_proxy$/i.test(key) && value)) return {};
  try {
    const options = { windowsHide: true, timeout: 4000, maxBuffer: 2 * 1024 * 1024 };
    const [tasks, sockets] = await Promise.all([
      execute("tasklist.exe", ["/FO", "CSV", "/NH"], options),
      execute("netstat.exe", ["-ano", "-p", "tcp"], options),
    ]);
    const candidates = proxyPorts(tasks.stdout, sockets.stdout);
    // Candidates must belong to a known proxy process, then pass a credential-free TLS probe.
    const validated = await Promise.all(candidates.map(async (port) => await probe(port) ? port : null));
    const port = validated.find(Boolean);
    return port ? proxyEnvironment(env, `PROXY 127.0.0.1:${port}`) : {};
  } catch {
    return {};
  }
}

module.exports = { proxyPorts, probeHttpProxy, discoverProxyEnvironment };
