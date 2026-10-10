import 'dotenv/config';
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
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
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
  SESSION_DIR: z.string().default('./auth_info_baileys'),
  PORT: z.string().default('3000').transform(Number),
});

function loadConfig(): BotConfig {
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
    OPENAI_MODEL: e.OPENAI_MODEL,
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
    SESSION_DIR: e.SESSION_DIR,
    PORT: e.PORT,
  };
}

const config = loadConfig();
export default config;
