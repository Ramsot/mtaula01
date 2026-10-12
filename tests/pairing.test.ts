import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';

// Point DATA_DIR at a throwaway directory BEFORE importing config (it reads
// env at import time), then use dynamic imports so ordering is guaranteed.
let tmpDir: string;
let PairingStore: typeof import('../src/core/pairing.js').PairingStore;
let AdminStore: typeof import('../src/core/admin.js').AdminStore;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mtaula-pairing-'));
  process.env.DATA_DIR = tmpDir;
  process.env.SESSION_DIR = path.join(tmpDir, 'session');
  delete process.env.ADMIN_TOKEN;

  ({ PairingStore } = await import('../src/core/pairing.js'));
  ({ AdminStore } = await import('../src/core/admin.js'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('persistent device pairing', () => {
  it('creates a unique token and verifies it', async () => {
    const store = new PairingStore();
    await store.load();

    const p1 = await store.createPairing('u1', 'alice', 'PC');
    const p2 = await store.createPairing('u1', 'alice', 'Phone');

    expect(p1.token).not.toBe(p2.token);
    expect(store.verifyPairing(p1.token)?.id).toBe(p1.id);
    expect(store.verifyPairing('nope')).toBeNull();
  });

  it('claims a pairing once and records device info', async () => {
    const store = new PairingStore();
    await store.load();
    const p = await store.createPairing('u2', 'bob', 'New device');

    expect(p.pairedAt).toBeNull();
    const claimed = await store.claimPairing(p.token, { deviceName: 'Office PC', ip: '1.2.3.4' });
    expect(claimed?.deviceName).toBe('Office PC');
    expect(claimed?.pairedAt).toBeGreaterThan(0);

    // Idempotent: claiming again keeps the same token.
    const again = await store.claimPairing(p.token, { deviceName: 'Renamed' });
    expect(again?.token).toBe(p.token);
    expect(again?.deviceName).toBe('Renamed');
  });

  it('SURVIVES A RESTART - a new store instance still validates the token', async () => {
    const first = new PairingStore();
    await first.load();
    const p = await first.createPairing('u3', 'carol', 'Laptop');

    // Simulate a redeploy: brand-new instance reading the same DATA_DIR.
    const second = new PairingStore();
    await second.load();

    const restored = second.verifyPairing(p.token);
    expect(restored, 'pairing must persist across restart').toBeTruthy();
    expect(restored?.userId).toBe('u3');
  });

  it('revoked pairings stop verifying and are removed with the user', async () => {
    const store = new PairingStore();
    await store.load();
    const p = await store.createPairing('u4', 'dave', 'Tablet');

    expect(await store.revokePairing(p.id)).toBe(true);
    expect(store.verifyPairing(p.token)).toBeNull();
    expect(await store.claimPairing(p.token)).toBeNull();

    const p2 = await store.createPairing('u5', 'erin', 'Phone');
    const p3 = await store.createPairing('u5', 'erin', 'Watch');
    expect(await store.removeForUser('u5')).toBe(2);
    expect(store.verifyPairing(p2.token)).toBeNull();
    expect(store.verifyPairing(p3.token)).toBeNull();
  });
});

describe('admin store auth', () => {
  it('bootstraps an admin and validates credentials', async () => {
    const store = new AdminStore();
    await store.load();

    expect(store.findByUsername('admin')?.role).toBe('admin');
    expect(await store.authenticate('admin', 'wrong-password')).toBeNull();

    const result = await store.authenticate('admin', 'admin123');
    expect(result).not.toBeNull();
    expect(store.validateToken(result!.token)?.username).toBe('admin');
    expect(store.validateToken('bogus')).toBeNull();
  });

  it('persists login tokens across a restart', async () => {
    const store = new AdminStore();
    await store.load();
    const { token } = (await store.authenticate('admin', 'admin123'))!;

    const rebooted = new AdminStore();
    await rebooted.load();
    expect(rebooted.validateToken(token)?.username).toBe('admin');
  });

  it('creates users with role-derived permissions and enforces role validity', async () => {
    const store = new AdminStore();
    await store.load();

    const viewer = await store.createUser('viewer1', 'secret123', 'viewer', 'admin');
    expect(viewer.permissions).toEqual(['view']);

    await expect(store.createUser('viewer1', 'secret123', 'viewer', 'admin')).rejects.toThrow(/exists/i);
    await expect(store.createUser('bad', 'secret123', 'nope' as any, 'admin')).rejects.toThrow(/role/i);
    await expect(store.createUser('shortpw', '123', 'viewer', 'admin')).rejects.toThrow(/6\+/);
  });

  it('never deletes or demotes the last active admin', async () => {
    const store = new AdminStore();
    await store.load();

    await expect(store.deleteUser('admin')).rejects.toThrow(/last admin/i);
    await expect(store.updateUser('admin', { role: 'viewer' })).rejects.toThrow(/last admin/i);
    await expect(store.updateUser('admin', { active: false })).rejects.toThrow(/last admin/i);
  });

  it('granting a second admin then allows deleting the first', async () => {
    const store = new AdminStore();
    await store.load();
    const second = await store.createUser('admin2', 'secret123', 'admin', 'admin');

    expect(await store.deleteUser('admin')).toBe(true);
    expect(store.getUser('admin')).toBeUndefined();
    expect(store.getUser(second.id)?.role).toBe('admin');
  });
});
