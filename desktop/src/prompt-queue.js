const crypto = require("node:crypto");

function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

class PromptQueue {
  constructor(options = {}) {
    this.createId = options.createId || (() => crypto.randomUUID());
    this.now = options.now || (() => Date.now());
    this.items = [];
  }

  publicItem(item) {
    return {
      id: item.id,
      text: item.prompt.text,
      attachments: clone(item.prompt.attachments || []),
      source: item.source,
      createdAt: item.createdAt,
    };
  }

  requiredIndex(id) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error("该指令不存在或已经开始执行");
    return index;
  }

  enqueue(prompt, source, options = {}) {
    const item = {
      id: this.createId(),
      prompt: clone(prompt),
      source: String(source || "unknown"),
      createdAt: this.now(),
    };
    if (options.front) this.items.unshift(item);
    else this.items.push(item);
    return this.publicItem(item);
  }

  list() {
    return this.items.map((item) => this.publicItem(item));
  }

  get(id) {
    const item = this.items[this.requiredIndex(id)];
    return { ...this.publicItem(item), prompt: clone(item.prompt) };
  }

  takeNext() {
    const item = this.items.shift();
    if (!item) return null;
    return { ...this.publicItem(item), prompt: clone(item.prompt) };
  }

  update(id, prompt) {
    const item = this.items[this.requiredIndex(id)];
    item.prompt = clone(prompt);
    return this.publicItem(item);
  }

  remove(id) {
    const [item] = this.items.splice(this.requiredIndex(id), 1);
    return this.publicItem(item);
  }

  move(id, delta) {
    const index = this.requiredIndex(id);
    const target = Math.max(0, Math.min(this.items.length - 1, index + Number(delta || 0)));
    if (target === index) return this.publicItem(this.items[index]);
    const [item] = this.items.splice(index, 1);
    this.items.splice(target, 0, item);
    return this.publicItem(item);
  }

  prioritize(id) {
    const index = this.requiredIndex(id);
    const [item] = this.items.splice(index, 1);
    this.items.unshift(item);
    return this.publicItem(item);
  }

  clear() {
    this.items.length = 0;
  }
}

module.exports = { PromptQueue };
