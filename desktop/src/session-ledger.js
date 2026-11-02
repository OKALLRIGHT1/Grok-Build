const SENSITIVE_KEY = /api[_-]?key|token|authorization|secret|password/i;

function sanitize(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitize).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return undefined;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    const clean = sanitize(child);
    if (clean !== undefined) result[key] = clean;
  }
  return result;
}

class SessionLedger {
  constructor({ maxEntries = 1200 } = {}) {
    this.maxEntries = maxEntries;
    this.current = null;
    this.generation = 0;
  }

  start(sessionId) {
    this.generation += 1;
    this.current = {
      sessionId: String(sessionId),
      generation: this.generation,
      entries: [],
      nextSequence: 1,
    };
    return this.snapshot(sessionId);
  }

  append(type, data) {
    if (!this.current) return null;
    const entry = {
      sessionId: this.current.sessionId,
      generation: this.current.generation,
      sequence: this.current.nextSequence,
      type: String(type),
      data: sanitize(data) || {},
    };
    this.current.nextSequence += 1;
    this.current.entries.push(entry);
    if (this.current.entries.length > this.maxEntries) this.current.entries.splice(0, this.current.entries.length - this.maxEntries);
    return entry;
  }

  snapshot(sessionId) {
    if (!this.current || String(sessionId) !== this.current.sessionId) return null;
    const { entries } = this.current;
    return {
      sessionId: this.current.sessionId,
      generation: this.current.generation,
      firstSequence: entries[0]?.sequence ?? null,
      lastSequence: entries.at(-1)?.sequence ?? null,
      entries: entries.map((entry) => ({ ...entry, data: sanitize(entry.data) })),
    };
  }

  chunks(sessionId, maxBytes = 256 * 1024) {
    const snapshot = this.snapshot(sessionId);
    if (!snapshot) return [];
    const chunks = [];
    let entries = [];
    let bytes = 2;
    for (const entry of snapshot.entries) {
      const entryBytes = Buffer.byteLength(JSON.stringify(entry));
      if (entries.length && bytes + entryBytes + 1 > maxBytes) {
        chunks.push({ entries });
        entries = [];
        bytes = 2;
      }
      entries.push(entry);
      bytes += entryBytes + 1;
    }
    if (entries.length) chunks.push({ entries });
    return chunks;
  }

  clear(sessionId) {
    if (this.current?.sessionId === String(sessionId)) this.current = null;
  }
}

module.exports = { SessionLedger, sanitize };
