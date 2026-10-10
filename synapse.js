import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import qrcode from 'qrcode';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import config from './config.js';
import { Handler } from './data/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: config.DEBUG_MODE ? 'debug' : 'info' });
const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_DIR = process.env.AUTH_DIR || './auth_info_baileys';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    bot: 'Mtaula 01', 
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({ 
    name: 'Mtaula 01', 
    version: '10.8.1',
    status: 'running',
    description: 'WhatsApp Bot - Mtaula 01'
  });
});

app.get('/pair', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'pair.html'));
});

app.get('/api/qr', async (req, res) => {
  if (!currentQr) {
    return res.status(404).json({ success: false, error: 'No QR code available - bot may already be connected' });
  }
  const format = req.query.format || 'json';
  if (format === 'image') {
    try {
      const img = await qrcode.toDataURL(currentQr);
      res.setHeader('Content-Type', 'image/png');
      res.send(Buffer.from(img.split(',')[1], 'base64'));
    } catch (e) {
      res.status(500).json({ success: false, error: 'Failed to generate QR image' });
    }
  } else {
    res.json({ success: true, qr: currentQr, timestamp: qrTimestamp });
  }
});

app.post('/api/pair', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: 'Phone number required' });
    }
    
    if (registered) {
      return res.status(409).json({
        success: false,
        error: 'Bot is already linked to a WhatsApp account. Unlink it from WhatsApp > Linked Devices or clear the session before pairing again.'
      });
    }
    
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
      return res.status(400).json({ success: false, error: 'Invalid phone number format' });
    }

    if (!sock && !isConnecting) {
      connectToWhatsApp().catch(() => {});
    }

    const opened = await waitForSocketOpen(20000);
    if (!opened) {
      logger.warn({ registered, lastConnectionError }, 'Pairing requested but WhatsApp socket is not open');
      return res.status(503).json({
        success: false,
        retryable: true,
        error: `WhatsApp connection not ready${lastConnectionError ? ` (${lastConnectionError})` : ''} - check the server logs and try again`
      });
    }
    
    const code = await sock.requestPairingCode(cleanNumber);
    
    logger.info({ phoneNumber: cleanNumber, pairingCode: code }, 'Pairing code generated via web');
    
    res.json({ 
      success: true, 
      pairingCode: code,
      message: 'Enter this code in WhatsApp > Settings > Linked Devices > Link with Phone Number'
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to generate pairing code');
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/status', (req, res) => {
  const wsOpen = sock?.ws?.readyState === 1 || connectionState === 'open';
  const state = wsOpen ? (registered ? 'connected' : 'waiting_for_pairing') : (registered ? 'reconnecting' : 'connecting');
  res.json({
    connected: wsOpen && registered,
    state,
    registered,
    lastError: lastConnectionError,
    user: sock?.user?.id || null,
    mode: config.MODE,
    uptime: process.uptime()
  });
});

let sock = null;
let isConnecting = false;
let registered = false;
let connectionState = 'close';
let lastConnectionError = null;
let currentQr = null;
let qrTimestamp = null;

