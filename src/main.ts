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

  bot.on('loggedOut', (reason) => {
    logger.error(
      { reason },
      'WhatsApp unlinked this device. The bot is rotating its session and will show a fresh QR at /pair so you can re-link it.'
    );
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
 * Keeps the bot up 24/7 without sleeping or logging out.
 *
 * Why it previously "logged out": Render's free tier spins a web service down
 * after ~15 minutes with no INBOUND traffic. A ping to 127.0.0.1 never leaves
 * the container, so it does not count as activity — the old self-ping did not
 * actually prevent the sleep. When the service is frozen the WhatsApp socket
 * dies; the wake-up could then land on a half-written `creds.json` and look
 * like a logout.
 *
 * Four layers now keep it alive:
 *  1. A ping to the service's OWN public URL every 10 min. Render exposes that
 *     as RENDER_EXTERNAL_URL; the request goes out and comes back through
 *     Render's edge, so it registers as real inbound traffic and resets the
 *     spin-down timer.
 *  2. A loopback /health ping as a fallback liveness check when no public URL
 *     is known (it does not stop the sleep on its own).
 *  3. An outbound WhatsApp presence ping every 4 min so the socket is not
 *     dropped as idle even when the HTTP layer is quiet.
 *  4. Resilient, atomic credential persistence (see core/auth-state.ts) so an
 *     abrupt freeze can never corrupt the session and force a re-pair.
 *
 * Even with all of this, a free Render instance can still be spun down for
 * platform reasons, so point a free external monitor (UptimeRobot,
 * cron-job.org, or a GitHub Action) at <your-url>/health every 5 minutes as a
 * belt-and-braces backstop. On a paid instance this is unnecessary.
 */
function startKeepAlive(bot: BotClient): void {
  const PUBLIC_PING_MS = 10 * 60 * 1000;
  const LOOPBACK_PING_MS = 9 * 60 * 1000;
  const WA_PING_MS = 4 * 60 * 1000;

  const publicUrl = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  const pingUrl = publicUrl ? `${publicUrl}/health` : `http://127.0.0.1:${config.PORT}/health`;
  const pingMs = publicUrl ? PUBLIC_PING_MS : LOOPBACK_PING_MS;

  const selfPing = setInterval(() => {
    fetch(pingUrl, { signal: AbortSignal.timeout(10000) })
      .then(r => logger.debug({ status: r.status, url: pingUrl }, 'Keepalive ping'))
      .catch(err => logger.warn({ err: err?.message, url: pingUrl }, 'Keepalive ping failed'));
  }, pingMs);
  selfPing.unref();

  // Validate the loopback endpoint too, so a broken HTTP layer is visible in
  // the logs rather than only showing up as a routing failure.
  if (publicUrl) {
    const loopback = setInterval(() => {
      fetch(`http://127.0.0.1:${config.PORT}/health`, { signal: AbortSignal.timeout(10000) })
        .then(r => logger.debug({ status: r.status }, 'Keepalive loopback check'))
        .catch(err => logger.warn({ err: err?.message }, 'Keepalive loopback check failed'));
    }, LOOPBACK_PING_MS);
    loopback.unref();
  }

  const waPing = setInterval(() => {
    const sock = bot.getSocket();
    if (!sock?.user?.id) return;
    sock.sendPresenceUpdate('available').catch(() => {});
  }, WA_PING_MS);
  waPing.unref();

  if (!publicUrl) {
    logger.warn(
      { pingUrl },
      'RENDER_EXTERNAL_URL is not set - only loopback keepalive is active, which does NOT stop a free-tier sleep. Add an external monitor hitting /health every 5 minutes, or run on a paid instance.'
    );
  }

  logger.info(
    { pingUrl, pingMin: pingMs / 60000, waPingMin: WA_PING_MS / 60000, publicUrl: publicUrl || null },
    'Keepalive started'
  );
}

main().catch((err) => {
  logger.error({ err: err?.message }, 'Failed to start');
  process.exit(1);
});
