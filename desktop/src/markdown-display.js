(function initMarkdownDisplay(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GrokMarkdownDisplay = api;
}(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const DELIMITER_CELL = /^(:?-{3,}:?)(?:\s+(.+))?$/;

  function pipeCells(line) {
    let value = String(line || "").trim();
    if (!value.startsWith("|") || !value.endsWith("|")) return null;
    value = value.slice(1, -1);
    const cells = value.split("|").map((cell) => cell.trim());
    return cells.length >= 2 ? cells : null;
  }

  function delimiterRow(line) {
    const cells = pipeCells(line);
    if (!cells) return null;
    const parsed = cells.map((cell) => cell.match(DELIMITER_CELL));
    if (parsed.some((match) => !match)) return null;
    return {
      clean: `| ${parsed.map((match) => match[1]).join(" | ")} |`,
      residue: parsed.map((match) => match[2]?.trim()).filter(Boolean),
    };
  }

  function loosePipeRow(line) {
    const cells = pipeCells(line);
    if (!cells || cells.every((cell) => DELIMITER_CELL.test(cell))) return null;
    const indent = String(line).match(/^\s*/)?.[0] || "";
    const label = cells[0].replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, "$1").trim();
    const value = cells.slice(1).filter(Boolean).join(" · ");
    if (!label) return value ? `${indent}- ${value}` : "";
    return value ? `${indent}- **${label}**：${value}` : `${indent}- ${label}`;
  }

  function normalizeMarkdown(source) {
    const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
    const output = [];
    let fence = null;

    for (let index = 0; index < lines.length;) {
      let line = lines[index];
      const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        const marker = fenceMatch[1];
        if (!fence) fence = { character: marker[0], length: marker.length };
        else if (marker[0] === fence.character && marker.length >= fence.length) fence = null;
        output.push(line);
        index += 1;
        continue;
      }
      if (fence) {
        output.push(line);
        index += 1;
        continue;
      }

      const header = pipeCells(line);
      const separator = index + 1 < lines.length ? delimiterRow(lines[index + 1]) : null;
      if (header && separator && header.length === pipeCells(lines[index + 1]).length) {
        output.push(line, separator.clean);
        index += 2;
        while (index < lines.length && pipeCells(lines[index])) {
          output.push(lines[index]);
          index += 1;
        }
        if (separator.residue.length) output.push("", separator.residue.join(" "));
        continue;
      }

      line = line.replace(/^(\s{0,3}#{1,6})(?=[\u3400-\u9fff\d])/, "$1 ");
      const pipeCount = (line.match(/\|/g) || []).length;
      if (pipeCount === 1 && /[\u3400-\u9fff]/.test(line)) line = line.replace(/\s+\|\s*$/, "");
      output.push(loosePipeRow(line) ?? line);
      index += 1;
    }

    return output.join("\n");
  }

  return { normalizeMarkdown };
}));

