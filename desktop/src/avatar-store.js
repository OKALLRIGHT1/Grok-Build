const fs = require("node:fs");
const path = require("node:path");

const ROLES = new Set(["user", "assistant"]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const MAX_AVATAR_BYTES = 1024 * 1024;

function assertRole(role) {
  if (!ROLES.has(role)) throw new Error("头像类型无效");
}

class AvatarStore {
  constructor({ directory }) {
    this.directory = directory;
  }

  file(role) {
    assertRole(role);
    return path.join(this.directory, `${role}.png`);
  }

  read(role) {
    try {
      const value = fs.readFileSync(this.file(role));
      if (!value.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return null;
      return `data:image/png;base64,${value.toString("base64")}`;
    } catch {
      return null;
    }
  }

  getAll() {
    return { user: this.read("user"), assistant: this.read("assistant") };
  }

  set(role, pngBuffer) {
    const file = this.file(role);
    if (!Buffer.isBuffer(pngBuffer) || !pngBuffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error("头像必须是有效的 PNG 图片");
    }
    if (pngBuffer.length > MAX_AVATAR_BYTES) throw new Error("处理后的头像不能超过 1 MB");
    fs.mkdirSync(this.directory, { recursive: true });
    const temporary = `${file}.desktop.tmp`;
    fs.writeFileSync(temporary, pngBuffer);
    fs.renameSync(temporary, file);
    return this.getAll();
  }

  reset(role) {
    const file = this.file(role);
    try {
      fs.unlinkSync(file);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return this.getAll();
  }
}

module.exports = { AvatarStore, MAX_AVATAR_BYTES };

