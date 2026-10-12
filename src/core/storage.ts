import path from 'path';
import config from '../config/index.js';
import logger from './logger.js';
import { MetricsRepo } from '../database/repositories/metrics-repo.js';
import { LedgerRepo } from '../database/repositories/ledger-repo.js';
import { SettingsRepo } from '../database/repositories/settings-repo.js';

/**
 * One place that owns the persisted bot state, so the rest of the codebase can
 * import a repo instead of threading file paths around. Everything lands on
 * DATA_DIR (a mounted Disk on Render), next to the WhatsApp session.
 *
 * The repos are cheap to construct and touch no disk until `initStorage()`, so
 * importing this module is side-effect free (important for tests).
 */
export const metrics = new MetricsRepo(path.join(config.DATA_DIR, 'metrics.json'));

export const ledger = new LedgerRepo(path.join(config.DATA_DIR, 'command-ledger.json'));

export const settingsStore = new SettingsRepo(path.join(config.DATA_DIR, 'settings.json'));

let initialized = false;

export async function initStorage(): Promise<void> {
  if (initialized) return;
  await Promise.all([metrics.init(), ledger.init(), settingsStore.init()]);
  // Expired ids from the previous run are useless: drop them at boot so the
  // ledger cannot grow forever on a bot that runs for months.
  ledger.prune();
  metrics.markStarted();
  initialized = true;
  logger.info({ dataDir: config.DATA_DIR, ledgerIds: ledger.size }, 'Storage initialized');
}

/** Persist anything still buffered (called on shutdown / before an exit). */
export async function flushStorage(): Promise<void> {
  await Promise.all([metrics.flush(), ledger.flush(), settingsStore.flush()]);
}
