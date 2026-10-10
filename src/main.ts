import config from './config/index.js';
import logger from './core/logger.js';
import { BotClient } from './core/client.js';
import { createWebServer } from './web/server.js';

async function main() {
  logger.info({ bot: config.BOT_NAME, version: '2.0.0' }, 'Starting Mtaula 01');

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
