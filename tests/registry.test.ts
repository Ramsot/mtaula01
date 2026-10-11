import { describe, it, expect } from 'vitest';
import { CommandRegistry } from '../src/core/registry.js';
import type { Command } from '../src/core/types.js';

// Import every command module directly (the runtime loader uses dynamic
// file:// imports which Vitest does not transform).
import aiCommands from '../src/modules/ai/index.js';
import antiDeleteCommands from '../src/modules/antidelete/index.js';
import autochatCommands from '../src/modules/autochat/index.js';
import converterCommands from '../src/modules/converter/index.js';
import downloaderCommands from '../src/modules/downloader/index.js';
import funCommands from '../src/modules/fun/index.js';
import groupCommands from '../src/modules/group/index.js';
import infoCommands from '../src/modules/info/index.js';
import mediaCommands from '../src/modules/media/index.js';
import ownerCommands from '../src/modules/owner/index.js';
import searchCommands from '../src/modules/search/index.js';
import toolCommands from '../src/modules/tools/index.js';

const factories = [
  aiCommands,
  antiDeleteCommands,
  autochatCommands,
  converterCommands,
  downloaderCommands,
  funCommands,
  groupCommands,
  infoCommands,
  mediaCommands,
  ownerCommands,
  searchCommands,
  toolCommands,
];

function allCommands(): Command[] {
  const registry = new CommandRegistry();
  for (const factory of factories) {
    for (const cmd of factory()) registry.register(cmd);
  }
  return registry.getAll();
}

describe('command registry', () => {
  it('loads a healthy number of commands', () => {
    // 85 command names are registered across the 12 modules today.
    expect(allCommands().length).toBeGreaterThanOrEqual(60);
  });

  it('has no duplicate command names', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const cmd of allCommands()) {
      if (seen.has(cmd.name)) dupes.push(cmd.name);
      seen.add(cmd.name);
    }
    expect(dupes, `duplicate names: ${dupes.join(', ')}`).toEqual([]);
  });

  it('has no alias colliding with another command name or alias', () => {
    const names = new Set(allCommands().map(c => c.name));
    const aliases = new Map<string, string>();
    const clashes: string[] = [];

    for (const cmd of allCommands()) {
      for (const alias of cmd.aliases || []) {
        if (names.has(alias) && alias !== cmd.name) {
          clashes.push(`alias "${alias}" of ${cmd.name} collides with a command name`);
        }
        if (aliases.has(alias) && aliases.get(alias) !== cmd.name) {
          clashes.push(`alias "${alias}" used by both ${aliases.get(alias)} and ${cmd.name}`);
        }
        aliases.set(alias, cmd.name);
      }
    }
    expect(clashes, clashes.join('; ')).toEqual([]);
  });

  it('every command has a description and an async execute function', () => {
    for (const cmd of allCommands()) {
      expect(cmd.description, `${cmd.name} missing description`).toBeTruthy();
      expect(typeof cmd.execute, `${cmd.name} execute`).toBe('function');
      expect(cmd.category, `${cmd.name} category`).toBeTruthy();
    }
  });

  it('registry.find resolves names and aliases', () => {
    const registry = new CommandRegistry();
    for (const factory of factories) {
      for (const cmd of factory()) registry.register(cmd);
    }
    expect(registry.find('ping')?.name).toBe('ping');
    expect(registry.find('p')?.name).toBe('ping');
    expect(registry.find('menu')?.name).toBe('menu');
    expect(registry.find('ai')?.name).toBe('ai');
    expect(registry.find('doesnotexist')).toBeUndefined();
  });
});

describe('critical commands still exist', () => {
  const required = [
    'menu', 'ping', 'ai', 'sticker', 'toimg', 'emojimix', 'play', 'yts',
    'tiktok', 'google', 'trt', 'wallpaper', 'block', 'unblock', 'setbotpp',
    'groupname', 'kick', 'tagall', 'antidelete', 'broadcast', 'calc', 'tts',
  ];

  it.each(required)('%s is registered', name => {
    const registry = new CommandRegistry();
    for (const factory of factories) {
      for (const cmd of factory()) registry.register(cmd);
    }
    expect(registry.find(name), `command "${name}" missing`).toBeDefined();
  });
});
