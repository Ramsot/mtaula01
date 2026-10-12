/**
 * Per-user command throttling.
 *
 * WhatsApp bans numbers that burst messages, and a single user hammering an AI
 * command can burn an API quota in minutes. The web API already had a rate
 * limiter; the chat path had none at all.
 *
 * Two limits run together:
 *  - a per-user/per-command cooldown (so `.ping` cannot be spammed), and
 *  - a rolling per-user window cap covering every command (so a user cannot
 *    bypass it by rotating through different commands).
 */
export interface CooldownLimits {
  cooldownMs: number;
  windowMs: number;
  max: number;
}

export type CooldownResult =
  | { ok: true }
  | { ok: false; reason: 'cooldown' | 'rate'; retryAfterMs: number };

export class CommandCooldown {
  private lastRun = new Map<string, number>();
  private recent = new Map<string, number[]>();
  private lastWarn = new Map<string, number>();

  /**
   * Decide whether `userId` may run `command` now. A successful check consumes
   * a slot, so call it once per command execution.
   */
  check(
    userId: string,
    command: string,
    limits: CooldownLimits,
    now = Date.now()
  ): CooldownResult {
    const key = `${userId}:${command}`;
    const previous = this.lastRun.get(key);

    if (previous !== undefined && limits.cooldownMs > 0) {
      const elapsed = now - previous;
      if (elapsed < limits.cooldownMs) {
        return { ok: false, reason: 'cooldown', retryAfterMs: limits.cooldownMs - elapsed };
      }
    }

    const stamps = (this.recent.get(userId) ?? []).filter(t => now - t < limits.windowMs);
    if (limits.max > 0 && stamps.length >= limits.max) {
      const oldest = stamps[0];
      return {
        ok: false,
        reason: 'rate',
        retryAfterMs: Math.max(0, limits.windowMs - (now - oldest)),
      };
    }

    stamps.push(now);
    this.recent.set(userId, stamps);
    this.lastRun.set(key, now);
    this.prune(now);
    return { ok: true };
  }

  /**
   * Rate-limit the *warning* too: a throttled user who keeps typing should not
   * get a reply for every attempt (that would just be another spam vector).
   */
  shouldWarn(userId: string, now = Date.now(), warnEveryMs = 15_000): boolean {
    const last = this.lastWarn.get(userId) ?? 0;
    if (now - last < warnEveryMs) return false;
    this.lastWarn.set(userId, now);
    return true;
  }

  /** Forget everything (tests, and a deliberate clean slate). */
  reset(): void {
    this.lastRun.clear();
    this.recent.clear();
    this.lastWarn.clear();
  }

  get trackedUsers(): number {
    return this.recent.size;
  }

  private prune(now: number): void {
    for (const [key, at] of this.lastRun) {
      if (now - at > 30 * 60_000) this.lastRun.delete(key);
    }
    for (const [user, stamps] of this.recent) {
      const kept = stamps.filter(t => now - t < 10 * 60_000);
      if (kept.length) this.recent.set(user, kept);
      else this.recent.delete(user);
    }
    for (const [user, at] of this.lastWarn) {
      if (now - at > 30 * 60_000) this.lastWarn.delete(user);
    }
  }
}
