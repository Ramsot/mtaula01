import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

let tmpDir: string;
let useResilientAuthState: typeof import('../src/core/auth-state.js').useResilientAuthState;
let classifyDisconnect: typeof import('../src/core/reconnect.js').classifyDisconnect;
let DisconnectReason: typeof import('baileys').DisconnectReason;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mtaula-resilience-'));
  process.env.SESSION_DIR = path.join(tmpDir, 'session');
  process.env.DATA_DIR = path.join(tmpDir, 'data');

  ({ useResilientAuthState } = await import('../src/core/auth-state.js'));
  ({ classifyDisconnect } = await import('../src/core/reconnect.js'));
  ({ DisconnectReason } = await import('baileys'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const CREDS = JSON.stringify({ registered: true, me: { id: '254712345678:1@s.whatsapp.net' } });

describe('resilient auth state', () => {
  it('restores a corrupt creds.json from the backup instead of a blank session', async () => {
    const dir = path.join(tmpDir, 'corrupt');
    await fs.mkdir(dir, { recursive: true });
    // Truncated file — exactly what a crash / container freeze mid-write leaves.
    await fs.writeFile(path.join(dir, 'creds.json'), '{"registered":true,"me":{');
    await fs.writeFile(path.join(dir, 'creds.json.backup'), CREDS);

    const { state } = await useResilientAuthState(dir);

    expect(state.creds.registered).toBe(true);
    expect((state.creds as any).me?.id).toBe('254712345678:1@s.whatsapp.net');
    // The live file is repaired, not left corrupt.
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, 'creds.json'), 'utf-8'));
    expect(onDisk.registered).toBe(true);
  });

  it('restores a missing creds.json from the backup', async () => {
    const dir = path.join(tmpDir, 'missing');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'creds.json.backup'), CREDS);

    const { state } = await useResilientAuthState(dir);
    expect(state.creds.registered).toBe(true);
  });

  it('seeds a backup on first run so the next crash is recoverable', async () => {
    const dir = path.join(tmpDir, 'seed');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'creds.json'), CREDS);

    await useResilientAuthState(dir);
    const backup = JSON.parse(await fs.readFile(path.join(dir, 'creds.json.backup'), 'utf-8'));
    expect(backup.registered).toBe(true);
  });

  it('writes creds atomically and keeps the backup in sync', async () => {
    const dir = path.join(tmpDir, 'save');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'creds.json'), CREDS);

    const { state, saveCreds } = await useResilientAuthState(dir);
    (state.creds as any).me = { id: '254700000000:2@s.whatsapp.net' };
    await saveCreds();

    const live = JSON.parse(await fs.readFile(path.join(dir, 'creds.json'), 'utf-8'));
    const backup = JSON.parse(await fs.readFile(path.join(dir, 'creds.json.backup'), 'utf-8'));
    expect(live.me.id).toBe('254700000000:2@s.whatsapp.net');
    expect(backup.me.id).toBe('254700000000:2@s.whatsapp.net');
    // No temp files left behind.
    const leftovers = (await fs.readdir(dir)).filter(f => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('does not crash with neither creds nor backup (falls back to a blank state)', async () => {
    const dir = path.join(tmpDir, 'empty');
    const { state } = await useResilientAuthState(dir);
    expect(state.creds.registered).toBeFalsy();
  });
});

describe('disconnect classification', () => {
  it('treats only 401/411 as a real logout (re-pair)', () => {
    expect(classifyDisconnect(DisconnectReason.loggedOut, 0).action).toBe('logout');
    expect(classifyDisconnect(DisconnectReason.multideviceMismatch, 0).action).toBe('logout');
  });

  it('reconnects immediately and resets the backoff for 515/440/428', () => {
    for (const code of [
      DisconnectReason.restartRequired,
      DisconnectReason.connectionReplaced,
      DisconnectReason.connectionClosed,
    ]) {
      const d = classifyDisconnect(code, 5);
      expect(d.action).toBe('reconnect');
      if (d.action === 'reconnect') {
        expect(d.delayMs).toBe(2000);
        expect(d.resetBackoff).toBe(true);
      }
    }
  });

  it('grows the backoff on unknown drops and caps it', () => {
    const first = classifyDisconnect(undefined, 0);
    const third = classifyDisconnect(undefined, 3);
    const huge = classifyDisconnect(undefined, 99);
    expect(first.action).toBe('reconnect');
    expect(third.action).toBe('reconnect');
    expect(huge.action).toBe('reconnect');
    if (first.action === 'reconnect' && third.action === 'reconnect' && huge.action === 'reconnect') {
      expect(third.delayMs).toBeGreaterThan(first.delayMs);
      expect(huge.delayMs).toBe(60_000);
    }
  });

  it('retries steadily while waiting for a QR scan', () => {
    const d = classifyDisconnect(undefined, 0, true);
    expect(d.action).toBe('reconnect');
    if (d.action === 'reconnect') expect(d.delayMs).toBe(5000);
  });

  it('backs off hard on 403 (forbidden) without wiping the session', () => {
    const d = classifyDisconnect(DisconnectReason.forbidden, 0);
    expect(d.action).toBe('reconnect');
    if (d.action === 'reconnect') {
      expect(d.delayMs).toBe(30_000);
      expect(d.resetBackoff).toBe(false);
    }
  });
});
