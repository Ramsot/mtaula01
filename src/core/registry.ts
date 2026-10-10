import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Command } from './types.js';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class CommandRegistry {
  private commands = new Map<string, Command>();
  private aliases = new Map<string, string>();

  register(command: Command): void {
    if (this.commands.has(command.name)) {
      logger.warn({ name: command.name }, 'Command already registered, overwriting');
    }
    this.commands.set(command.name, command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias, command.name);
      }
    }
  }

  find(name: string): Command | undefined {
    if (this.commands.has(name)) return this.commands.get(name);
    const canonical = this.aliases.get(name);
    if (canonical) return this.commands.get(canonical);
    return undefined;
  }

  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  getByCategory(): Map<string, Command[]> {
    const grouped = new Map<string, Command[]>();
    for (const cmd of this.commands.values()) {
      if (!grouped.has(cmd.category)) grouped.set(cmd.category, []);
      grouped.get(cmd.category)!.push(cmd);
    }
    return grouped;
  }

  async loadAll(): Promise<void> {
    const modulesDir = path.resolve(__dirname, '..', 'modules');
    try {
      const categories = await fs.readdir(modulesDir);
      for (const category of categories) {
        const categoryDir = path.join(modulesDir, category);
        const stat = await fs.stat(categoryDir);
        if (!stat.isDirectory()) continue;

        const files = await fs.readdir(categoryDir);
        for (const file of files) {
          if (!file.endsWith('.ts') && !file.endsWith('.js')) continue;
          if (file.endsWith('.d.ts')) continue;

          const filePath = path.join(categoryDir, file);
          try {
            const module = await import(`file://${filePath}`);
            if (module.default && typeof module.default === 'function') {
              const commands: Command[] | Command = await module.default();
              if (Array.isArray(commands)) {
                for (const cmd of commands) this.register(cmd);
              } else if (commands) {
                this.register(commands);
              }
            } else if (module.commands) {
              for (const cmd of module.commands) this.register(cmd);
            }
          } catch (err: any) {
            logger.error({ file, err: err?.message }, 'Failed to load command module');
          }
        }
      }
      logger.info({ count: this.commands.size }, 'All commands loaded');
    } catch (err: any) {
      logger.error({ err: err?.message }, 'Failed to read modules directory');
    }
  }
}
