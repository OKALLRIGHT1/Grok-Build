class ConnectionGeneration {
  constructor() {
    this.current = 0;
  }

  begin() {
    this.current += 1;
    return this.current;
  }

  isCurrent(generation) {
    return generation === this.current;
  }

  invalidate(generation) {
    if (!this.isCurrent(generation)) return false;
    this.current += 1;
    return true;
  }

  invalidateCurrent() {
    this.current += 1;
  }
}

module.exports = { ConnectionGeneration };
