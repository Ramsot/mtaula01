import { JsonStore } from '../../core/store.js';

/**
 * Bot usage metrics, persisted so the dashboard keeps its history across the
 * redeploys that restart the process (and previously wiped every counter).
 */
export interface BotMetrics {
  since: number;
  startedAt: number;
  messagesReceived: number;
  commandsTotal: number;
  commandsByName: Record<string, number>;
  commandsByCategory: Record<string, number>;
  aiEngines: Record<string, { ok: number; fail: number; totalMs: number }>;
  backlogProcessed: number;
  cooldownsHit: number;
  lastError: { message: string; at: number } | null;
}

export function defaultMetrics(): BotMetrics {
  const now = Date.now();
  return {
    since: now,
    startedAt: now,
    messagesReceived: 0,
    commandsTotal: 0,
    commandsByName: {},
    commandsByCategory: {},
    aiEngines: {},
    backlogProcessed: 0,
    cooldownsHit: 0,
    lastError: null,
  };
}

/** Keep the per-command maps bounded: drop the least used names once over cap. */
function trimCounter(map: Record<string, number>, max = 200): void {
  const keys = Object.keys(map);
  if (keys.length <= max) return;
  keys
    .sort((a, b) => (map[a] ?? 0) - (map[b] ?? 0))
    .slice(0, keys.length - max)
    .forEach(k => delete map[k]);
}

function bump(map: Record<string, number>, key: string): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
  trimCounter(map);
}

export class MetricsRepo {
  private store: JsonStore<BotMetrics & Record<string, unknown>>;
  private ready: Promise<unknown> | null = null;

  constructor(file: string, debounceMs = 5000) {
    this.store = new JsonStore<BotMetrics & Record<string, unknown>>(
      file,
      defaultMetrics() as BotMetrics & Record<string, unknown>,
      debounceMs
    );
  }

  init(): Promise<unknown> {
    if (!this.ready) this.ready = this.store.load();
    return this.ready;
  }

  markStarted(): void {
    this.store.update(d => {
      d.startedAt = Date.now();
    });
  }

  messageReceived(): void {
    this.store.update(d => {
      d.messagesReceived += 1;
    });
  }

  command(name: string, category: string): void {
    this.store.update(d => {
      d.commandsTotal += 1;
      bump(d.commandsByName, name);
      bump(d.commandsByCategory, category);
    });
  }

  aiResult(engine: string, ok: boolean, ms: number): void {
    this.store.update(d => {
      const entry = d.aiEngines[engine] ?? { ok: 0, fail: 0, totalMs: 0 };
      if (ok) entry.ok += 1;
      else entry.fail += 1;
      entry.totalMs += Math.max(0, Math.round(ms));
      d.aiEngines[engine] = entry;
    });
  }

  backlogProcessed(count = 1): void {
    this.store.update(d => {
      d.backlogProcessed += count;
    });
  }

  cooldownHit(): void {
    this.store.update(d => {
      d.cooldownsHit += 1;
    });
  }

  recordError(message: string): void {
    this.store.update(d => {
      d.lastError = { message: String(message).slice(0, 300), at: Date.now() };
    });
  }

  snapshot(): BotMetrics {
    const data = this.store.get();
    return {
      ...data,
      aiEngines: { ...data.aiEngines },
      commandsByName: { ...data.commandsByName },
      commandsByCategory: { ...data.commandsByCategory },
    };
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}
