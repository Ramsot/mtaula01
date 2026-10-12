/**
 * Exact-once guard for the current process.
 *
 * WhatsApp re-delivers messages after a reconnect (and our own sends come back
 * as `append`), so the same message can reach the handler twice. The persisted
 * ledger covers commands across restarts; this covers everything else cheaply
 * and in memory, so a duplicated event cannot double-post an auto-chat reply or
 * a view-once save.
 */
export class RecentIds {
  private ids = new Set<string>();

  constructor(private maxSize = 2000) {}

  /** Remember `id`; returns false when it was already seen. */
  add(id: string): boolean {
    if (!id) return true;
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.maxSize) {
      // Sets keep insertion order, so the first key is the oldest.
      const oldest = this.ids.values().next().value as string | undefined;
      if (oldest) this.ids.delete(oldest);
    }
    return true;
  }

  has(id: string): boolean {
    return !!id && this.ids.has(id);
  }

  get size(): number {
    return this.ids.size;
  }

  reset(): void {
    this.ids.clear();
  }
}
