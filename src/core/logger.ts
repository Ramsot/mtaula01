import pino from 'pino';
import config from '../config/index.js';

const logger = pino({
  level: config.DEBUG_MODE ? 'debug' : 'info',
  transport: config.DEBUG_MODE ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});

export default logger;
