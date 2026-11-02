function proxyEnvironment(env = {}, resolvedProxy = "") {
  if (Object.entries(env).some(([key, value]) => /^(https?|all)_proxy$/i.test(key) && String(value || "").trim())) return {};
  for (const entry of String(resolvedProxy).split(";")) {
    const match = entry.trim().match(/^(PROXY|HTTPS|SOCKS5?|SOCKS4)\s+([^\s@/]+)$/i);
    if (!match) {
      if (/^DIRECT$/i.test(entry.trim())) return {};
      continue;
    }
    const scheme = /^SOCKS4$/i.test(match[1]) ? "socks4" : /^SOCKS/i.test(match[1]) ? "socks5h" : /^HTTPS$/i.test(match[1]) ? "https" : "http";
    try {
      const url = new URL(`${scheme}://${match[2]}`);
      if (!url.hostname || !url.port) continue;
      return { HTTPS_PROXY: url.href.replace(/\/$/, ""), HTTP_PROXY: url.href.replace(/\/$/, ""), NO_PROXY: env.NO_PROXY || env.no_proxy || "localhost,127.0.0.1,::1" };
    } catch {}
  }
  return {};
}

function billingFailure(error) {
  const details = String(error?.detail || error?.message || error || "未知错误")
    .replace(/Bearer\s+\S+/gi, "Bearer [已隐藏]")
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[已隐藏]@");
  if (/auth(?:entication)? required|requires auth|grok login|unauthorized|401|403/i.test(details)) {
    return { code: "BILLING_AUTH_REQUIRED", message: "请先登录 Grok 账号，再查询官方额度。第三方 API 的余额需在对应服务商查询。", details, retryable: false };
  }
  if (/error sending request|failed to fetch billing|timed? ?out|timeout|dns|tls|connection|network|连接|网络/i.test(details)) {
    return { code: "BILLING_NETWORK_ERROR", message: "暂时无法连接 Grok 额度服务。请检查电脑的网络与代理后刷新；如果刚开启系统代理，请重启客户端后再试。", details, retryable: true };
  }
  return { code: "BILLING_SERVICE_ERROR", message: "Grok 额度服务暂时无法返回数据，请稍后重试或打开管理账单。", details, retryable: false };
}

module.exports = { proxyEnvironment, billingFailure };
