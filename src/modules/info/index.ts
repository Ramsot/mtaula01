import config from '../../config/index.js';
import { formatUptime, formatBytes } from '../../core/serializer.js';
import type { Command, CommandContext, CommandCategory } from '../../core/types.js';
import os from 'os';

const CATEGORY_EMOJI: Record<string, string> = {
  main: '🏠',
  ai: '🤖',
  downloader: '📥',
  group: '👥',
  fun: '🎮',
  tools: '🛠️',
  search: '🔍',
  converter: '🔄',
  owner: '👑',
  media: '🎨',
};

const CATEGORY_LABELS: Record<string, string> = {
  main: 'MAIN',
  ai: 'AI & CHATBOT',
  downloader: 'DOWNLOADER',
  group: 'GROUP',
  fun: 'FUN & GAMES',
  tools: 'TOOLS',
  search: 'SEARCH',
  converter: 'CONVERTER',
  owner: 'OWNER',
  media: 'MEDIA AI',
};

export default function infoCommands(): Command[] {
  return [
    {
      name: 'ping',
      aliases: ['p'],
      category: 'main',
      description: 'Check bot response time',
      execute: async (ctx: CommandContext) => {
        const start = Date.now();
        await ctx.m.reply('🏓 Pinging...');
        const time = Date.now() - start;
        await ctx.m.send({ text: `🏓 Pong! ${time}ms` });
      },
    },
    {
      name: 'uptime',
      aliases: ['runtime'],
      category: 'main',
      description: 'Check bot uptime',
      execute: async (ctx: CommandContext) => {
        await ctx.m.reply(`⏱️ Uptime: ${formatUptime(process.uptime())}`);
      },
    },
    {
      name: 'alive',
      category: 'main',
      description: 'Check if bot is alive',
      execute: async (ctx: CommandContext) => {
        const uptime = formatUptime(process.uptime());
        await ctx.m.reply(
          `🤖 *${config.BOT_NAME} is alive!*\n\n` +
          `✅ Status: Online\n` +
          `⏱️ Uptime: ${uptime}\n` +
          `📱 Prefix: ${config.PREFIX}\n` +
          `🔧 Mode: ${config.MODE}`
        );
      },
    },
    {
      name: 'info',
      aliases: ['botinfo'],
      category: 'main',
      description: 'Show bot information',
      execute: async (ctx: CommandContext) => {
        const mem = process.memoryUsage();
        await ctx.m.reply(
          `🤖 *${config.BOT_NAME} Info*\n\n` +
          `📛 Name: ${config.BOT_NAME}\n` +
          `📦 Version: 2.0.0\n` +
          `👑 Owner: ${config.OWNER_NAME}\n` +
          `🔧 Mode: ${config.MODE}\n` +
          `📱 Prefix: ${config.PREFIX}\n` +
          `⚙️ Runtime: Node.js ${process.version}\n` +
          `💾 Memory: ${formatBytes(mem.heapUsed)}\n` +
          `⏰ Uptime: ${formatUptime(process.uptime())}\n` +
          `📊 Commands: ${ctx.registry.getAll().length}`
        );
      },
    },
    {
      name: 'sysinfo',
      aliases: ['stats', 'system'],
      category: 'main',
      description: 'Show system information',
      execute: async (ctx: CommandContext) => {
        const cpus = os.cpus();
        const mem = os.totalmem();
        const free = os.freemem();
        const load = os.loadavg();
        const memUsed = ((mem - free) / mem * 100).toFixed(1);
        await ctx.m.reply(
          `💻 *System Info*\n\n` +
          `🖥️ CPU: ${cpus[0]?.model || 'Unknown'}\n` +
          `📊 Cores: ${cpus.length}\n` +
          `📈 Load: ${load.map(l => l.toFixed(2)).join(', ')}\n` +
          `💾 RAM: ${formatBytes(free)} free / ${formatBytes(mem)} total (${memUsed}% used)\n` +
          `🐧 Platform: ${os.platform()} ${os.release()}\n` +
          `📁 Uptime: ${formatUptime(os.uptime())}\n` +
          `⚙️ Node: ${process.version}\n` +
          `📊 Heap: ${formatBytes(process.memoryUsage().heapUsed)}`
        );
      },
    },
    {
      name: 'menu',
      aliases: ['commands', 'allmenu'],
      category: 'main',
      description: 'Show all available commands',
      example: '.menu | .menu ai | .menu ping',
      execute: async (ctx: CommandContext) => {
        const allCommands = ctx.registry.getAll();
        const grouped = ctx.registry.getByCategory();

        const filter = ctx.args[0]?.toLowerCase();

        if (filter) {
          // `.menu <command>` → show details for that command
          const one = ctx.registry.find(filter);
          if (one && !grouped.has(filter)) {
            let help = `📖 *${config.PREFIX}${one.name}*\n\n`;
            help += `📝 Description: ${one.description}\n`;
            if (one.aliases?.length) help += `🔗 Aliases: ${one.aliases.join(', ')}\n`;
            if (one.usage) help += `📋 Usage: ${one.usage}\n`;
            if (one.example) help += `💡 Example: ${one.example}\n`;
            help += `📂 Category: ${CATEGORY_LABELS[one.category] || one.category}`;
            await ctx.m.reply(help);
            return;
          }
          if (!grouped.has(filter)) {
            await ctx.m.reply(`❓ No category or command named "${filter}".\nTry ${config.PREFIX}menu`);
            return;
          }
        }

        let menu = `┌─❍ *${config.BOT_NAME}*
│ 📱 Prefix: ${config.PREFIX}
│ 👑 Owner: ${config.OWNER_NAME}
│ 🔧 Mode: ${config.MODE}
│ ⏱️ Uptime: ${formatUptime(process.uptime())}
│ 📊 Commands: ${allCommands.length}
└─────────────

`;

        for (const [category, commands] of grouped) {
          if (filter && category !== filter) continue;
          const emoji = CATEGORY_EMOJI[category] || '📁';
          const label = CATEGORY_LABELS[category] || category.toUpperCase();
          menu += `${emoji} *${label}*\n`;
          for (const cmd of commands) {
            menu += `  • ${config.PREFIX}${cmd.name}`;
            if (cmd.aliases?.length) menu += ` (${cmd.aliases.join(', ')})`;
            menu += `\n`;
          }
          menu += `\n`;
        }

        menu += `💡 Type ${config.PREFIX}menu <category> to filter\n`;
        menu += `📖 Type ${config.PREFIX}help <command> for details`;

        await ctx.m.reply(menu);
      },
    },
    {
      name: 'help',
      aliases: ['h'],
      category: 'main',
      description: 'Get help for a specific command',
      example: '.help ping',
      execute: async (ctx: CommandContext) => {
        const registry = ctx.registry;
        if (!ctx.args[0]) {
          await ctx.m.reply(`💡 Use ${config.PREFIX}menu to see all commands.\nUse ${config.PREFIX}help <command> for details.`);
          return;
        }

        const command = registry?.find(ctx.args[0].toLowerCase());
        if (!command) {
          await ctx.m.reply(`❓ Command not found: ${ctx.args[0]}`);
          return;
        }

        let help = `📖 *${config.PREFIX}${command.name}*\n\n`;
        help += `📝 Description: ${command.description}\n`;
        if (command.aliases?.length) help += `🔗 Aliases: ${command.aliases.join(', ')}\n`;
        if (command.usage) help += `📋 Usage: ${command.usage}\n`;
        if (command.example) help += `💡 Example: ${command.example}\n`;
        help += `📂 Category: ${CATEGORY_LABELS[command.category] || command.category}`;

        await ctx.m.reply(help);
      },
    },
    {
      name: 'owner',
      aliases: ['creator'],
      category: 'main',
      description: 'Show bot owner info',
      execute: async (ctx: CommandContext) => {
        await ctx.m.reply(
          `👑 *Bot Owner*\n\n` +
          `📛 Name: ${config.OWNER_NAME}\n` +
          `📱 Number: ${config.OWNER_NUMBER || 'Not set'}\n` +
          `🤖 Bot: ${config.BOT_NAME}`
        );
      },
    },
  ];
}
