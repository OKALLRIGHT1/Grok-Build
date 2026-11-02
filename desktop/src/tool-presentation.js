(function exposeToolPresentation(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GrokToolPresentation = api;
}(typeof globalThis === "object" ? globalThis : this, () => {
  const MAX_DISPLAY_CHARS = 16_000;
  const MAX_TITLE_CHARS = 96;
  const CATEGORY_ICONS = {
    search: "search",
    read: "file-text",
    edit: "file-pen-line",
    terminal: "terminal",
    other: "wrench",
  };
  const CATEGORY_LABELS = {
    search: "搜索",
    read: "读取",
    edit: "修改",
    terminal: "终端",
    other: "操作",
  };

  function boundedText(value) {
    const text = String(value || "");
    if (text.length <= MAX_DISPLAY_CHARS) return { text, truncated: false };
    const omitted = text.length - 14_000;
    return {
      text: `${text.slice(0, 12_000)}\n\n... 已省略 ${omitted.toLocaleString()} 个字符 ...\n\n${text.slice(-2_000)}`,
      truncated: true,
    };
  }

  function safeJson(value) {
    return JSON.stringify(value, (_key, item) => {
      if (typeof item === "string" && item.length > 4_000) {
        return `${item.slice(0, 3_500)}... [已截断 ${item.length - 3_500} 个字符]`;
      }
      if (Array.isArray(item) && item.length > 200) {
        return [...item.slice(0, 200), `... [已截断 ${item.length - 200} 项]`];
      }
      return item;
    }, 2);
  }

  function textContent(value) {
    if (!Array.isArray(value)) return "";
    return value.map((item) => item?.content?.text ?? item?.text ?? "").filter(Boolean).join("\n");
  }

  function fileName(value) {
    return String(value || "").split(/[\\/]/).filter(Boolean).pop() || "文件";
  }

  function normalizedText(value) {
    return String(value || "").replace(/[`"']/g, "").replace(/\s+/g, " ").trim();
  }

  function boundedTitle(value) {
    const text = normalizedText(value) || "操作";
    if (text.length <= MAX_TITLE_CHARS) return text;
    return `${text.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…`;
  }

  function hasDiff(update) {
    return Array.isArray(update?.content) && update.content.some((item) => (
      item?.type === "diff" || item?.oldText != null || item?.newText != null
    ));
  }

  function sourceText(update) {
    const rawInput = update?.rawInput;
    const command = typeof rawInput === "string" ? rawInput : rawInput?.command;
    return [update?.tool, update?.title, command].filter(Boolean).join(" ");
  }

  function pathCandidate(update, source, category) {
    const diff = Array.isArray(update?.content)
      ? update.content.find((item) => item?.path || item?.file_path || item?.filePath)
      : null;
    const rawInput = update?.rawInput && typeof update.rawInput === "object" ? update.rawInput : {};
    const structured = diff?.path
      || diff?.file_path
      || diff?.filePath
      || rawInput.file_path
      || rawInput.filePath
      || rawInput.path;
    if (structured) return fileName(structured);

    const quotedPath = String(source || "").match(/`([^`]+)`/);
    if (quotedPath) return fileName(quotedPath[1]);
    const windowsPath = String(source || "").match(/[A-Za-z]:[\\/][^\s"'`]+/g);
    if (windowsPath?.length) return fileName(windowsPath[windowsPath.length - 1]);
    const unixPath = String(source || "").match(/(?:^|\s)(\.?\.?\/[A-Za-z0-9_./-]+)/g);
    if (unixPath?.length) return fileName(unixPath[unixPath.length - 1].trim());

    if (category === "search") {
      const tokens = normalizedText(source).split(" ").filter(Boolean);
      const candidate = tokens.at(-1);
      if (candidate && !candidate.startsWith("-")) return fileName(candidate);
    }
    return "";
  }

  function classify(update, source) {
    const normalized = normalizedText(source).toLowerCase();
    if (hasDiff(update) || /(^|\s)(edit|write|apply_patch|replace|修改|写入)(\s|$)/.test(normalized)) return "edit";
    if (/(^|\s)(rg|grep|findstr|search|search_files|搜索)(\s|$)/.test(normalized)) return "search";
    if (/run_terminal_command|shell_command|terminal|powershell|cmd\.exe/.test(normalized)) return "terminal";
    if (/(^|\s)(read|read_file|get-content|cat|读取)(\s|$)/.test(normalized)) return "read";
    return "other";
  }

  function concisePurpose(source) {
    const normalized = normalizedText(source)
      .replace(/^(run_terminal_command|shell_command|terminal)\s*/i, "")
      .trim();
    return normalized || "操作";
  }

  function describe(update = {}) {
    const source = sourceText(update);
    const category = classify(update, source);
    const target = pathCandidate(update, source, category);
    const subject = target || (category === "terminal" || category === "other" ? concisePurpose(source) : "内容");
    const title = category === "other" && !normalizedText(source)
      ? CATEGORY_LABELS.other
      : boundedTitle(`${CATEGORY_LABELS[category]} ${subject}`);
    return {
      category,
      target,
      title,
      mergeKey: `${category}:${(target || title).toLocaleLowerCase()}`,
      icon: CATEGORY_ICONS[category],
    };
  }

  function createActivityState() {
    return { operations: new Map(), order: [] };
  }

  function upsertActivity(state, id, update = {}) {
    const stableId = String(id || `operation-${state.order.length + 1}`);
    const existing = state.operations.get(stableId);
    if (!existing) state.order.push(stableId);
    const data = { ...(existing?.data || {}), ...update };
    state.operations.set(stableId, { id: stableId, data });
    return state;
  }

  function operationStatus(value) {
    const status = String(value || "in_progress").toLowerCase();
    if (["failed", "error", "errored", "cancelled", "canceled"].includes(status)) return "failed";
    if (["completed", "complete", "success", "succeeded"].includes(status)) return "completed";
    return "running";
  }

  function summarizeActivity(state) {
    const operations = state.order
      .map((id) => state.operations.get(id))
      .filter(Boolean)
      .map((operation) => ({
        ...operation,
        presentation: describe(operation.data),
        status: operationStatus(operation.data.status),
      }));
    const counts = { search: 0, read: 0, edit: 0, terminal: 0, other: 0 };
    const rows = [];

    operations.forEach((operation) => {
      counts[operation.presentation.category] += 1;
      const previous = rows.at(-1);
      const canMerge = operation.status !== "failed"
        && previous?.status !== "failed"
        && previous?.mergeKey === operation.presentation.mergeKey;
      if (canMerge) {
        previous.ids.push(operation.id);
        previous.items.push(operation.data);
        previous.count += 1;
        previous.data = operation.data;
        if (operation.status === "running") previous.status = "running";
        return;
      }
      rows.push({
        key: operation.id,
        ids: [operation.id],
        items: [operation.data],
        count: 1,
        category: operation.presentation.category,
        target: operation.presentation.target,
        title: operation.presentation.title,
        mergeKey: operation.presentation.mergeKey,
        icon: operation.presentation.icon,
        status: operation.status,
        data: operation.data,
      });
    });

    const status = operations.some((operation) => operation.status === "failed")
      ? "failed"
      : operations.some((operation) => operation.status === "running") ? "running" : "completed";
    const countText = Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([category, count]) => `${CATEGORY_LABELS[category]} ${count}`)
      .join("、");
    const prefixes = { running: "正在执行", completed: "已完成", failed: "执行失败" };
    return {
      total: operations.length,
      represented: rows.length,
      status,
      counts,
      label: `${prefixes[status]} ${operations.length} 步${countText ? `：${countText}` : ""}`,
      rows,
    };
  }

  function editPresentation(update) {
    const diff = Array.isArray(update.content)
      ? update.content.find((item) => item?.type === "diff" || item?.oldText != null || item?.newText != null)
      : null;
    const applied = update.rawOutput?.EditsApplied;
    const details = diff?._meta?.details
      || applied?.edits?.details
      || update.rawOutput?.edits?.details
      || (diff ? [{ old_string: diff.oldText, new_string: diff.newText }] : null);
    if (!Array.isArray(details) || !details.length) return null;

    const targetPath = diff?.path || applied?.absolute_path || update.rawInput?.file_path || update.rawInput?.path;
    const lines = [...new Set(details.map((item) => item.new_line ?? item.old_line).filter(Number.isFinite))];
    const location = lines.length ? ` · 第 ${lines.slice(0, 4).join("、")} 行${lines.length > 4 ? "等" : ""}` : "";
    const rendered = boundedText(details.map((item, index) => {
      const line = item.new_line ?? item.old_line;
      const heading = `@@ ${line ? `第 ${line} 行` : `修改 ${index + 1}`} @@`;
      return `${heading}\n- ${String(item.old_string ?? "")}\n+ ${String(item.new_string ?? "")}`;
    }).join("\n\n"));
    return {
      text: rendered.text,
      summary: `${fileName(targetPath)} · ${details.length} 处修改${location}${rendered.truncated ? " · 已截断" : ""}`,
      collapsed: true,
    };
  }

  function format(update) {
    const edit = editPresentation(update);
    if (edit) return edit;

    const contentText = textContent(update.content);
    const raw = update.rawOutput;
    let text = contentText;
    if (!text && typeof raw?.output_for_prompt === "string") text = raw.output_for_prompt;
    if (!text && typeof raw?.Content?.content === "string") text = raw.Content.content;
    if (!text && typeof update.content === "string") text = update.content;

    const value = raw ?? update.content ?? update.rawInput ?? update.arguments;
    const structured = value != null && typeof value === "object";
    if (!text && value != null) text = typeof value === "string" ? value : safeJson(value);
    const rendered = boundedText(String(text || "").trim());
    const collapsed = structured || rendered.truncated || rendered.text.length > 500 || rendered.text.split("\n").length > 12;
    return {
      text: rendered.text,
      summary: collapsed ? `查看详细结果${rendered.truncated ? " · 已截断" : ""}` : "运行结果",
      collapsed,
    };
  }

  return { createActivityState, describe, format, summarizeActivity, upsertActivity };
}));