function waitForSocketOpen(timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (sock?.ws?.readyState === 1) return resolve(true);
    const started = Date.now();
    const timer = setInterval(() => {
      if (sock?.ws?.readyState === 1) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 300);
  });
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function connectToWhatsApp() {
  if (isConnecting) return;
  isConnecting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    registered = !!state.creds.registered;
    logger.info({ authDir: AUTH_DIR, registered }, 'Auth state loaded');

    let version;
    try {
      const latest = await withTimeout(fetchLatestBaileysVersion(), 10000, 'fetchLatestBaileysVersion');
      version = latest.version;
      logger.info({ version, isLatest: latest.isLatest }, 'Baileys version');
    } catch (err) {
      logger.warn({ err: err?.message }, 'Could not fetch latest Baileys version - using bundled default');
    }

    sock = makeWASocket({
      logger: logger.child({ module: 'baileys' }),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      browser: Browsers.ubuntu('Chrome'),
      version,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
      emitOwnEvents: true,
      syncFullHistory: false,
      markOnlineOnConnect: config.ALWAYS_ONLINE,
      qrTimeout: 0
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, pairingCode } = update;
      
      if (qr) {
        currentQr = qr;
        qrTimestamp = Date.now();
        logger.info('QR Code generated - available at /api/qr');
      } else if (currentQr && connection === 'open') {
        currentQr = null;
        qrTimestamp = null;
      }
      
      if (pairingCode) {
        logger.info({ pairingCode }, 'Pairing code generated');
        console.log('\n🔐 Pairing Code:', pairingCode);
        console.log('Enter this code in WhatsApp > Settings > Linked Devices > Link with Phone Number\n');
      }

      if (connection === 'close') {
        connectionState = 'close';
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        lastConnectionError = lastDisconnect?.error?.message || `closed (code ${statusCode})`;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        logger.warn({ lastDisconnect, shouldReconnect }, 'Connection closed');
        
        if (shouldReconnect) {
          setTimeout(() => {
            isConnecting = false;
            connectToWhatsApp();
          }, 5000);
        } else {
          logger.error('Logged out - please delete auth_info_baileys and restart');
          process.exit(1);
        }
      } else if (connection === 'open') {
        connectionState = 'open';
        logger.info({ jid: sock.user?.id }, 'Connected to WhatsApp');
        isConnecting = false;
        lastConnectionError = null;
        registered = true;
        sock.public = config.MODE !== 'self';
        
        if (config.ALWAYS_ONLINE) {
          await sock.sendPresenceUpdate('available');
          setInterval(() => {
            sock.sendPresenceUpdate('available').catch(() => {});
          }, 30000);
        }
      }
    });

    sock.ev.on('creds.update', (update) => {
      if (typeof update.registered === 'boolean') registered = update.registered;
      saveCreds(update);
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type === 'notify') {
        for (const msg of messages) {
          try {
            const preview = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || '';
            logger.info({ from: msg.key.remoteJid, fromMe: msg.key.fromMe, type: Object.keys(msg.message || {})[0] }, `Message received: ${preview.slice(0, 80)}`);
            await Handler({ type: 'notify', messages: [msg] }, sock, logger);
          } catch (err) {
            logger.error({ err, msg: msg.key }, 'Error handling message');
          }
        }
      }
    });

    sock.ev.on('call', async (call) => {
      try {
        const { Callupdate } = await import('./data/index.js');
        await Callupdate(call, sock);
      } catch (err) {
        logger.error({ err }, 'Error handling call');
      }
    });

    sock.ev.on('groups.update', async (updates) => {
      for (const update of updates) {
        try {
          const { GroupUpdate } = await import('./data/index.js');
          await GroupUpdate(sock, update);
        } catch (err) {
          logger.error({ err, update }, 'Error handling group update');
        }
      }
    });

    sock.ev.on('chats.update', async (updates) => {
      // Chat updates (archive, mute, etc.)
    });

    sock.ev.on('contacts.update', async (updates) => {
      // Contact updates
    });

    sock.ev.on('presence.update', async ({ id, presences }) => {
      // Presence updates
    });

    sock.ev.on('message-receipt.update', async (updates) => {
      // Message receipt updates
    });

    sock.ev.on('messages.delete', async ({ keys }) => {
      // Handle message deletes for anti-delete feature
    });

    logger.info('WhatsApp socket initialized');

  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize WhatsApp connection');
    isConnecting = false;
    setTimeout(connectToWhatsApp, 10000);
  }
}

async function startServer() {
  app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT }, `HTTP server listening on port ${PORT}`);
  });

  await connectToWhatsApp();
}

async function gracefulShutdown(signal) {
  logger.info({ signal }, 'Shutting down gracefully...');
  
  // Never call sock.logout() here: on Render/Docker every deploy sends SIGTERM,
  // and logging out revokes the WhatsApp session, forcing a full re-pair.
  if (sock) {
    try {
      sock.end?.(undefined);
      logger.info('WhatsApp socket closed (session kept)');
    } catch (err) {
      logger.error({ err }, 'Error closing WhatsApp socket');
    }
  }
  
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});

startServer().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});

export { sock };