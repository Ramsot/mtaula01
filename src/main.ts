import config from './config/index.js';
import logger from './core/logger.js';
import { BotClient } from './core/client.js';
import { createWebServer } from './web/server.js';
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

    logger.info({ dir, hasSession }, 'Session directory is writable');
    if (!hasSession) {
      logger.warn(
        { dir },
        'No saved session found - pair via /pair. It will be reused across restarts if this dir is on a persistent Disk.'
      );
    }
  } catch (err: any) {
    logger.error(
      { dir, err: err?.message },
      'Session directory is NOT writable - the WhatsApp session cannot be saved and every restart will require re-pairing. On Render, use a Disk mounted at SESSION_DIR and run the container as root (or ensure the mount is writable).'
    );
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

  await bot.connect();
}

main().catch((err) => {
  logger.error({ err: err?.message }, 'Failed to start');
  process.exit(1);
});
