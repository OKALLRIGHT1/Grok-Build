const crypto = require("node:crypto");

class TaskLifecycle {
  constructor({ createId = () => crypto.randomUUID(), now = () => Date.now() } = {}) {
    this.createId = createId;
    this.now = now;
    this.current = null;
  }

  start(source) {
    this.current = {
      id: this.createId(),
      state: "started",
      source: String(source || "desktop"),
      timestamp: this.now(),
    };
    return this.snapshot();
  }

  finish(id, state) {
    if (!this.current || this.current.id !== id || this.current.state !== "started") return null;
    this.current = { ...this.current, state, timestamp: this.now() };
    return this.snapshot();
  }

  complete(id) {
    return this.finish(id, "completed");
  }

  fail(id) {
    return this.finish(id, "failed");
  }

  interrupt() {
    return this.current?.state === "started"
      ? this.finish(this.current.id, "interrupted")
      : null;
  }

  isInterrupted(id) {
    return Boolean(this.current && this.current.id === id && this.current.state === "interrupted");
  }

  snapshot() {
    return this.current ? { ...this.current } : null;
  }

  clear() {
    this.current = null;
  }
}

module.exports = { TaskLifecycle };
