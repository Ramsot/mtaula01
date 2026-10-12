import config from '../config/index.js';
import logger from './logger.js';
import { settingsStore } from './storage.js';
import type { RuntimeSettings } from '../database/repositories/settings-repo.js';

/**
 * Runtime settings the owner changes from chat (`.mode self`, `.antidelete on`,
 * `.autochat on`, `.autoread on` ...).
 *
 * Before this existed each command wrote straight into the in-memory `config`
 * object or a `globalThis.__flag`, so every redeploy silently reverted the bot
 * to its defaults and the owner had to re-issue the commands. Now a single
 * setter both applies the value and persists it, and boot replays the stored
 * values before the first message is handled.
 */
type Applier = (value: unknown) => void;

const APPLIERS: Record<keyof RuntimeSettings, Applier> = {
  mode: v => {
    config.MODE = v as 'public' | 'self';
  },
  autoRead: v => {
    config.AUTO_READ = !!v;
  },
  autoTyping: v => {
    config.AUTO_TYPING = !!v;
  },
  autoReact: v => {
    config.AUTO_REACT = !!v;
  },
  alwaysOnline: v => {
    config.ALWAYS_ONLINE = !!v;
  },
  antilink: v => {
    config.ANTILINK = !!v;
  },
  welcome: v => {
    config.WELCOME = !!v;
  },
  goodbye: v => {
    config.GOODBYE = !!v;
  },
  autoChat: v => {
    (globalThis as any).__autoChat = !!v;
  },
  autoChatGroup: v => {
    (globalThis as any).__autoChatGroup = !!v;
  },
  autoViewOnce: v => {
    (globalThis as any).__autoVO = !!v;
  },
  antiDelete: v => {
    (globalThis as any).__antiDelete = !!v;
  },
  antiDeleteStatus: v => {
    (globalThis as any).__antiDeleteStatus = !!v;
  },
};

export function applyRuntimeSetting<K extends keyof RuntimeSettings>(
  key: K,
  value: RuntimeSettings[K]
): void {
  const apply = APPLIERS[key];
  if (!apply) {
    logger.warn({ key }, 'Unknown runtime setting ignored');
    return;
  }
  apply(value);
}

/** Apply a setting for this process and persist it for the next one. */
export function setRuntimeSetting<K extends keyof RuntimeSettings>(
  key: K,
  value: RuntimeSettings[K]
): void {
  applyRuntimeSetting(key, value);
  settingsStore.set(key, value);
  logger.info({ setting: key, value }, 'Runtime setting changed');
}

export function getStoredSettings(): RuntimeSettings {
  return settingsStore.all();
}

/** Replay everything saved by previous runs. Called once at boot. */
export function applyStoredSettings(): RuntimeSettings {
  const values = settingsStore.all();
  for (const [key, value] of Object.entries(values)) {
    applyRuntimeSetting(key as keyof RuntimeSettings, value as never);
  }
  const applied = Object.keys(values);
  if (applied.length) logger.info({ applied }, 'Restored saved settings');
  return values;
}
