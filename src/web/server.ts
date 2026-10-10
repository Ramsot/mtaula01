import express from 'express';
import path from 'path';
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

  app.post('/api/reset', async (_req, res) => {
    try {
      res.json({ success: true, message: 'Session cleared' });
      await bot.resetSession();
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  app.post('/api/pair', async (req, res) => {
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
