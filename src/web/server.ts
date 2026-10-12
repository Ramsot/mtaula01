import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import config from '../config/index.js';
import logger from '../core/logger.js';
import type { BotClient } from '../core/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createWebServer(bot: BotClient): express.Application {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.resolve(__dirname, '..', '..', 'public')));

  /**
   * Guard destructive/admin endpoints. If ADMIN_TOKEN is set, callers must
   * send it (Authorization: Bearer or ?token=). If it is NOT set, only
   * loopback requests are allowed — never expose session reset publicly.
   */
  const requireAdmin: express.RequestHandler = (req, res, next) => {
    const provided =
      (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
      (req.query.token as string) ||
      '';

    if (config.ADMIN_TOKEN) {
      if (provided !== config.ADMIN_TOKEN) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      return next();
    }

    const ip = req.ip || req.socket?.remoteAddress || '';
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (isLoopback) return next();

    res.status(403).json({
      success: false,
      error: 'Forbidden: set ADMIN_TOKEN to call this endpoint remotely',
    });
  };

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', bot: config.BOT_NAME, uptime: process.uptime() });
  });

  app.get('/', (_req, res) => {
    res.json({ name: config.BOT_NAME, version: '2.0.0', status: 'running' });
  });

  app.get('/pair', (_req, res) => {
    res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'pair.html'));
  });

  app.get('/api/status', (_req, res) => {
    res.json(bot.getState());
  });

  app.get('/api/qr', async (_req, res) => {
    const qr = bot.getQr();
    if (!qr) {
      res.status(404).json({ success: false, error: 'No QR available - bot may already be connected' });
      return;
    }
    try {
      const image = await bot.getQrImage();
      res.setHeader('Content-Type', 'image/png');
      res.send(Buffer.from(image!.split(',')[1], 'base64'));
    } catch {
      res.status(500).json({ success: false, error: 'Failed to generate QR image' });
    }
  });

  app.post('/api/reset', requireAdmin, async (_req, res) => {
    try {
      res.json({ success: true, message: 'Session cleared' });
      await bot.resetSession();
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  app.get('/api/session/export', requireAdmin, async (_req, res) => {
    try {
      const dir = config.SESSION_DIR;
      const files = await fs.readdir(dir).catch(() => []);
      const session: Record<string, string> = {};
      for (const f of files) {
        if (f.endsWith('.json')) {
          const content = await fs.readFile(path.join(dir, f), 'utf-8');
          session[f] = content;
        }
      }
      if (Object.keys(session).length === 0) {
        res.status(404).json({ success: false, error: 'No session files found' });
        return;
      }
      res.json({ success: true, session });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  app.post('/api/session/import', requireAdmin, async (req, res) => {
    try {
      const { session } = req.body;
      if (!session || typeof session !== 'object') {
        res.status(400).json({ success: false, error: 'Session data required' });
        return;
      }
      const dir = config.SESSION_DIR;
      await fs.mkdir(dir, { recursive: true });
      for (const [f, content] of Object.entries(session)) {
        if (f.endsWith('.json') && typeof content === 'string') {
          await fs.writeFile(path.join(dir, f), content);
        }
      }
      res.json({ success: true, message: 'Session imported. Restart bot to use it.' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  // Pairing stays public (the /pair page needs it) but is only usable while
  // the bot is unregistered, and is rate-limited to slow brute-force abuse.
  const pairAttempts = new Map<string, { count: number; resetAt: number }>();
  const pairingLimiter: express.RequestHandler = (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const entry = pairAttempts.get(ip);
    if (!entry || now > entry.resetAt) {
      pairAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    if (entry.count >= 5) {
      res.status(429).json({ success: false, error: 'Too many attempts, try again in a minute' });
      return;
    }
    entry.count++;
    next();
  };

  app.post('/api/pair', pairingLimiter, async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber) {
        res.status(400).json({ success: false, error: 'Phone number required' });
        return;
      }

      const state = bot.getState();
      if (state.registered) {
        res.status(409).json({
          success: false,
          error: 'Bot already linked. Unlink from WhatsApp > Linked Devices or reset session.',
        });
        return;
      }

      const clean = phoneNumber.replace(/\D/g, '');
      if (clean.length < 10 || clean.length > 15) {
        res.status(400).json({ success: false, error: 'Invalid phone number' });
        return;
      }

      const sock = bot.getSocket();
      if (!sock) {
        res.status(503).json({ success: false, retryable: true, error: 'Socket not ready' });
        return;
      }

      const code = await sock.requestPairingCode(clean);
      res.json({ success: true, pairingCode: code });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  return app;
}
