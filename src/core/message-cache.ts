/**
 * A bounded, time-limited cache of recently seen messages.
 *
 * This exists for one critical reason: **WhatsApp decryption retries**. When a
 * recipient cannot decrypt a message the device sends a *retry receipt* asking
 * the sender to re-send it. Baileys can only honour that request if the socket
 * was given a `getMessage` function that can hand the original message back
 * (see `sendMessagesAgain` in Baileys' `messages-recv`). With no `getMessage`,
 * Baileys' default returns `undefined`, the re-send never happens, and the
 * recipient is stuck on **"Waiting for this message. This may take a while."**
 * forever.
 *
 * Keeping the last N messages lets the bot answer those retries, which is what
 * clears the "waiting" state for messages the bot sends as well as receives.
 */
export interface CachedMessage {
  raw: any;
  storedAt: number;
}

export class MessageCache {
  private store = new Map<string, CachedMessage>();

  constructor(
    private maxSize = 10_000,
    private ttlMs = 48 * 60 * 60 * 1000
  ) {}

  set(id: string, raw: any): void {
    if (!id || !raw) return;
    this.store.set(id, { raw, storedAt: Date.now() });
    this.prune();
  }

  get(id: string): any | undefined {
    const entry = this.store.get(id);
    if (!entry) return undefined;
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.store.delete(id);
      return undefined;
    }
    return entry.raw;
  }

  delete(id: string): void {
    this.store.delete(id);
  }

  get size(): number {
    return this.store.size;
  }

  /** Remove expired entries, then the oldest ones beyond `maxSize`. */
  private prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.storedAt > this.ttlMs) this.store.delete(key);
    }
    while (this.store.size > this.maxSize) {
      const oldest = this.store.keys().next().value as string | undefined;
      if (!oldest) break;
      this.store.delete(oldest);
    }
  }
}
