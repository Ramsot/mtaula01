import type { Command, CommandContext } from '../../core/types.js';

export default function antiDeleteCommands(): Command[] {
  return [
    {
      name: 'antidelete',
      aliases: ['adel', 'anticdelete', 'antidel'],
      category: 'media',
      description: 'Toggle anti-delete (auto-forward deleted messages to owner)',
      example: '.antidelete on/off',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        const on = ctx.args[0] === 'on';
        (globalThis as any).__antiDelete = on;
        await ctx.m.reply(
          `✅ *Anti-Delete ${on ? 'ENABLED' : 'DISABLED'}*\n\n` +
          (on
            ? '🔓 All deleted messages will be captured and forwarded to your inbox.\n\n' +
              '📋 Features:\n' +
              '• Text messages\n' +
              '• Images & videos\n' +
              '• Voice notes\n' +
              '• Documents\n' +
              '• Stickers\n' +
              '• View-once media\n' +
              '• Status deletes\n\n' +
              '⚠️ Works in both private and group chats.'
            : '🔒 Anti-delete disabled. No more delete monitoring.')
        );
      },
    },
    {
      name: 'antideletestatus',
      aliases: ['adelstatus'],
      category: 'media',
      description: 'Toggle anti-delete for status/updates only',
      example: '.antideletestatus on/off',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        const on = ctx.args[0] === 'on';
        (globalThis as any).__antiDeleteStatus = on;
        await ctx.m.reply(
          `✅ *Anti-Delete Status ${on ? 'ENABLED' : 'DISABLED'}*\n\n` +
          (on
            ? '🔓 Deleted status updates will be saved and forwarded to you.'
            : '🔒 Status delete monitoring disabled.')
        );
      },
    },
    {
      name: 'del',
      aliases: ['delete'],
      category: 'media',
      description: 'Delete a message for everyone',
      example: '.del (reply to message)',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        const target = ctx.m.quoted;
        if (!target) {
          await ctx.m.reply(`Reply to a message with ${ctx.prefix}del to delete it for everyone.`);
          return;
        }
        await ctx.sock.sendMessage(ctx.m.from, { delete: target.key });
        await ctx.m.reply('✅ Message deleted for everyone.');
      },
    },
  ];
}
