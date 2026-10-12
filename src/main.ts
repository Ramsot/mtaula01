import config from './config/index.js';
import logger from './core/logger.js';
import { BotClient } from './core/client.js';
import { createWebServer } from './web/server.js';
import { adminStore } from './core/admin.js';
import { pairingStore } from './core/pairing.js';
import { aiDiagnostics, availableAiEngines } from './core/ai.js';
import fs from 'fs/promises';

/**
 * Verify the WhatsApp session directory is actually writable. If it is not
 * (e.g. a mounted Disk owned by root while the process runs as a non-root
 * user), the session is silently lost on every restart and the owner has to
 * re-pair each deploy. Fail loudly instead.
 */
async function checkSessionDir(): Promise<void> {
  const dir = config.SESSION_DIR;
  const dataDir = config.DATA_DIR;
  const isPersistentPath = (p: string) => p.startsWith('/data') || p.startsWith('/mnt') || p.startsWith('/var/data');
  try {
    await fs.mkdir(dir, { recursive: true });
    const probe = `${dir}/.write-probe`;
    await fs.writeFile(probe, 'ok');
    await fs.rm(probe, { force: true });

    let hasSession = false;
    try {
      await fs.access(`${dir}/creds.json`);
      hasSession = true;
    } catch {}

    const isPersistent = isPersistentPath(dir);
    logger.info({ dir, hasSession, isPersistent }, 'Session directory is writable');

    if (!hasSession) {
      logger.warn({ dir }, 'No saved session - pair via /pair');
    }

    if (!isPersistent) {
      logger.warn(
        { dir },
        'Session dir is NOT on a persistent Disk! Every Render redeploy will wipe it and force re-pair. Fix: Render Dashboard > Disks > Add Disk (mountPath: /data) then set SESSION_DIR=/data/auth_info_baileys'
      );
    }
  } catch (err: any) {
    logger.error(
      { dir, err: err?.message },
      'Session directory is NOT writable - session cannot be saved'
    );
  }

  // Accounts and device pairings live in DATA_DIR. If that is not persistent,
  // every redeploy wipes logins and forces every paired device to re-pair.
  try {
    await fs.mkdir(dataDir, { recursive: true });
    const probe = `${dataDir}/.write-probe`;
    await fs.writeFile(probe, 'ok');
    await fs.rm(probe, { force: true });

    const isPersistent = isPersistentPath(dataDir);
    logger.info({ dir: dataDir, isPersistent }, 'Data directory is writable');
    if (!isPersistent) {
      logger.warn(
        { dir: dataDir },
        'DATA_DIR is NOT on a persistent Disk! Admin accounts and device pairings will be lost on redeploy. Set DATA_DIR to a path on the mounted Disk (e.g. /data/mtaula-data).'
      );
    }
  } catch (err: any) {
    logger.error({ dir: dataDir, err: err?.message }, 'Data directory is NOT writable');
  }
}

async function main() {
  logger.info({ bot: config.BOT_NAME, version: '2.0.0' }, 'Starting Mtaula 01');

  // Log which AI engines are usable (keys are masked, never printed) so a
  // missing key is obvious from the boot log instead of surfacing as a
  // confusing runtime error on the first .ai message.
  logger.info(aiDiagnostics(), 'AI engine config');
  if (availableAiEngines().length === 0) {
    logger.warn(
      { hint: 'Set GEMINI_KEY / GROQ_KEY / OPENAI_KEY (Render: Settings -> Environment)' },
      'No AI API keys detected - .ai will fall back to Meta AI or fail'
    );
  }

  await checkSessionDir();
  await adminStore.load();
  await pairingStore.load();

  const bot = new BotClient();
  const app = createWebServer(bot);

  app.listen(config.PORT, '0.0.0.0', () => {
    logger.info({ port: config.PORT }, 'HTTP server listening');
  });

  bot.on('connected', (jid) => {
    logger.info({ jid }, 'Bot connected');
  });

  bot.on('qr', () => {
    logger.info('QR available at /pair');
  });

  bot.on('loggedOut', () => {
    logger.error('Logged out - session needs reset');
  });

  process.on('SIGINT', () => {
    logger.info('Shutting down');
    const sock = bot.getSocket();
    if (sock) { try { sock.end(undefined); } catch {} }
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Shutting down (SIGTERM)');
    const sock = bot.getSocket();
    if (sock) { try { sock.end(undefined); } catch {} }
    process.exit(0);
  });

  process.on('uncaughtException', (err) => {
    logger.error({ err: err.message }, 'Uncaught exception');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
  });

  startKeepAlive(bot);

  await bot.connect();
}

/**
 * Render free tier sleeps after ~15 min with no inbound HTTP traffic. When the
 * service sleeps the Baileys socket dies mid-session and the next wake-up often
 * lands on a corrupted signal session ("Bad MAC") that requires a full re-pair.
 *
 * Three layers keep it awake:
 *  1. Self-ping to /health every 9 min (inbound HTTP counts as activity).
 *  2. Outbound WhatsApp presence ping every 4 min (keeps the WA socket warm so
 *     it is not dropped as idle even if the HTTP layer is quiet).
 *  3. An optional external monitor (UptimeRobot / cron-job.org) hitting /health
 *     every 5 min as a belt-and-braces backstop.
 */
function startKeepAlive(bot: BotClient): void {
  const SELF_PING_MS = 9 * 60 * 1000;
  const WA_PING_MS = 4 * 60 * 1000;

  const selfPing = setInterval(() => {
    const url = `http://127.0.0.1:${config.PORT}/health`;
    fetch(url, { signal: AbortSignal.timeout(10000) })
      .then(r => logger.debug({ status: r.status }, 'Keepalive self-ping'))
      .catch(err => logger.warn({ err: err?.message }, 'Keepalive self-ping failed'));
  }, SELF_PING_MS);
  selfPing.unref();

  const waPing = setInterval(() => {
    const sock = bot.getSocket();
    if (!sock?.user?.id) return;
    sock.sendPresenceUpdate('available').catch(() => {});
  }, WA_PING_MS);
  waPing.unref();

  logger.info(
    { selfPingMin: SELF_PING_MS / 60000, waPingMin: WA_PING_MS / 60000 },
    'Keepalive started'
  );
}

main().catch((err) => {
  logger.error({ err: err?.message }, 'Failed to start');
  process.exit(1);
});
