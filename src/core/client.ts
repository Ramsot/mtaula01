import {
  makeWASocket,
  makeCacheableSignalKeyStore,
  Browsers,
  fetchLatestBaileysVersion,
  type WASocket,
} from 'baileys';
import { EventEmitter } from 'events';
import fs from 'fs/promises';
import qrcode from 'qrcode';
import config from '../config/index.js';
import logger from './logger.js';
import { serialize, decodeJid } from './serializer.js';
import { CommandRegistry } from './registry.js';
import { askAI, type ChatTurn } from './ai.js';
import { useResilientAuthState } from './auth-state.js';
import { classifyDisconnect } from './reconnect.js';
import { MessageCache } from './message-cache.js';
import { CommandCooldown } from './cooldown.js';
import { RecentIds } from './dedupe.js';
import { formatLocal } from './time.js';
import { metrics, ledger } from './storage.js';
import NodeCache from 'node-cache';
import type { BotState, SerializedMessage, CommandContext } from './types.js';

/** How long a socket may stay silent before the watchdog forces a reconnect. */
const WATCHDOG_INTERVAL_MS = 60_000;
const WATCHDOG_STUCK_MS = 3 * 60_000;
/** Group metadata changes rarely; cache it so a busy group cannot hammer WhatsApp. */
const GROUP_META_TTL_S = 300;
/** Commands replayed from the offline backlog are processed a few at a time. */
const BACKLOG_MAX_PER_BATCH = 5;
/** Group invite links posted by non-admins (anti-link). */
const INVITE_LINK_RE = /chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,})/;
/** Commands that cost money / take long, so they get their own cooldown. */
const EXPENSIVE_COMMANDS = new Set(['ai', 'img', 'imagine', 'draw', 'stt', 'transcribe', 'summarize', 'summary']);

export class BotClient extends EventEmitter {
  private sock: WASocket | null = null;
  private isConnecting = false;
  private registered = false;
  private reconnectAttempts = 0;
  private connectionState = 'close';
  private lastError: string | null = null;
  private currentQr: string | null = null;
  private qrTimestamp: number | null = null;
  private lastTransitionAt = Date.now();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  private watchdogRunning = false;
  private logoutRecoveryRunning = false;
  private registry = new CommandRegistry();
  private messageCache = new MessageCache();
  private cooldown = new CommandCooldown();
  private recentIds = new RecentIds();
  private groupMetaCache = new NodeCache({ stdTTL: GROUP_META_TTL_S, useClones: false });
  private chatHistories = new Map<string, Array<{ role: string; content: string }>>();
  private static MAX_HISTORY = 30;
  private ready: Promise<void>;

