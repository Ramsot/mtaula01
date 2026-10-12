import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import logger from './logger.js';

/**
 * A tiny, crash-safe JSON document store for bot state that must outlive a
 * redeploy (metrics, the processed-command ledger, runtime settings).
 *
 * It reuses the same durability tricks as the auth state, because it sits on the
 * same mounted Disk and is written by the same abruptly-killed process:
 *
 *  - writes are atomic (tmp file + rename), so a SIGKILL mid-write can never
 *    leave a truncated document behind;
 *  - the previous good copy is mirrored to `<file>.backup` and restored
 *    automatically when the live file is missing or unparseable;
 *  - writes are serialized through one promise chain, so two updates landing at
 *    the same time cannot overwrite each other out of order;
 *  - `debounceMs` coalesces bursts of updates (metrics change on every message).
 */
export class JsonStore<T extends Record<string, unknown>> {
  private data: T;
  private writeQueue: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  constructor(
    private readonly file: string,
    private readonly defaults: T,
    private readonly debounceMs = 0
  ) {
    this.data = { ...defaults };
  }

  private get backupFile(): string {
    return `${this.file}.backup`;
  }

  /** Read the document, restoring the backup or seeding a fresh one as needed. */
  async load(): Promise<T> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });

    const live = await this.readJson(this.file);
    if (live) {
      // Shallow merge so newly added keys appear after an upgrade.
      this.data = { ...this.defaults, ...live };
      return this.data;
    }

    const backup = await this.readJson(this.backupFile);
    if (backup) {
      logger.warn({ file: this.file }, 'Store was missing or corrupt - restored the last good backup');
      await this.writeAtomic(this.file, JSON.stringify(backup, null, 2));
      this.data = { ...this.defaults, ...backup };
      return this.data;
    }

    // First run (or both copies gone): seed from defaults and mirror a backup.
    this.data = { ...this.defaults };
    await this.writeAtomic(this.file, JSON.stringify(this.data, null, 2));
    await fs.copyFile(this.file, this.backupFile).catch(() => {});
    return this.data;
  }

  /** Current in-memory document. Do not mutate the result directly. */
  get(): T {
    return this.data;
  }

  /** Mutate the document and schedule a durable write. */
  update(mutator: (draft: T) => void): void {
    mutator(this.data);
    this.scheduleWrite();
  }

  /** Force a write right now (used on shutdown). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) {
      await this.writeQueue;
      return;
    }
    this.dirty = false;
    this.writeQueue = this.writeQueue.then(
      () => this.persist(),
      () => this.persist()
    );
    await this.writeQueue;
  }

  private scheduleWrite(): void {
    this.dirty = true;
    if (this.timer) return;
    // A timeout of 0 still defers to the next tick, which coalesces the
    // synchronous bursts that come out of a single message handler.
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.dirty) return;
      this.dirty = false;
      this.writeQueue = this.writeQueue.then(
        () => this.persist(),
        () => this.persist()
      );
      this.writeQueue.catch(() => {});
    }, this.debounceMs);
    this.timer.unref?.();
  }

  private async persist(): Promise<void> {
    try {
      await this.writeAtomic(this.file, JSON.stringify(this.data, null, 2));
      await fs.copyFile(this.file, this.backupFile).catch(() => {});
    } catch (err: any) {
      logger.error({ file: this.file, err: err?.message }, 'Failed to persist store');
    }
  }

  private async readJson(file: string): Promise<T | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf-8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed as T;
    } catch {
      return null;
    }
  }

  private async writeAtomic(file: string, data: string): Promise<void> {
    const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmp, data);
    try {
      await fs.rename(tmp, file);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }
}
