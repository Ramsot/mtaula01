import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';
import { makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore, Browsers, fetchLatestBaileysVersion } from '@whiskeysockets/baileys';
import config from './config.js';
import { Handler } from './data/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = pino({ level: config.DEBUG_MODE ? 'debug' : 'info' });
const app = express();
const PORT = process.env.PORT || 3000;

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

app.post('/api/pair', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({ success: false, error: 'Phone number required' });
    }
    
    if (!sock || sock.ws?.readyState !== 1) {
      return res.status(503).json({ success: false, error: 'Bot not connected' });
    }
    
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    
    if (cleanNumber.length < 10 || cleanNumber.length > 15) {
      return res.status(400).json({ success: false, error: 'Invalid phone number format' });
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
  res.json({
    connected: sock?.ws?.readyState === 1,
    user: sock?.user?.id || null,
    uptime: process.uptime()
  });
});

let sock = null;
let isConnecting = false;

async function connectToWhatsApp() {
  if (isConnecting) return;
  isConnecting = true;

  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_baileys');
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info({ version, isLatest }, 'Baileys version');

    sock = makeWASocket({
      logger: logger.child({ module: 'baileys' }),
      printQRInTerminal: true,
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
        logger.info('QR Code generated - scan with WhatsApp');
        console.log('\n📱 Scan this QR code with WhatsApp > Linked Devices > Link a Device\n');
      }
      
      if (pairingCode) {
        logger.info({ pairingCode }, 'Pairing code generated');
        console.log('\n🔐 Pairing Code:', pairingCode);
        console.log('Enter this code in WhatsApp > Settings > Linked Devices > Link with Phone Number\n');
      }

      if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
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
        logger.info({ jid: sock.user?.id }, 'Connected to WhatsApp');
        isConnecting = false;
        
        if (config.ALWAYS_ONLINE) {
          await sock.sendPresenceUpdate('available');
          setInterval(() => {
            sock.sendPresenceUpdate('available').catch(() => {});
          }, 30000);
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type === 'notify') {
        for (const msg of messages) {
          try {
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
  
  if (sock) {
    try {
      await sock.logout();
      logger.info('Logged out from WhatsApp');
    } catch (err) {
      logger.error({ err }, 'Error during logout');
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