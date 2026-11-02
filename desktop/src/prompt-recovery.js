const crypto = require("node:crypto");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

class PromptRecovery {
  constructor({ createId = () => crypto.randomUUID() } = {}) {
    this.createId = createId;
    this.active = null;
    this.recoverable = null;
  }

  begin(prompt, source) {
    this.active = { ...clone(prompt), source: String(source || "desktop") };
  }

  finish() {
    this.active = null;
  }

  cancel({ recover = false } = {}) {
    if (!this.active) return null;
    if (!recover) {
      this.active = null;
      return null;
    }
    this.recoverable = { id: this.createId(), ...clone(this.active) };
    this.active = null;
    return clone(this.recoverable);
  }

  summary() {
    if (!this.recoverable) return null;
    return {
      id: this.recoverable.id,
      text: this.recoverable.text,
      source: this.recoverable.source,
      attachments: (this.recoverable.attachments || []).map(({ name, kind }) => ({ name, kind })),
    };
  }

  consume() {
    if (!this.recoverable) return null;
    const value = clone(this.recoverable);
    this.recoverable = null;
    return value;
  }

  clear() {
    this.active = null;
    this.recoverable = null;
  }
}

module.exports = { PromptRecovery };
