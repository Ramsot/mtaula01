import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../src/config/index.js';
import { BotClient } from '../src/core/client.js';
import { formatUptime, formatBytes, decodeJid, isUrl, parseMention } from '../src/core/serializer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, '..', 'src');

describe('isOwner matching is strict (privilege escalation check)', () => {
  let bot: BotClient;

  beforeAll(() => {
    // Config is loaded at import time, so mutate the loaded object directly.
    config.OWNER_NUMBER = '254712345678';
    config.OWNERS = ['255754000111'];
    bot = new BotClient();
  });

  it('accepts the exact owner number', () => {
    expect(bot.isOwner('254712345678@s.whatsapp.net')).toBe(true);
  });

  it('accepts owner with a device suffix', () => {
    expect(bot.isOwner('254712345678:12@s.whatsapp.net')).toBe(true);
  });

  it('rejects a number that merely ends with the owner digits', () => {
    expect(bot.isOwner('19254712345678@s.whatsapp.net')).toBe(false);
  });

  it('rejects a shorter number that is a prefix of the owner number', () => {
    expect(bot.isOwner('25471234@s.whatsapp.net')).toBe(false);
  });

  it('rejects unrelated numbers', () => {
    expect(bot.isOwner('255754111222@s.whatsapp.net')).toBe(false);
  });

  it('accepts an explicit co-owner from OWNERS', () => {
    expect(bot.isOwner('255754000111@s.whatsapp.net')).toBe(true);
  });

  it('rejects empty / malformed jids', () => {
    expect(bot.isOwner('')).toBe(false);
    expect(bot.isOwner('@s.whatsapp.net')).toBe(false);
  });
});

describe('serializer helpers', () => {
  it('formats uptime', () => {
    expect(formatUptime(5)).toBe('5s');
    expect(formatUptime(90)).toBe('1m 30s');
    expect(formatUptime(3661)).toBe('1h 1m 1s');
  });

  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(1024)).toBe('1 KB');
  });

  it('decodes device-tagged jids', () => {
    expect(decodeJid('254712345678:99@s.whatsapp.net')).toBe('254712345678@s.whatsapp.net');
  });

  it('detects urls', () => {
    expect(isUrl('see https://example.com/x')).toBe(true);
    expect(isUrl('no link here')).toBe(false);
  });

  it('parses mentions', () => {
    expect(parseMention('hi @254712345678')).toEqual(['254712345678@s.whatsapp.net']);
    expect(parseMention('no mentions')).toEqual([]);
  });
});

describe('API key hygiene', () => {
  const KEY_PATTERNS: Array<[string, RegExp]> = [
    ['Google API key', /AIza[0-9A-Za-z_-]{35}/],
    ['OpenAI-style key', /sk-[A-Za-z0-9_-]{20,}/],
    ['Groq key', /gsk_[A-Za-z0-9]{20,}/],
    ['Meta/EAA access token', /EAA[A-Za-z0-9]{25,}/],
  ];

  async function sourceFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
      else if (/\.(ts|js|html)$/.test(entry.name)) out.push(full);
    }
    return out;
  }

  it('contains no hardcoded credentials in src/ or public/', async () => {
    const files = [...(await sourceFiles(SRC)), ...(await sourceFiles(path.resolve(__dirname, '..', 'public')))];
    const offenders: string[] = [];

    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      for (const [label, pattern] of KEY_PATTERNS) {
        if (pattern.test(content)) offenders.push(`${path.relative(SRC, file)}: ${label}`);
      }
    }
    expect(offenders, offenders.join('; ')).toEqual([]);
  });

  it('never builds Gemini URLs with the key in the query string', async () => {
    const files = await sourceFiles(SRC);
    const offenders: string[] = [];
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      if (/generativelanguage\.googleapis\.com[^'"]*\?key=/.test(content)) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(offenders, `key-in-URL found in: ${offenders.join(', ')}`).toEqual([]);
  });

  it('.env is git-ignored', async () => {
    const gitignore = await fs.readFile(path.resolve(__dirname, '..', '.gitignore'), 'utf8');
    expect(gitignore).toMatch(/^\.env$/m);
  });

  it('.env.example carries no real keys', async () => {
    const example = await fs.readFile(path.resolve(__dirname, '..', '.env.example'), 'utf8');
    for (const [, pattern] of KEY_PATTERNS) {
      expect(pattern.test(example)).toBe(false);
    }
  });
});
