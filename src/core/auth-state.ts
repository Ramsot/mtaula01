import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { BufferJSON, useMultiFileAuthState } from 'baileys';
import logger from './logger.js';

/**
 * Robust replacement for Baileys' `useMultiFileAuthState`.
 *
 * The bot kept "logging out" and forcing a re-pair because `creds.json` is the
 * single point of failure for the whole session:
 *
 *  - Baileys writes it with a plain `fs.writeFile`, so a crash / SIGKILL /
 *    container freeze (Render's free tier spins the process down) that lands
 *    mid-write leaves a truncated file.
 *  - On the next boot `useMultiFileAuthState` swallows the parse error and
 *    silently returns `initAuthCreds()` — a *blank, unregistered* state — so the
 *    bot decides it was never paired and shows a QR again.
 *
 * This version makes writes atomic (tmp file + rename) and keeps a last-known
 * good `creds.json.backup`, which it restores automatically when the live file
 * is missing or corrupt. The session therefore survives abrupt shutdowns and
 * redeploys without a re-pair.
 */

const CREDS_FILE = 'creds.json';
const BACKUP_FILE = 'creds.json.backup';

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** A file is usable only if it exists AND parses as JSON. */
async function isValidJson(file: string): Promise<boolean> {
  try {
    JSON.parse(await fs.readFile(file, 'utf-8'));
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(file: string, data: string): Promise<void> {
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tmp, data);
  try {
    // rename is atomic within a filesystem: readers see either the old file or
    // the complete new one, never a half-written one.
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

export type ResilientAuthState = Awaited<ReturnType<typeof useMultiFileAuthState>>;

export async function useResilientAuthState(folder: string): Promise<ResilientAuthState> {
  await fs.mkdir(folder, { recursive: true });

  const credsPath = path.join(folder, CREDS_FILE);
  const backupPath = path.join(folder, BACKUP_FILE);

  const credsOk = await isValidJson(credsPath);
  const backupOk = await isValidJson(backupPath);

  if (!credsOk && backupOk) {
    await fs.copyFile(backupPath, credsPath);
    logger.warn({ folder }, 'creds.json was missing or corrupt - restored the last good backup');
  } else if (credsOk && !backupOk) {
    // First run after upgrading: seed the backup so the very next crash is safe.
    await fs.copyFile(credsPath, backupPath).catch(() => {});
  } else if (!credsOk && (await fileExists(credsPath))) {
    logger.error(
      { folder },
      'creds.json is corrupt and no backup is available - a re-pair will be required'
    );
  }

  const { state, saveCreds } = await useMultiFileAuthState(folder);

  // Serialize writes: Baileys emits overlapping `creds.update` events, and two
  // concurrent persists could otherwise interleave and leave an older snapshot
  // on disk than the one already written.
  let writeQueue: Promise<void> = Promise.resolve();

  const persistOnce = async (): Promise<void> => {
    const data = JSON.stringify(state.creds, BufferJSON.replacer);
    await atomicWrite(credsPath, data);
    await fs.copyFile(credsPath, backupPath).catch(() => {});
  };

  const persistSafe = (): Promise<void> => {
    writeQueue = writeQueue.then(persistOnce, persistOnce);
    return writeQueue;
  };

  return { state, saveCreds: persistSafe };
}
