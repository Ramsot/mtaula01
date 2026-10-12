import 'dotenv/config';
import path from 'path';
import { z } from 'zod';
import type { BotConfig } from '../core/types.js';

const envSchema = z.object({
  PREFIX: z.string().default('.'),
  MODE: z.enum(['public', 'self']).default('public'),
  OWNER_NAME: z.string().default('Mtaula 01'),
  OWNER_NUMBER: z.string().default(''),
  OWNERS: z.string().default(''),
  BOT_NAME: z.string().default('Mtaula 01'),
  BOT_IMAGE: z.string().default('https://files.catbox.moe/7l1rr5.jpg'),
  DESCRIPTION: z.string().default('Mtaula 01 WhatsApp Bot'),
  GEMINI_KEY: z.string().default(''),
  OPENAI_KEY: z.string().default(''),
  GROQ_KEY: z.string().default(''),
  META_AI_NUMBER: z.string().default('867051314767696'),
  ADMIN_TOKEN: z.string().default(''),
  // Model ids are configurable because providers retire them without notice;
  // a hardcoded id turns into a silent "AI failed" the day it disappears.
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  GROQ_MODEL: z.string().default('qwen/qwen3.8-27b'),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  GEMINI_IMAGE_MODEL: z.string().default('gemini-3.1-flash-image'),
  GROQ_STT_MODEL: z.string().default('whisper-large-v3-turbo'),
  AI_SELFTEST: z.string().default('true').transform(v => v === 'true'),
  ALWAYS_ONLINE: z.string().default('false').transform(v => v === 'true'),
  AUTO_READ: z.string().default('false').transform(v => v === 'true'),
  AUTO_TYPING: z.string().default('false').transform(v => v === 'true'),
  AUTO_RECORDING: z.string().default('false').transform(v => v === 'true'),
  AUTO_REACT: z.string().default('false').transform(v => v === 'true'),
  REJECT_CALL: z.string().default('true').transform(v => v === 'true'),
  WELCOME: z.string().default('false').transform(v => v === 'true'),
  GOODBYE: z.string().default('false').transform(v => v === 'true'),
  ANTILINK: z.string().default('true').transform(v => v === 'true'),
  DEBUG_MODE: z.string().default('false').transform(v => v === 'true'),
  TIMEZONE: z.string().default('Africa/Dar_es_Salaam'),
  // --- Anti-abuse -----------------------------------------------------------
  // WhatsApp bans numbers that burst messages, and AI commands cost money, so
  // every user has a per-command cooldown plus a rolling per-minute cap.
  COMMAND_COOLDOWN_MS: z.string().default('2500').transform(Number),
  AI_COOLDOWN_MS: z.string().default('8000').transform(Number),
  MAX_COMMANDS_PER_MINUTE: z.string().default('20').transform(Number),
  // Commands that were sent while the bot was asleep (Render spins the free
  // tier down) are replayed by WhatsApp; only act on recent ones.
  BACKLOG_WINDOW_MIN: z.string().default('30').transform(Number),
  SECURITY_TOOLS: z.string().default('true').transform(v => v === 'true'),
  PORTSCAN_MAX_PORTS: z.string().default('20').transform(Number),
  SESSION_DIR: z.string().default('./auth_info_baileys'),
  DATA_DIR: z.string().default(''),
  PORT: z.string().default('3000').transform(Number),
});

/**
 * Admin data used to live in ./data, which is wiped on every Render deploy
 * (ephemeral filesystem) - so users, pairings and activity vanished and the
 * owner had to re-create accounts and re-pair devices after each update. Derive
 * a directory next to the persistent session directory when SESSION_DIR is an
 * absolute path (i.e. a mounted Disk) so this data survives redeploys too.
 */
function resolveDataDir(explicit: string, sessionDir: string): string {
  if (explicit) return explicit;
  if (path.isAbsolute(sessionDir)) return path.join(path.dirname(sessionDir), 'mtaula-data');
  return './data';
}

function loadConfig(): BotConfig {
  // Vitest/Vite set MODE=test in the environment before dotenv runs; an
  // invalid mode should fall back to the .env value / default, not kill the
  // process. Same idea for any other enum we add later.
  if (process.env.MODE && !['public', 'self'].includes(process.env.MODE)) {
    delete process.env.MODE;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Config validation errors:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const e = parsed.data;
  return {
    PREFIX: e.PREFIX,
    MODE: e.MODE,
    OWNER_NAME: e.OWNER_NAME,
    OWNER_NUMBER: e.OWNER_NUMBER,
    OWNERS: e.OWNERS.split(',').map(s => s.trim()).filter(Boolean),
    BOT_NAME: e.BOT_NAME,
    BOT_IMAGE: e.BOT_IMAGE,
    DESCRIPTION: e.DESCRIPTION,
    GEMINI_KEY: e.GEMINI_KEY,
    OPENAI_KEY: e.OPENAI_KEY,
    GROQ_KEY: e.GROQ_KEY,
    META_AI_NUMBER: e.META_AI_NUMBER,
    ADMIN_TOKEN: e.ADMIN_TOKEN,
    GEMINI_MODEL: e.GEMINI_MODEL,
    GROQ_MODEL: e.GROQ_MODEL,
    OPENAI_MODEL: e.OPENAI_MODEL,
    GEMINI_IMAGE_MODEL: e.GEMINI_IMAGE_MODEL,
    GROQ_STT_MODEL: e.GROQ_STT_MODEL,
    AI_SELFTEST: e.AI_SELFTEST,
    ALWAYS_ONLINE: e.ALWAYS_ONLINE,
    AUTO_READ: e.AUTO_READ,
    AUTO_TYPING: e.AUTO_TYPING,
    AUTO_RECORDING: e.AUTO_RECORDING,
    AUTO_REACT: e.AUTO_REACT,
    REJECT_CALL: e.REJECT_CALL,
    WELCOME: e.WELCOME,
    GOODBYE: e.GOODBYE,
    ANTILINK: e.ANTILINK,
    DEBUG_MODE: e.DEBUG_MODE,
    TIMEZONE: e.TIMEZONE,
    COMMAND_COOLDOWN_MS: e.COMMAND_COOLDOWN_MS,
    AI_COOLDOWN_MS: e.AI_COOLDOWN_MS,
    MAX_COMMANDS_PER_MINUTE: e.MAX_COMMANDS_PER_MINUTE,
    BACKLOG_WINDOW_MIN: e.BACKLOG_WINDOW_MIN,
    SECURITY_TOOLS: e.SECURITY_TOOLS,
    PORTSCAN_MAX_PORTS: e.PORTSCAN_MAX_PORTS,
    SESSION_DIR: e.SESSION_DIR,
    DATA_DIR: resolveDataDir(e.DATA_DIR, e.SESSION_DIR),
    PORT: e.PORT,
  };
}

const config = loadConfig();
export default config;
