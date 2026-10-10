import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
  type WASocket,
} from 'baileys';
import { EventEmitter } from 'events';
import qrcode from 'qrcode';
import config from '../config/index.js';
import logger from './logger.js';
import { serialize, decodeJid } from './serializer.js';
import { CommandRegistry } from './registry.js';
import type { BotState, SerializedMessage, CommandContext } from './types.js';

export class BotClient extends EventEmitter {
  private sock: WASocket | null = null;
  private isConnecting = false;
  private registered = false;
  private connectionState = 'close';
  private lastError: string | null = null;
  private currentQr: string | null = null;
  private qrTimestamp: number | null = null;
  private registry = new CommandRegistry();
  private antilinkChats = new Set<string>();
  private messageStore = new Map<string, any>();
  private static MAX_STORE_SIZE = 10000;
  private static MESSAGE_TTL = 48 * 60 * 60 * 1000;

  constructor() {
    super();
    this.registry.loadAll();
  }

  getState(): BotState {
    const wsOpen = (this.sock?.ws as any)?.readyState === 1 || this.connectionState === 'open';
    return {
      connected: wsOpen && this.registered,
      registered: this.registered,
      connectionState: this.connectionState,
      user: this.sock?.user?.id || null,
      lastError: this.lastError,
      qr: this.currentQr,
      uptime: process.uptime(),
      mode: config.MODE,
      prefix: config.PREFIX,
    };
  }

  isOwner(jid: string): boolean {
    const digits = (s: string) => s.replace(/\D/g, '');
    const senderDigits = digits(jid);
    if (!senderDigits) return false;

    if (config.OWNER_NUMBER) {
      const ownerDigits = digits(config.OWNER_NUMBER);
      if (senderDigits.endsWith(ownerDigits) || ownerDigits.endsWith(senderDigits)) return true;
    }

    const botDigits = digits(this.sock?.user?.id || '');
    if (botDigits && senderDigits === botDigits) return true;

    if (config.OWNERS?.length) {
      for (const o of config.OWNERS) {
        const od = digits(o);
        if (od && (senderDigits.endsWith(od) || od.endsWith(senderDigits))) return true;
      }
    }

    return false;
  }

  getQr(): string | null {
    return this.currentQr;
  }

  getQrImage(): Promise<string> | null {
    if (!this.currentQr) return null;
    return qrcode.toDataURL(this.currentQr);
  }

  async resetSession(): Promise<void> {
    logger.warn('Session reset requested');
    if (this.sock) {
      try { this.sock.end(undefined); } catch {}
      this.sock = null;
    }
    this.isConnecting = false;
    this.registered = false;
    this.connectionState = 'close';
    this.currentQr = null;
    this.lastError = null;

    const fs = await import('fs/promises');
    try { await fs.rm(config.SESSION_DIR, { recursive: true, force: true }); } catch {}
    await fs.mkdir(config.SESSION_DIR, { recursive: true }).catch(() => {});

    setTimeout(() => this.connect().catch(() => {}), 1500);
  }

  getSocket(): WASocket | null {
    return this.sock;
  }

  getRegistry(): CommandRegistry {
    return this.registry;
  }

  async connect(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(config.SESSION_DIR);
      this.registered = !!state.creds.registered;
      logger.info({ registered: this.registered }, 'Auth state loaded');

      let version: [number, number, number] | undefined;
      try {
        const latest = await Promise.race([
          fetchLatestBaileysVersion(),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
        ]);
        version = latest.version as [number, number, number];
        logger.info({ version }, 'Baileys version');
      } catch {
        logger.warn('Using bundled Baileys version');
      }

      const sock = makeWASocket({
        logger: logger.child({ module: 'baileys' }),
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        browser: Browsers.ubuntu('Chrome'),
        version,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        emitOwnEvents: true,
        syncFullHistory: false,
        markOnlineOnConnect: config.ALWAYS_ONLINE,
        qrTimeout: 0,
      });

      this.sock = sock;
      (sock as any)._botRegistry = this.registry;

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.currentQr = qr;
          this.qrTimestamp = Date.now();
          logger.info('QR code generated - available at /api/qr');
          this.emit('qr', qr);
        }

