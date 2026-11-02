const path = require("node:path");

const MAX_ATTACHMENT_COUNT = 5;
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_BYTES = 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function safeName(value, index) {
  const name = path.basename(String(value || `attachment-${index + 1}`)).trim();
  return (name || `attachment-${index + 1}`).slice(0, 180);
}

function base64Bytes(value) {
  const data = String(value || "");
  if (!data || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    throw new Error("附件数据格式无效");
  }
  return Buffer.from(data, "base64");
}

function buildPromptContent(input) {
  const payload = typeof input === "string" ? { text: input, attachments: [] } : (input || {});
  const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (attachments.length > MAX_ATTACHMENT_COUNT) throw new Error(`一次最多发送 ${MAX_ATTACHMENT_COUNT} 个附件`);

  const blocks = [];
  const metadata = [];
  let totalBytes = 0;
  attachments.forEach((attachment, index) => {
    const name = safeName(attachment?.name, index);
    const mimeType = String(attachment?.mimeType || "application/octet-stream").slice(0, 120);
    const uri = `file:///attachments/${encodeURIComponent(name)}`;
    if (attachment?.kind === "text") {
      const content = String(attachment.content || "");
      const bytes = Buffer.byteLength(content, "utf8");
      if (!content || bytes > MAX_TEXT_ATTACHMENT_BYTES) throw new Error(`${name} 不是有效文本或超过 1 MB`);
      totalBytes += bytes;
      blocks.push({ type: "resource", resource: { uri, mimeType, text: content } });
      metadata.push({ name, mimeType, size: bytes, kind: "text" });
      return;
    }

    const bytes = base64Bytes(attachment?.data);
    if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`${name} 超过 5 MB`);
    totalBytes += bytes.length;
    if (attachment?.kind === "image" && mimeType.startsWith("image/")) {
      blocks.push({ type: "image", data: attachment.data, mimeType, uri });
      metadata.push({ name, mimeType, size: bytes.length, kind: "image" });
    } else {
      blocks.push({ type: "resource", resource: { uri, mimeType, blob: attachment.data } });
      metadata.push({ name, mimeType, size: bytes.length, kind: "file" });
    }
  });
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error("附件总大小不能超过 8 MB");

  const text = String(payload.text || "").trim();
  if (!text && !blocks.length) throw new Error("任务内容不能为空");
  const promptText = text || "请分析这些附件。";
  return {
    text: promptText,
    blocks: [{ type: "text", text: promptText }, ...blocks],
    attachments: metadata,
  };
}

module.exports = {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TEXT_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  buildPromptContent,
};
