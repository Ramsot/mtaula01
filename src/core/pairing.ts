import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import config from '../config/index.js';
import logger from './logger.js';

/**
 * Persistent device pairing.
 *
 * A pairing is a long-lived credential that links one browser/device to an
 * admin account. It is stored on disk (in DATA_DIR, which lives on the
 * persistent Render Disk) so redeploys and restarts do NOT invalidate it - a
 * previously paired device keeps working without scanning a new QR code.
 *
 * Flow:
 *   1. Admin creates a user (or clicks "Generate QR") -> createPairing() emits a
 *      unique secret token and a QR that encodes `<origin>/?pair=<token>`.
 *   2. The device opens/scan the QR, the page calls claimPairing() once
 *      (recording device name / IP / user-agent), and stores the token.
 *   3. Every later request authenticates with that same token; verifyPairing()
 *      checks the on-disk record so nothing needs re-pairing after an update.
 */

export interface Pairing {
  id: string;
  userId: string;
  username: string;
  deviceName: string;
  token: string;
  phone: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: number;
  pairedAt: number | null;
  lastSeen: number | null;
  revokedAt: number | null;
  active: boolean;
}

const MAX_PAIRINGS = 500;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function pairingsFilePath(): string {
  return path.join(config.DATA_DIR, 'pairings.json');
}

async function persist(pairings: Pairing[]): Promise<void> {
  await fs.mkdir(config.DATA_DIR, { recursive: true });
  const file = pairingsFilePath();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(pairings, null, 2));
  await fs.rename(tmp, file);
}

export class PairingStore {
  private pairings: Pairing[] = [];
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(pairingsFilePath(), 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.pairings = parsed.filter(p => p && typeof p.token === 'string');
      }
    } catch {
      this.pairings = [];
    }
    this.loaded = true;
    logger.info({ count: this.pairings.filter(p => p.active).length }, 'Pairing store loaded');
  }

  private async save(): Promise<void> {
    if (this.pairings.length > MAX_PAIRINGS) {
      this.pairings = this.pairings.slice(-MAX_PAIRINGS);
    }
    await persist(this.pairings);
  }

  async createPairing(
    userId: string,
    username: string,
    deviceName = 'New device'
  ): Promise<Pairing> {
    const pairing: Pairing = {
      id: crypto.randomBytes(8).toString('hex'),
      userId,
      username,
      deviceName: deviceName.trim() || 'New device',
      token: crypto.randomBytes(24).toString('hex'),
      phone: null,
      ip: null,
      userAgent: null,
      createdAt: Date.now(),
      pairedAt: null,
      lastSeen: null,
      revokedAt: null,
      active: true,
    };
    this.pairings.push(pairing);
    await this.save();
    return pairing;
  }

  /** Validate a device token. Returns the pairing record when still valid. */
  verifyPairing(token: string): Pairing | null {
    if (!token) return null;
    const pairing = this.pairings.find(p => p.token === token);
    if (!pairing) return null;
    if (!pairing.active || pairing.revokedAt) return null;

    const now = Date.now();
    if (!pairing.lastSeen || now - pairing.lastSeen > TOUCH_INTERVAL_MS) {
      pairing.lastSeen = now;
      void this.save().catch(() => {});
    }
    return pairing;
  }

  /** First scan of the QR - records who the device is. Idempotent. */
  async claimPairing(
    token: string,
    info: { deviceName?: string; phone?: string; ip?: string; userAgent?: string } = {}
  ): Promise<Pairing | null> {
    const pairing = this.pairings.find(p => p.token === token);
    if (!pairing || !pairing.active || pairing.revokedAt) return null;

    if (info.deviceName?.trim()) pairing.deviceName = info.deviceName.trim().slice(0, 80);
    if (info.phone) pairing.phone = info.phone.replace(/\D/g, '') || null;
    if (info.ip) pairing.ip = info.ip;
    if (info.userAgent) pairing.userAgent = info.userAgent.slice(0, 200);
    pairing.pairedAt = pairing.pairedAt || Date.now();
    pairing.lastSeen = Date.now();
    await this.save();
    return pairing;
  }

  getById(id: string): Pairing | undefined {
    return this.pairings.find(p => p.id === id);
  }

  listPairings(): Pairing[] {
    return [...this.pairings].sort((a, b) => b.createdAt - a.createdAt);
  }

  listForUser(userId: string): Pairing[] {
    return this.pairings.filter(p => p.userId === userId);
  }

  async revokePairing(id: string): Promise<boolean> {
    const pairing = this.pairings.find(p => p.id === id);
    if (!pairing) return false;
    pairing.active = false;
    pairing.revokedAt = Date.now();
    await this.save();
    return true;
  }

  /** Called when an admin deletes a user so their devices lose access too. */
  async removeForUser(userId: string): Promise<number> {
    const before = this.pairings.length;
    this.pairings = this.pairings.filter(p => p.userId !== userId);
    const removed = before - this.pairings.length;
    if (removed > 0) await this.save();
    return removed;
  }
}

export const pairingStore = new PairingStore();
