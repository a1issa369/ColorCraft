// Undo and redo as a list of snapshots. Each finished gesture adds one; going back and editing drops the redo steps.
export class History {
  constructor(limit = 100) {
    this.limit = limit;
    this.reset();
  }

  reset() {
    this.stack = [];
    this.index = -1;
  }

  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.stack.length - 1; }

  /** Record a snapshot. A repeat of the current state (same signature) is ignored. Returns true if it was added. */
  commit(snap, signature) {
    const top = this.stack[this.index];
    if (top && top.signature === signature) return false;
    this.stack.length = this.index + 1;
    this.stack.push({ snap, signature });
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
    return true;
  }

  /** The snapshot to go back to, or null if already at the oldest. */
  undo() {
    if (!this.canUndo) return null;
    this.index--;
    return this.stack[this.index].snap;
  }

  redo() {
    if (!this.canRedo) return null;
    this.index++;
    return this.stack[this.index].snap;
  }
}
