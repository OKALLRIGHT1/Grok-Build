(function exposeUxPolicy(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GrokUxPolicy = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function isNearBottom(metrics, thresholdPx = 96) {
    const scrollTop = finite(metrics?.scrollTop);
    const clientHeight = finite(metrics?.clientHeight);
    const scrollHeight = finite(metrics?.scrollHeight);
    return scrollHeight - scrollTop - clientHeight <= Math.max(0, finite(thresholdPx));
  }

  function errorDetails(value) {
    if (value instanceof Error) return value.stack || value.message || String(value);
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value || "操作失败");
    }
  }

  function describeError(value, { source = "" } = {}) {
    const details = (errorDetails(value) || "操作失败").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
    const lower = details.toLowerCase();
    // Command output can mention JSON, auth, or OS permissions without being
    // a model protocol failure or a denied workspace approval.
    if (source === "background-task" || /^后台任务“[\s\S]*”执行失败（/.test(details)) {
      const chromeStarted = /devtools listening on ws:\/\//i.test(details);
      const updaterFailure = /(?:chrome[\\/]updater[\\/]|update_service_dialer_win\.cc)/i.test(details);
      return {
        kind: "command",
        title: "后台命令执行失败",
        guidance: chromeStarted && updaterFailure
          ? "Chrome 已启动调试服务，日志还包含更新组件的访问错误。请检查命令结束原因，并确认调试端口是否仍可连接。"
          : "请查看技术详情中的退出码和命令输出，修正命令后重试。",
        details,
      };
    }
    if (/grok build is coming soon|you don.t have access now/.test(lower) && /403|forbidden/.test(lower)) {
      return {
        kind: "model-service-access",
        title: "官方服务拒绝了模型请求（403）",
        guidance: "若同一官方模型在终端 CLI 可用，请核对两端的 CLI 路径、版本和登录账号，并查看诊断日志中的连接模式。",
        details,
      };
    }
    if (/serializ(?:ation|e|ing)|deserializ(?:ation|e|ing)|missing (?:required )?field|invalid type|(?:invalid|malformed) json|json (?:parse|parsing|syntax|decode|decoding) (?:error|failed|failure)|(?:parse|parsing|decod(?:e|ing)) (?:error[^\n]*json|json)|unexpected (?:token|end)[^\n]*json/.test(lower)) {
      return {
        kind: "serialization",
        title: "模型响应格式不兼容",
        guidance: "可以重试一次；如果持续出现，请切换模型或检查接口协议。",
        details,
      };
    }
    if (/timed? out|timeout|超时/.test(lower)) {
      return {
        kind: "timeout",
        title: "操作等待超时",
        guidance: "请检查电脑连接状态后重试，长任务也可以从历史会话继续。",
        details,
      };
    }
    if (/unauthorized|forbidden|auth|login|token|401|403|登录|鉴权/.test(lower)) {
      return {
        kind: "auth",
        title: "登录或密钥不可用",
        guidance: "请重新登录 Grok，或检查当前供应商的 API Key。",
        details,
      };
    }
    if (/network|socket|econn|dns|offline|disconnected|连接|网络/.test(lower)) {
      return {
        kind: "network",
        title: "连接暂时中断",
        guidance: "请确认电脑端仍在运行，并检查局域网或 Tailscale 连接。",
        details,
      };
    }
    if (/permission|denied|拒绝|权限/.test(lower)) {
      return {
        kind: "permission",
        title: "操作没有获得权限",
        guidance: "请检查当前工作区权限模式，或重新提交后进行确认。",
        details,
      };
    }
    return {
      kind: "generic",
      title: "操作没有完成",
      guidance: "请查看技术详情；修正设置后可以重新执行。",
      details,
    };
  }

  function permissionSource(request) {
    const tool = request?.toolCall || request?.tool || {};
    const title = tool.title || tool.name || tool.tool || request?.title || "受保护的操作";
    const input = tool.rawInput ?? tool.arguments ?? tool.content ?? request?.details ?? "";
    return { title: String(title), details: errorDetails(input) };
  }

  function describePermission(request) {
    const source = permissionSource(request);
    const searchable = `${source.title}\n${source.details}`.toLowerCase();
    const destructive = /delete|remove|unlink|rmdir|move-item|write|overwrite|删除|移除|覆盖|写入/.test(searchable);
    return {
      level: destructive ? "high" : "normal",
      label: destructive ? "高影响操作" : "需要确认",
      summary: `Grok 请求执行：${source.title}`,
      details: source.details,
    };
  }

  function describeHealth(runtime) {
    const connected = Boolean(runtime?.connected);
    const cliConnected = Boolean(runtime?.cliConnected || connected);
    const status = String(runtime?.status || "idle");
    const workspace = runtime?.workspaceName || runtime?.workspace || "";
    const modelId = runtime?.modelState?.currentModelId || runtime?.currentModelId || "";
    const authRequired = status === "auth-required" || Boolean(runtime?.requiresAuth);
    return [
      {
        id: "backend",
        label: "本地 CLI",
        state: cliConnected ? "ready" : status === "connecting" || status === "idle" ? "waiting" : "problem",
        detail: cliConnected ? "已连接" : status === "connecting" ? "正在连接" : status === "idle" ? "准备连接" : "连接失败，请检查 CLI 设置",
      },
      {
        id: "workspace",
        label: "工作区",
        state: workspace ? "ready" : "waiting",
        detail: workspace || "请选择代码目录",
      },
      {
        id: "access",
        label: "账号或 API",
        state: connected ? "ready" : authRequired ? "problem" : "waiting",
        detail: connected ? "可用" : authRequired ? "需要登录" : cliConnected ? "打开项目后检查" : "等待 CLI 连接",
      },
      {
        id: "model",
        label: "当前模型",
        state: connected && modelId ? "ready" : connected ? "waiting" : "waiting",
        detail: modelId || (connected ? "等待模型目录" : cliConnected ? "打开项目后选择" : "等待 CLI 连接"),
      },
    ];
  }

  function describeComposer({ connected, busy, editing, hasContent }) {
    const disabled = !connected || !hasContent;
    if (editing) return { mode: "save", hint: "正在编辑待执行指令", sendLabel: "保存修改", disabled };
    if (busy) return { mode: "queue", hint: "发送后加入待执行", sendLabel: "加入待执行", disabled };
    return { mode: "send", hint: connected ? "立即发送" : "等待工作区连接", sendLabel: "发送", disabled };
  }

  function pathBasename(filePath) {
    return String(filePath || "").split(/[\\/]/).filter(Boolean).at(-1) || String(filePath || "");
  }

  function describePlanApprovalContext(request = {}) {
    const workspace = String(request.workspaceName || request.workspace || request.cwd || "").trim();
    if (workspace) return { label: pathBasename(workspace), title: workspace };
    const sessionId = String(request.sessionId || "").trim();
    if (sessionId) {
      return {
        label: `会话 ${sessionId.length > 13 ? sessionId.slice(0, 13) : sessionId}`,
        title: sessionId,
      };
    }
    return { label: "当前会话", title: "当前会话" };
  }

  function excerptText(value, limit = 2000) {
    const text = String(value || "").trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}\n… 已截断`;
  }

  function describeBackgroundTask(task = {}) {
    const rawExitCode = task.exit_code ?? task.exitCode;
    const parsedExit = rawExitCode == null || rawExitCode === "" ? null : Number(rawExitCode);
    const exitCode = Number.isFinite(parsedExit) ? parsedExit : null;
    const signal = task.signal ? String(task.signal) : "";
    const explicit = Boolean(task.explicitly_killed ?? task.explicitlyKilled);
    const command = String(task.display_command ?? task.displayCommand ?? task.command ?? "后台命令");
    const taskId = String(task.task_id ?? task.taskId ?? "background-task");
    const output = excerptText(task.output ?? task.output_for_prompt ?? task.rawOutput ?? "");
    const stopped = explicit || /^(killed|cancelled|canceled)$/i.test(signal);
    if (stopped) {
      return {
        kind: "stopped",
        taskId,
        command,
        exitCode,
        signal: signal || "killed",
        output,
        status: "completed",
        detail: [`后台任务已停止，这不是测试或命令自己失败。`, output].filter(Boolean).join("\n\n"),
        message: `后台任务“${command}”已停止。`,
      };
    }

    const reasons = {
      timeout: "等待超时被终止",
      max_runtime: "超过最长运行时间被终止",
      output_limit: "输出过大被终止",
      oom: "内存不足被终止",
    };
    const reason = reasons[signal]
      || (signal ? `被终止（${signal}）` : exitCode ? `退出码 ${exitCode}` : "");
    if (!reason) {
      return {
        kind: "succeeded",
        taskId,
        command,
        exitCode,
        signal: signal || null,
        output,
        status: "completed",
        detail: output,
        message: "",
      };
    }

    const message = [
      `后台任务“${command}”执行失败（${reason}）。`,
      output || "当前对话没有捕获到任务输出，可在任务监控中查看完整日志。",
    ].join("\n\n");
    return {
      kind: "failed",
      taskId,
      command,
      exitCode,
      signal: signal || null,
      output,
      status: "failed",
      detail: message,
      message,
    };
  }

  return {
    describeBackgroundTask,
    describeComposer,
    describeError,
    describeHealth,
    describePermission,
    describePlanApprovalContext,
    isNearBottom,
  };
}));