        if (connection === 'close') {
          this.connectionState = 'close';
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          this.lastError = lastDisconnect?.error?.message || `closed (code ${statusCode})`;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          logger.warn({ statusCode, shouldReconnect }, 'Connection closed');

          if (shouldReconnect) {
            setTimeout(() => {
              this.isConnecting = false;
              this.connect().catch(() => {});
            }, 5000);
          } else {
            logger.error('Logged out - session invalid, reset needed');
            this.emit('loggedOut');
          }
        } else if (connection === 'open') {
          this.connectionState = 'open';
          this.isConnecting = false;
          this.lastError = null;
          this.registered = true;
          this.currentQr = null;
          logger.info({ jid: sock.user?.id }, 'Connected to WhatsApp');
          this.emit('connected', sock.user?.id);

          if (config.ALWAYS_ONLINE) {
            await sock.sendPresenceUpdate('available').catch(() => {});
            setInterval(() => {
              sock.sendPresenceUpdate('available').catch(() => {});
            }, 30000);
          }
        }
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const raw of messages) {
          try {
            await this.handleMessage(raw);
          } catch (err) {
            logger.error({ err, key: raw.key }, 'Error handling message');
          }
        }
      });

      sock.ev.on('group-participants.update', async (update) => {
        try {
          await this.handleGroupUpdate(update);
        } catch (err) {
          logger.error({ err }, 'Error handling group update');
        }
      });

      sock.ev.on('call', async (calls) => {
        if (config.REJECT_CALL) {
          for (const call of calls) {
            try {
              await sock.rejectCall(call.chatId, call.id);
              logger.info({ from: call.chatId }, 'Rejected call');
            } catch {}
          }
        }
      });

      logger.info('WhatsApp socket initialized');
    } catch (error: any) {
      logger.error({ err: error?.message }, 'Failed to initialize connection');
      this.isConnecting = false;
      setTimeout(() => this.connect().catch(() => {}), 10000);
    }
  }

  private async handleMessage(raw: any): Promise<void> {
    if (!this.sock) return;

    if ((globalThis as any).__antiDelete) {
      this.storeMessage(raw);
      this.checkProtocolMessage(raw).catch(() => {});
    }

    const m = serialize(raw, this.sock);

    if (!m.message) return;
    if (m.key.fromMe && config.MODE === 'self') return;

    const botJid = decodeJid(this.sock.user?.id || '');
    const isCreator = this.isOwner(m.sender) || m.fromMe || m.sender === botJid;

    if (config.MODE === 'self' && !isCreator) return;

    if (config.AUTO_READ) {
      await this.sock.readMessages([m.key]).catch(() => {});
    }

    if (config.AUTO_REACT && !m.body) {
      await m.react('👍').catch(() => {});
    }

    if ((globalThis as any).__autoVO) {
      await this.handleViewOnce(m).catch(() => {});
    }

    const prefix = config.PREFIX;
    if (!m.body.startsWith(prefix)) return;

    const cmd = m.body.slice(prefix.length).split(' ')[0].toLowerCase();
    const text = m.body.slice(prefix.length + cmd.length).trim();
    const args = text.split(/\s+/).filter(Boolean);

    if (!cmd) return;

    let isAdmin = false;
    let isBotAdmin = false;

    if (m.isGroup) {
      try {
        const meta = await this.sock.groupMetadata(m.from);
        const admins = meta.participants.filter((p: any) => p.admin === 'admin' || p.admin === 'superadmin');
        const adminJids = admins.map((p: any) => p.id);
        isAdmin = adminJids.includes(m.sender);
        isBotAdmin = adminJids.includes(botJid);
      } catch {}
    }

    logger.info({ cmd, sender: m.sender, from: m.from, isGroup: m.isGroup }, 'Command received');

    const command = this.registry.find(cmd);
    if (!command) {
      await m.reply(`Unknown command: ${prefix}${cmd}\nType ${prefix}menu for available commands.`).catch(() => {});
      return;
    }

    const ctx: CommandContext = {
      m,
      sock: this.sock,
      args,
      text,
      cmd,
      prefix,
      isCreator,
      isGroup: m.isGroup,
      isAdmin,
      isBotAdmin,
      logger,
    };

    try {
      await command.execute(ctx);
    } catch (err: any) {
      logger.error({ err: err?.message, cmd }, 'Command execution failed');
      await m.reply(`Error: ${err?.message || 'Command failed'}`).catch(() => {});
    }
  }

  private storeMessage(raw: any): void {
    try {
      if (!raw.key?.id || !raw.message) return;
      if (raw.message.protocolMessage) return;

      const entry = {
        ...raw,
        _storedAt: Date.now(),
      };

      this.messageStore.set(raw.key.id, entry);

      const now = Date.now();
      for (const [key, data] of this.messageStore.entries()) {
        if (now - data._storedAt > BotClient.MESSAGE_TTL) {
          this.messageStore.delete(key);
        }
      }

      if (this.messageStore.size > BotClient.MAX_STORE_SIZE) {
        const oldestKey = Array.from(this.messageStore.keys())[0];
        this.messageStore.delete(oldestKey);
      }
    } catch (err) {
      logger.error({ err }, 'Failed to store message');
    }
  }

  private async checkProtocolMessage(raw: any): Promise<void> {
    if (!this.sock) return;

    const proto = raw.message?.protocolMessage;
    if (!proto) return;

    const isDelete =
      proto.type === 0 ||
      proto.type === 'REVOKE';

    if (!isDelete) return;

    const deletedKey = proto.key?.id;
    if (!deletedKey) return;

    const original = this.messageStore.get(deletedKey);
    if (!original) return;

    const botJid = decodeJid(this.sock.user?.id || '');
    const ownerJid = config.OWNER_NUMBER
      ? config.OWNER_NUMBER.replace(/\D/g, '') + '@s.whatsapp.net'
      : botJid;

    if (original.key?.fromMe) return;

    const sender = original.key?.participant || original.key?.remoteJid;
    const chat = original.key?.remoteJid;
    const isGroup = chat?.endsWith('@g.us');
    const deletedBy = raw.key?.participant || raw.key?.remoteJid;

    const msgBody =
      original.message?.conversation ||
      original.message?.extendedTextMessage?.text ||
      original.message?.imageMessage?.caption ||
      original.message?.videoMessage?.caption ||
      '';

    let header = `🗑️ *Anti-Delete Alert*\n\n`;
    header += `👤 *Sender:* @${(sender || '').split('@')[0]}\n`;
    header += `💬 *Chat:* ${isGroup ? 'Group' : 'Private'} (${chat})\n`;
    if (isGroup) {
      header += `🗑️ *Deleted by:* @${(deletedBy || '').split('@')[0]}\n`;
    }
    header += `⏰ *Time:* ${new Date().toLocaleString()}\n`;

    const mentions = [sender, deletedBy].filter(Boolean);

    await this.sock.sendMessage(ownerJid, {
      text: header,
      mentions,
    });

    if (msgBody) {
      await this.sock.sendMessage(ownerJid, {
        text: `📝 *Content:* ${msgBody.slice(0, 3000)}`,
        mentions: [sender],
      });
    }

    const hasMedia =
      original.message?.imageMessage ||
      original.message?.videoMessage ||
      original.message?.audioMessage ||
      original.message?.documentMessage ||
      original.message?.stickerMessage;

    if (hasMedia) {
      try {
        const { downloadMediaMessage } = await import('baileys');
        const buffer = (await downloadMediaMessage(
          original,
          'buffer',
          {},
          { logger, reuploadRequest: this.sock.updateMediaMessage }
        )) as Buffer;

        if (buffer && buffer.length > 0) {
          const isImage = !!original.message?.imageMessage;
          const isVideo = !!original.message?.videoMessage;
          const isAudio = !!original.message?.audioMessage;
          const isSticker = !!original.message?.stickerMessage;

          if (isImage) {
            await this.sock.sendMessage(ownerJid, {
              image: buffer,
              caption: '🖼️ *Deleted Image*',
              mentions: [sender],
            });
          } else if (isVideo) {
            await this.sock.sendMessage(ownerJid, {
              video: buffer,
              caption: '🎬 *Deleted Video*',
              mentions: [sender],
            });
          } else if (isAudio) {
            await this.sock.sendMessage(ownerJid, {
              audio: buffer,
              mimetype: 'audio/mpeg',
              caption: '🎤 *Deleted Voice Note*',
            });
          } else if (isSticker) {
            await this.sock.sendMessage(ownerJid, {
              sticker: buffer,
            });
          } else {
            const docName = original.message?.documentMessage?.fileName || 'document';
            const docMime = original.message?.documentMessage?.mimetype || 'application/octet-stream';
            await this.sock.sendMessage(ownerJid, {
              document: buffer,
              fileName: docName,
              mimetype: docMime,
              caption: '📄 *Deleted Document*',
              mentions: [sender],
            });
          }

          logger.info({ deletedKey, from: sender }, 'Anti-delete: media forwarded');
        }
      } catch (err: any) {
        logger.error({ err: err?.message }, 'Anti-delete: media download failed');
      }
    }

    this.messageStore.delete(deletedKey);
    logger.info({ deletedKey, from: sender, isGroup }, 'Anti-delete: message forwarded to owner');
  }

  private async handleViewOnce(m: SerializedMessage): Promise<void> {
    if (!this.sock) return;

    const msg = m.message as any;
    const voMedia =
      msg?.imageMessage?.viewOnce ||
      msg?.videoMessage?.viewOnce ||
      msg?.viewOnceMessage?.message?.imageMessage ||
      msg?.viewOnceMessage?.message?.videoMessage ||
      msg?.ephemeralMessage?.message?.imageMessage?.viewOnce ||
      msg?.ephemeralMessage?.message?.videoMessage?.viewOnce;

    if (!voMedia && !msg?.viewOnceMessage && !msg?.viewOnceMessageV2Extension) return;

    try {
      const { downloadMediaMessage } = await import('baileys');
      const buffer = (await downloadMediaMessage(
        m as any,
        'buffer',
        {},
        { logger, reuploadRequest: this.sock.updateMediaMessage }
      )) as Buffer;

      if (!buffer || buffer.length === 0) return;

      const isVideo = !!(
        msg?.videoMessage ||
        msg?.viewOnceMessage?.message?.videoMessage
      );

      const caption = `🔓 *Auto-saved View Once!*\n\n👤 From: @${m.sender.split('@')[0]}`;

      if (isVideo) {
        await this.sock.sendMessage(m.from, {
          video: buffer,
          mimetype: 'video/mp4',
          caption,
          mentions: [m.sender],
        });
      } else {
        await this.sock.sendMessage(m.from, {
          image: buffer,
          mimetype: 'image/jpeg',
          caption,
          mentions: [m.sender],
        });
      }

      logger.info({ from: m.sender, type: isVideo ? 'video' : 'image' }, 'Auto-saved view once media');
    } catch (err: any) {
      logger.error({ err: err?.message }, 'Auto view once save failed');
    }
  }

  private async handleGroupUpdate(update: any): Promise<void> {
    if (!this.sock || !config.WELCOME) return;
    const { id, participants, action } = update;
    if (action !== 'add' && action !== 'remove') return;

    for (const participant of participants) {
      const tag = `@${participant.split('@')[0]}`;
      const text = action === 'add'
        ? `Welcome ${tag} to the group! 🎉`
        : `Goodbye ${tag}! 👋`;
      await this.sock.sendMessage(id, { text, mentions: [participant] }).catch(() => {});
    }
  }
}
