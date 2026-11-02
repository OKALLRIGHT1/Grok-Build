const KNOWN_ENDPOINT = /\/(?:chat\/completions|responses|messages|models)\/?$/i;

function endpoint(baseUrl, suffix) {
  const url = new URL(String(baseUrl || ""));
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(KNOWN_ENDPOINT, "").replace(/\/$/, "") + `/${suffix}`;
  return url.toString().replace(/\/$/, "");
}

function headers(model, json = false) {
  const value = json ? { "Content-Type": "application/json" } : {};
  if (model.apiBackend === "messages") {
    value["x-api-key"] = model.apiKey;
    value["anthropic-version"] = "2023-06-01";
  } else {
    value.Authorization = `Bearer ${model.apiKey}`;
  }
  return value;
}

function buildQuickRequest(model) {
  return {
    url: endpoint(model.baseUrl, "models"),
    options: { method: "GET", headers: headers(model) },
  };
}

function buildRealRequest(model) {
  let suffix;
  let body;
  if (model.apiBackend === "chat_completions") {
    suffix = "chat/completions";
    body = {
      model: model.model,
      messages: [{ role: "user", content: "Reply with OK" }],
      max_tokens: 4,
      temperature: 0,
    };
  } else if (model.apiBackend === "responses") {
    suffix = "responses";
    body = { model: model.model, input: "Reply with OK", max_output_tokens: 16 };
  } else if (model.apiBackend === "messages") {
    suffix = "messages";
    body = {
      model: model.model,
      messages: [{ role: "user", content: "Reply with OK" }],
      max_tokens: 4,
      temperature: 0,
    };
  } else {
    throw new Error(`不支持的接口协议: ${model.apiBackend}`);
  }
  return {
    url: endpoint(model.baseUrl, suffix),
    options: { method: "POST", headers: headers(model, true), body: JSON.stringify(body) },
  };
}

function redact(value, secret) {
  const text = String(value || "");
  return secret ? text.split(secret).join("[REDACTED]") : text;
}

function extractOutput(backend, payload) {
  if (backend === "chat_completions") {
    return payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? "";
  }
  if (backend === "responses") {
    if (payload?.output_text) return payload.output_text;
    return (payload?.output || []).flatMap((item) => item?.content || [])
      .map((item) => item?.text || item?.output_text || "").join("");
  }
  if (backend === "messages") {
    return (payload?.content || []).map((item) => item?.text || "").join("");
  }
  return "";
}

function baseResult(model, mode, latencyMs) {
  return {
    provider: model.providerName,
    providerId: model.providerId,
    model: model.name,
    modelId: model.modelId,
    modelIdentifier: model.model,
    mode,
    latencyMs,
  };
}

async function runModelProbe(model, mode, {
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  timeoutMs = 8000,
} = {}) {
  if (!new Set(["quick", "real"]).has(mode)) throw new Error("检测模式无效");
  if (!model?.apiKey) throw new Error("该供应商尚未保存 API Key");
  const request = mode === "quick" ? buildQuickRequest(model) : buildRealRequest(model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = now();
  try {
    const response = await fetchImpl(request.url, { ...request.options, signal: controller.signal });
    const latencyMs = Math.max(0, now() - startedAt);
    const raw = await response.text();
    const details = redact(raw.slice(0, 3000), model.apiKey);
    if (mode === "quick") {
      if (response.ok || response.status === 404 || response.status === 405) {
        return {
          ...baseResult(model, mode, latencyMs), ok: true, category: "reachable",
          httpStatus: response.status,
          summary: response.ok ? "服务可达，模型目录请求成功" : "服务可达，但未提供标准模型目录接口",
          technicalDetails: details,
        };
      }
    }
    if (!response.ok) {
      const authentication = response.status === 401 || response.status === 403;
      return {
        ...baseResult(model, mode, latencyMs), ok: false,
        category: authentication ? "authentication" : response.status >= 500 ? "service" : "http",
        httpStatus: response.status,
        summary: authentication ? "服务可达，但 API Key 未通过验证" : `服务返回 HTTP ${response.status}`,
        technicalDetails: `${response.status} ${response.statusText}${details ? `\n${details}` : ""}`,
      };
    }
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = {};
    }
    const output = String(extractOutput(model.apiBackend, payload) || "").trim();
    if (!output) {
      return {
        ...baseResult(model, mode, latencyMs), ok: false, category: "response",
        httpStatus: response.status, summary: "请求成功，但响应中没有可识别的模型输出", technicalDetails: details,
      };
    }
    return {
      ...baseResult(model, mode, latencyMs), ok: true, category: "available",
      httpStatus: response.status, summary: "模型真实请求成功", output,
      technicalDetails: details,
    };
  } catch (error) {
    const latencyMs = Math.max(0, now() - startedAt);
    const timedOut = error?.name === "AbortError";
    return {
      ...baseResult(model, mode, latencyMs), ok: false,
      category: timedOut ? "timeout" : "connectivity",
      summary: timedOut ? `连接在 ${timeoutMs} ms 后超时` : "无法连接到供应商服务",
      technicalDetails: redact(error?.message || String(error), model.apiKey),
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { buildQuickRequest, buildRealRequest, runModelProbe };
