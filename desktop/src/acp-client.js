const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");

class JsonRpcLineParser {
  constructor(onMessage, onMalformed) {
    this.buffer = "";
    this.onMessage = onMessage;
    this.onMalformed = onMalformed;
  }

  push(chunk) {
    this.buffer += chunk.toString("utf8");
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        try {
          this.onMessage(JSON.parse(line));
        } catch (error) {
          this.onMalformed?.(line, error);
        }
      }
      newline = this.buffer.indexOf("\n");
    }
  }
}

function authMethodId(method) {
  if (!method || typeof method !== "object") return null;
  return method.id ?? method.methodId ?? method.authMethodId ?? null;
}

function selectAuthMethod(initializeResult) {
  const methods = initializeResult?.authMethods ?? [];
  const preferred = initializeResult?._meta?.defaultAuthMethodId;
  if (preferred && methods.some((method) => authMethodId(method) === preferred)) {
    return preferred;
  }
  const cached = methods.find((method) => authMethodId(method) === "cached_token");
  return authMethodId(cached ?? methods[0]);
}

function serializeError(error) {
  if (!error) return { message: "未知错误" };
  if (typeof error === "string") return { message: error };
  const summary = error.message || String(error);
  const detail = errorDetail(error.data);
  const serialized = {
    message: /^internal error$/i.test(summary) && detail ? detail : summary,
    code: error.code,
    data: error.data,
  };
  if (detail) serialized.detail = detail;
  if (serialized.message !== summary) serialized.summary = summary;
  return serialized;
}

function errorDetail(data) {
  if (typeof data === "string") return data.trim();
  if (!data || typeof data !== "object") return "";
  for (const key of ["message", "detail", "error", "error_message"]) {
    if (typeof data[key] === "string" && data[key].trim()) return data[key].trim();
  }
  try {
    return JSON.stringify(data);
  } catch {
    return "";
  }
}

function wireMethod(method) {
  return typeof method === "string" && method.startsWith("x.ai/") ? `_${method}` : method;
}

function objectKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).sort().join(",") || "none"
    : "none";
}

function requestDiagnostic(message) {
  const params = message?.params;
  const nestedMethod = params && typeof params === "object" ? params.method : null;
  const nestedParams = params && typeof params === "object" ? params.params : null;
  return [
    `ACP reverse request id=${String(message?.id ?? "missing")}`,
    `method=${String(message?.method || "missing")}`,
    `paramsKeys=${objectKeys(params)}`,
    nestedMethod ? `nestedMethod=${String(nestedMethod)}` : null,
    nestedParams ? `nestedParamsKeys=${objectKeys(nestedParams)}` : null,
  ].filter(Boolean).join("; ");
}

class AcpClient extends EventEmitter {
  constructor(command, args, options = {}) {
    super();
    this.command = command;
    this.args = args;
    this.options = options;
    this.nextId = 1;
    this.pending = new Map();
    this.process = null;
  }

  start() {
    this.intentionalStopReason = null;
    if (this.process) throw new Error("Agent 已启动");
    this.process = spawn(this.command, this.args, {
      cwd: this.options.cwd,
      env: this.options.env,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.emit("diagnostic", `Backend started: ${this.command}\n`);

    const parser = new JsonRpcLineParser(
      (message) => this.handleMessage(message),
      (line, error) => this.emit("diagnostic", `无法解析后端消息: ${error.message}\n${line}`),
    );
    this.process.stdout.on("data", (chunk) => parser.push(chunk));
    this.process.stderr.on("data", (chunk) => this.emit("diagnostic", chunk.toString("utf8")));
    this.process.on("error", (error) => {
      this.emit("diagnostic", `Backend spawn error: ${error.message}\n`);
      this.failAll(error);
    });
    this.process.on("exit", (code, signal) => {
      const exitReason = signal || (code ?? "unknown");
      const intentionalStop = Boolean(this.intentionalStopReason);
      const stopReason = this.intentionalStopReason || null;
      this.emit("diagnostic", `Backend exited (${exitReason})${stopReason ? `; requested stop: ${stopReason}` : ""}\n`);
      const error = new Error(`Grok 后端已退出 (${exitReason})`);
      this.failAll(error);
      this.emit("exit", { code, signal, intentionalStop, stopReason });
      this.process = null;
    });
  }

  handleMessage(message) {
    if (Object.hasOwn(message, "id") && (Object.hasOwn(message, "result") || message.error)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        const summary = message.error.message || "ACP 请求失败";
        const detail = errorDetail(message.error.data);
        const error = new Error(/^internal error$/i.test(summary) && detail ? detail : summary);
        error.summary = summary;
        error.code = message.error.code;
        error.data = message.error.data;
        this.emit("diagnostic", `ACP ${pending.method} 失败: ${detail || summary}\n`);
        pending.reject(error);
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (Object.hasOwn(message, "id") && message.method) {
      this.emit("request", message);
      return;
    }

    if (message.method) this.emit("notification", message);
  }

  write(message) {
    if (!this.process?.stdin?.writable) throw new Error("Grok 后端未连接");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      try {
        this.write({ jsonrpc: "2.0", id, method: wireMethod(method), params });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this.write({ jsonrpc: "2.0", method: wireMethod(method), params });
  }

  respond(id, result) {
    this.write({ jsonrpc: "2.0", id, result });
  }

  respondError(id, code, message) {
    this.write({ jsonrpc: "2.0", id, error: { code, message } });
  }

  failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  stop(reason = "client request") {
    if (!this.process) return;
    this.intentionalStopReason = reason;
    this.emit("diagnostic", `Backend stop requested: ${reason}\n`);
    this.process.kill();
    this.process = null;
  }
}

module.exports = {
  AcpClient,
  JsonRpcLineParser,
  authMethodId,
  errorDetail,
  requestDiagnostic,
  selectAuthMethod,
  serializeError,
  wireMethod,
};