  constructor() {
    super();
    // Kick off command loading immediately, but keep the promise so message
    // handling can await it (previously commands could be missing on early msgs).
    this.ready = this.registry.loadAll();
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

  /**
   * Owner check. Numbers are compared as full digit strings (device suffix
   * stripped) — never via endsWith, which would let e.g. 2547 match 254712345678.
   */
  isOwner(jid: string): boolean {
    const normalize = (s: string) => (s || '').split('@')[0].split(':')[0].replace(/\D/g, '');
    const senderNum = normalize(jid);
    if (!senderNum) return false;

    const ownerNum = normalize(config.OWNER_NUMBER);
    if (ownerNum && senderNum === ownerNum) return true;

    const botNum = normalize(this.sock?.user?.id || '');
    if (botNum && senderNum === botNum) return true;

    for (const o of config.OWNERS || []) {
      const od = normalize(o);
      if (od && senderNum === od) return true;
    }

    return false;
  }

  /**
   * Cached group metadata lookup. Every caller (command dispatch, anti-link,
   * Baileys' own internal fetches via `cachedGroupMetadata`) shares one cache,
   * so a busy group costs one network call per GROUP_META_TTL_S instead of one
   * per message.
   */
  async getGroupMetadata(jid: string): Promise<any | null> {
    if (!jid) return null;
    const cached = this.groupMetaCache.get(jid);
    if (cached) return cached;
    if (!this.sock) return null;
    const meta = await this.sock.groupMetadata(jid);
    this.groupMetaCache.set(jid, meta);
    return meta;
  }

  /** Public for tests and for the dashboard's metrics view. */
  getMetrics(): ReturnType<typeof metrics.snapshot> {
    return metrics.snapshot();
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
    this.reconnectAttempts = 0;

    // Stale caches would otherwise survive into the new session.
    this.groupMetaCache.flushAll();
    this.recentIds.reset();
    this.cooldown.reset();

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
    this.lastTransitionAt = Date.now();
    this.startWatchdog();

    try {
      const { state, saveCreds } = await useResilientAuthState(config.SESSION_DIR);
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
        // Required so WhatsApp's decryption retries can be answered. Without
        // this Baileys defaults to `async () => undefined`, the re-send never
        // happens, and chats get stuck on "Waiting for this message".
        getMessage: async (key: any) => this.messageCache.get(key?.id)?.message,
        // Group metadata is fetched per group message to resolve admins; letting
        // Baileys cache it (and reusing the same cache ourselves) keeps that off
        // the network instead of one lookup per message.
        cachedGroupMetadata: (async (jid: string) => this.getGroupMetadata(jid)) as any,
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

        this.lastTransitionAt = Date.now();

        if (connection === 'close') {
          this.connectionState = 'close';
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          this.lastError = lastDisconnect?.error?.message || `closed (code ${statusCode})`;
          const hasQr = !!this.currentQr;
          const decision = classifyDisconnect(statusCode, this.reconnectAttempts, hasQr);
          logger.warn({ statusCode, decision }, 'Connection closed');

          if (decision.action === 'logout') {
            // The device really was unlinked (401/411); credentials are dead.
            // Rotate to a fresh state and offer a new QR automatically so the
            // bot recovers on its own instead of sitting dead until a manual
            // reset. Only 401/411 reach here — transient drops never wipe.
            logger.error({ statusCode, reason: decision.reason }, 'WhatsApp unlinked this device');
            this.emit('loggedOut', decision.reason);
            this.scheduleLoggedOutRecovery();
          } else {
            if (decision.resetBackoff) {
              this.reconnectAttempts = 0;
            } else {
              this.reconnectAttempts++;
            }
            this.scheduleReconnect(decision.delayMs, statusCode);
          }
        } else if (connection === 'open') {
          this.connectionState = 'open';
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          this.lastError = null;
          this.registered = true;
          this.currentQr = null;
          this.lastTransitionAt = Date.now();
          logger.info({ jid: sock.user?.id }, 'Connected to WhatsApp');
          this.emit('connected', sock.user?.id);

          if (config.ALWAYS_ONLINE) {
            await sock.sendPresenceUpdate('available').catch(() => {});
            setInterval(() => {
              sock.sendPresenceUpdate('available').catch(() => {});
            }, 30000).unref();
          }
        }
      });

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Cache EVERY upsert first — including our own outgoing messages, which
        // Baileys emits with type 'append' when emitOwnEvents is on. Retries can
        // only be answered for messages we still hold, so skipping 'append' was
        // exactly why the bot's own replies hung on "Waiting for this message".
        for (const raw of messages) {
          this.storeMessage(raw);
        }

        if (type !== 'notify') {
          // WhatsApp replays everything the bot missed while it was asleep
          // (a redeploy, or Render spinning the free tier down) with type
          // 'append'. Those replays were dropped outright, so a command sent
          // while the bot was offline silently never ran.
          if (type === 'append') {
            await this.handleBacklog(messages).catch(err =>
              logger.error({ err: err?.message }, 'Backlog processing failed')
            );
          }
          return;
        }
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
      this.scheduleReconnect(10000, undefined);
    }
  }

  /** Schedule exactly one reconnect; the watchdog replaces any that is lost. */
  private scheduleReconnect(delayMs: number, statusCode: number | undefined): void {
    if (this.reconnectTimer) return;
    logger.info({ attempt: this.reconnectAttempts, delayMs, statusCode }, 'Reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.isConnecting = false;
      this.connect().catch(() => {});
    }, delayMs);
    this.reconnectTimer.unref();
  }

  /**
   * Last-resort watchdog. If the socket has been down (or stuck mid-handshake)
   * for several minutes with no reconnect pending, force one. This covers cases
   * where a `connection.update` event is never delivered — e.g. the process was
   * frozen by the host and the socket silently died — which previously left the
   * bot permanently offline until a manual restart.
   */
  private startWatchdog(): void {
    if (this.watchdogRunning) return;
    this.watchdogRunning = true;
    this.watchdog = setInterval(() => {
      if (this.logoutRecoveryRunning) return;
      if (this.reconnectTimer) return;
      if (this.connectionState === 'open' && this.registered) return;
      const silentFor = Date.now() - this.lastTransitionAt;
      if (silentFor < WATCHDOG_STUCK_MS) return;
      logger.warn({ silentFor, connectionState: this.connectionState }, 'Watchdog: forcing reconnect');
      this.lastTransitionAt = Date.now();
      this.isConnecting = false;
      this.connect().catch(() => {});
    }, WATCHDOG_INTERVAL_MS);
    this.watchdog.unref();
  }

  /**
   * After a real unlink, drop the dead session and reconnect so a fresh QR is
   * generated automatically. Without this the owner had to notice the logout
   * and re-pair by hand.
   */
  private scheduleLoggedOutRecovery(): void {
    if (this.logoutRecoveryRunning) return;
    this.logoutRecoveryRunning = true;
    setTimeout(async () => {
      try {
        if (this.sock) {
          try { this.sock.end(undefined); } catch {}
          this.sock = null;
        }
        await fs.rm(config.SESSION_DIR, { recursive: true, force: true });
        await fs.mkdir(config.SESSION_DIR, { recursive: true });
        logger.warn('Re-pairing required: open /pair to scan a new QR');
      } catch (err: any) {
        logger.error({ err: err?.message }, 'Failed to reset session after logout');
      } finally {
        this.reconnectAttempts = 0;
        this.isConnecting = false;
        this.connectionState = 'close';
        this.registered = false;
        this.lastTransitionAt = Date.now();
        this.logoutRecoveryRunning = false;
        this.connect().catch(() => {});
      }
    }, 3000).unref();
  }

  /**
   * Execute commands that arrived while the bot was offline.
   *
   * WhatsApp replays the missed window after a reconnect. Before this, the
   * upsert handler returned early for anything that was not `notify`, so a
   * message sent while the bot was asleep (Render free tier, a redeploy, a
   * dropped socket) silently never ran. Only recent, prefixed, known commands
   * are replayed — never arbitrary chat, which would otherwise have the bot
   * answer hours-old messages (and trigger auto-chat / view-once twice).
   */
  private async handleBacklog(messages: any[]): Promise<void> {
    if (!this.sock || !messages?.length) return;

    const cutoff = Date.now() - config.BACKLOG_WINDOW_MIN * 60_000;
    const candidates: any[] = [];

    for (const raw of messages) {
      const id: string | undefined = raw?.key?.id;
      if (!id || !raw.message) continue;
      if (raw.key.fromMe) continue;
      if (raw.message.protocolMessage) continue;

      const timestamp = Number(raw.messageTimestamp || 0) * 1000;
      if (!timestamp || timestamp < cutoff) continue;
      if (ledger.has(id) || this.recentIds.has(id)) continue;

      const body: string =
        raw.message.conversation || raw.message.extendedTextMessage?.text || '';
      if (!body.startsWith(config.PREFIX)) continue;

      const name = body.slice(config.PREFIX.length).split(' ')[0].trim().toLowerCase();
      if (!name || !this.registry.find(name)) continue;

      candidates.push(raw);
    }

    if (!candidates.length) return;

    // Oldest first, but never flood: a long sleep can replay hundreds of
    // messages, and acting on all of them at once is the fastest way to get
    // the number flagged for spam.
    candidates.sort((a, b) => Number(a.messageTimestamp) - Number(b.messageTimestamp));
    const batch = candidates.slice(-BACKLOG_MAX_PER_BATCH);

    metrics.backlogProcessed(batch.length);
    logger.info(
      { running: batch.length, missed: candidates.length },
      'Running commands received while offline'
    );

    for (const raw of batch) {
      try {
        await this.handleMessage(raw);
      } catch (err: any) {
        logger.error({ err: err?.message, key: raw?.key?.id }, 'Backlog command failed');
      }
    }
  }

  private async handleMessage(raw: any): Promise<void> {
    if (!this.sock) return;
    await this.ready.catch(() => {});

    // Exact-once: the ledger remembers commands already executed (across
    // restarts), recentIds covers everything else within this process.
    const rawId: string | undefined = raw?.key?.id;
    if (rawId) {
      if (ledger.has(rawId)) return;
      if (!this.recentIds.add(rawId)) return;
    }

    // Always retain recent messages so retry requests can be served (getMessage
    // above) — this is what clears "Waiting for this message" for our own sends.
    this.storeMessage(raw);

    metrics.messageReceived();

    if ((globalThis as any).__antiDelete) {
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

    if (config.AUTO_REACT && !m.body.startsWith(config.PREFIX)) {
      await m.react('👍').catch(() => {});
    }

    await this.handleAutoChat(m);

    if ((globalThis as any).__autoVO) {
      await this.handleViewOnce(m).catch(() => {});
    }

    const prefix = config.PREFIX;
    const isCommand = m.body.startsWith(prefix);

    let isAdmin = false;
    let isBotAdmin = false;

    // Only look up group metadata when something actually needs it: a command
    // (for permission checks) or a possible anti-link violation. Doing it for
    // every message is a needless network round-trip per message and a fast way
    // to get the number rate-limited.
    const needsAdminInfo =
      m.isGroup &&
      (isCommand || (config.ANTILINK && !isCreator && INVITE_LINK_RE.test(m.body)));

    if (needsAdminInfo) {
      try {
        const meta = await this.getGroupMetadata(m.from);
        const admins = (meta?.participants || []).filter(
          (p: any) => p.admin === 'admin' || p.admin === 'superadmin'
        );
        const adminJids = admins.map((p: any) => p.id);
        isAdmin = adminJids.includes(m.sender);
        isBotAdmin = adminJids.includes(botJid);
      } catch {}
    }

    // Anti-link: remove group invite links from non-admins (owner exempt).
    if (config.ANTILINK && m.isGroup && !isCommand && !isAdmin && !isCreator) {
      const inviteMatch = m.body.match(INVITE_LINK_RE);
      if (inviteMatch) {
        if (isBotAdmin) {
          await this.sock.sendMessage(m.from, { delete: m.key }).catch(() => {});
        }
        await this.sock.sendMessage(m.from, {
          text: `🔗 @${m.sender.split('@')[0]}, group links are not allowed here!${isBotAdmin ? '\nYour message was removed.' : '\n⚠️ I need admin rights to remove it.'}`,
          mentions: [m.sender],
        }).catch(() => {});
        logger.info({ from: m.from, sender: m.sender }, 'Anti-link: group invite removed');
        return;
      }
    }

    if (!isCommand) return;

    const cmd = m.body.slice(prefix.length).split(' ')[0].toLowerCase();
    const text = m.body.slice(prefix.length + cmd.length).trim();
    const args = text.split(/\s+/).filter(Boolean);

    if (!cmd) return;

    logger.info({ cmd, sender: m.sender, from: m.from, isGroup: m.isGroup }, 'Command received');

    // Acknowledge immediately so the sender sees a read tick + "typing..."
    // instead of "waiting for this message" while the command runs.
    await this.sock.readMessages([m.key]).catch(() => {});
    await this.sock.sendPresenceUpdate('composing', m.from).catch(() => {});

    const command = this.registry.find(cmd);
    if (!command) {
      await m.reply(`Unknown command: ${prefix}${cmd}\nType ${prefix}menu for available commands.`).catch(() => {});
      return;
    }

    // Throttle before doing any work: this is what stops a single user from
    // spamming the chat (and the bot's number getting banned for it).
    if (!isCreator) {
      const cooldownMs = command.cooldownMs ??
        (EXPENSIVE_COMMANDS.has(command.name) ? config.AI_COOLDOWN_MS : config.COMMAND_COOLDOWN_MS);
      const gate = this.cooldown.check(m.sender, command.name, {
        cooldownMs,
        windowMs: 60_000,
        max: config.MAX_COMMANDS_PER_MINUTE,
      });
      if (!gate.ok) {
        metrics.cooldownHit();
        logger.info({ cmd, sender: m.sender, reason: gate.reason }, 'Command throttled');
        if (this.cooldown.shouldWarn(m.sender)) {
          const seconds = Math.max(1, Math.ceil(gate.retryAfterMs / 1000));
          await m.reply(`⏳ Subiri sekunde ${seconds} kabla ya kutumia ${prefix}${cmd} tena.`).catch(() => {});
        }
        return;
      }
    }

    // Persist the id: a redeploy replays the offline backlog, and the command
    // must not run a second time on the way back up.
    if (rawId) ledger.add(rawId);
    metrics.command(command.name, command.category);

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
      registry: this.registry,
    };

    try {
      await command.execute(ctx);
    } catch (err: any) {
      logger.error({ err: err?.message, cmd }, 'Command execution failed');
      await m.reply(`Error: ${err?.message || 'Command failed'}`).catch(() => {});
    } finally {
      // Stop the "typing..." indicator once the command finishes.
      await this.sock.sendPresenceUpdate('paused', m.from).catch(() => {});
    }
  }

  private storeMessage(raw: any): void {
    try {
      if (!raw?.key?.id || !raw.message) return;
      // Revoke/protocol messages carry no re-sendable content.
      if (raw.message.protocolMessage) return;
      this.messageCache.set(raw.key.id, raw);
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

    const original = this.messageCache.get(deletedKey);
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
    header += `⏰ *Time:* ${formatLocal()}\n`;

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

    this.messageCache.delete(deletedKey);
    logger.info({ deletedKey, from: sender, isGroup }, 'Anti-delete: message forwarded to owner');
  }

  private async handleAutoChat(m: SerializedMessage): Promise<void> {
    if (!this.sock) return;
    if (!m.body || m.body.startsWith(config.PREFIX)) return;
    if (m.fromMe) return;
    if (this.isOwner(m.sender)) return;

    const autoChatOn = (globalThis as any).__autoChat;
    const autoChatGroupOn = (globalThis as any).__autoChatGroup;

    let shouldRespond = false;

    if (m.isPrivate && autoChatOn) {
      shouldRespond = true;
    } else if (m.isGroup && autoChatGroupOn) {
      const botJid = decodeJid(this.sock.user?.id || '').split('@')[0];
      const isMentioned = m.mentionedJid?.some(j => j.includes(botJid));
      const isReplyToBot = m.quoted?.fromMe || m.quoted?.sender?.includes(botJid);
      if (isMentioned || isReplyToBot) shouldRespond = true;
    }

    if (!shouldRespond) return;

    let userText = m.body;
    if (m.isGroup && m.mentionedJid?.length) {
      const botJid = decodeJid(this.sock.user?.id || '');
      userText = userText.replace(new RegExp(`@${botJid.split('@')[0]}`, 'g'), '').trim();
      if (!userText) userText = 'Habari';
    }

    await m.react('🤖').catch(() => {});

    try {
      const history = this.getChatHistory(m.sender);
      const aiReply = await this.callAI(userText, history, m);

      if (!aiReply) {
        await m.react('❌').catch(() => {});
        return;
      }

      this.addChatHistory(m.sender, 'user', userText);
      this.addChatHistory(m.sender, 'assistant', aiReply);

      if (config.AUTO_TYPING) {
        await this.sock.sendPresenceUpdate('composing', m.from).catch(() => {});
      }

      await this.sock.sendMessage(m.from, {
        text: aiReply,
        mentions: m.isGroup ? m.mentionedJid : undefined,
      });
      await m.react('✅').catch(() => {});

      logger.info({ from: m.sender, chat: m.from, isGroup: m.isGroup }, 'Auto-chat replied');
    } catch (err: any) {
      await m.react('❌').catch(() => {});
      logger.error({ err: err?.message }, 'Auto-chat failed');
    }
  }

  private getChatHistory(jid: string): ChatTurn[] {
    return this.chatHistories.get(jid) || [];
  }

  private addChatHistory(jid: string, role: string, content: string): void {
    const history = this.chatHistories.get(jid) || [];
    history.push({ role, content });
    if (history.length > BotClient.MAX_HISTORY) {
      history.splice(0, history.length - BotClient.MAX_HISTORY);
    }
    this.chatHistories.set(jid, history);
  }

  private async callAI(
    userText: string,
    history: ChatTurn[],
    _m?: SerializedMessage
  ): Promise<string | null> {
    try {
      const { text } = await askAI(this.sock, userText, history);
      return text;
    } catch (err: any) {
      logger.error({ err: err?.message }, 'All AI engines failed');
      return null;
    }
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
    if (!this.sock) return;
    const { id, participants, action } = update;
    // Admin lists just changed: drop the cached copy so permissions are correct
    // immediately instead of up to GROUP_META_TTL_S later.
    this.groupMetaCache.del(id);
    if (action !== 'add' && action !== 'remove') return;
    // WELCOME and GOODBYE are separate switches — gating both on WELCOME meant
    // `.goodbye on` alone did nothing.
    if (action === 'add' && !config.WELCOME) return;
    if (action === 'remove' && !config.GOODBYE) return;

    for (const participant of participants) {
      const tag = `@${participant.split('@')[0]}`;
      const text = action === 'add'
        ? `Welcome ${tag} to the group! 🎉`
        : `Goodbye ${tag}! 👋`;
      await this.sock.sendMessage(id, { text, mentions: [participant] }).catch(() => {});
    }
  }
}
