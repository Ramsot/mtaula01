import { JsonStore } from '../../core/store.js';

interface LedgerData {
  ids: Record<string, number>;
}

/**
 * A ledger of message ids the bot has already acted on.
 *
 * Two things need it:
 *  - after a reconnect WhatsApp replays messages the bot missed, and a command
 *    must not run twice just because it arrived twice;
 *  - after a redeploy the bot reprocesses the offline backlog, so the ledger is
 *    persisted (not just in memory) or the last command before a deploy would
 *    run again on the way back up.
 */
export class LedgerRepo {
  private store: JsonStore<LedgerData & Record<string, unknown>>;
  private ready: Promise<unknown> | null = null;

  constructor(
    file: string,
    private maxSize = 5000,
    private ttlMs = 48 * 60 * 60 * 1000
  ) {
    this.store = new JsonStore<LedgerData & Record<string, unknown>>(file, { ids: {} }, 0);
  }

  init(): Promise<unknown> {
    if (!this.ready) this.ready = this.store.load();
    return this.ready;
  }

  has(id: string): boolean {
    if (!id) return false;
    const seenAt = this.store.get().ids[id];
    if (!seenAt) return false;
    if (Date.now() - seenAt > this.ttlMs) return false;
    return true;
  }

  add(id: string): void {
    if (!id) return;
    const now = Date.now();
    this.store.update(d => {
      d.ids[id] = now;
      const entries = Object.entries(d.ids);
      if (entries.length > this.maxSize) {
        entries.sort((a, b) => a[1] - b[1]);
        for (const [key] of entries.slice(0, entries.length - this.maxSize)) {
          delete d.ids[key];
        }
      }
    });
  }

  /** Drop expired entries so the file stays small on a long-running bot. */
  prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    this.store.update(d => {
      for (const [id, seenAt] of Object.entries(d.ids)) {
        if (seenAt < cutoff) delete d.ids[id];
      }
    });
  }

  get size(): number {
    return Object.keys(this.store.get().ids).length;
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}
