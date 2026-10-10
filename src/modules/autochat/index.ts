import type { Command, CommandContext } from '../../core/types.js';

export default function autochatCommands(): Command[] {
  return [
    {
      name: 'autochat',
      aliases: ['autoresponder', 'aichat'],
      category: 'ai',
      description: 'Toggle AI auto-reply in private chats',
      example: '.autochat on/off',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only!');
          return;
        }
        const on = ctx.args[0] === 'on';
        (globalThis as any).__autoChat = on;
        await ctx.m.reply(
          `✅ *AI Auto-Chat ${on ? 'ENABLED' : 'DISABLED'}*\n\n` +
          (on
            ? '🤖 Bot will auto-reply to ALL private messages using AI.\n\n' +
              '💡 Features:\n' +
              '• Understands Swahili & English\n' +
              '• Remembers conversation context\n' +
              '• Responds like a human\n' +
              '• Handles images (describes them)\n' +
              '• No response to owner (avoids loops)\n\n' +
              '⚙️ Use .autochatgroup to enable in groups.'
            : '🔒 Auto-chat disabled.')
        );
      },
    },
    {
      name: 'autochatgroup',
      aliases: ['aichatgroup'],
      category: 'ai',
      description: 'Toggle AI auto-reply in groups (responds when mentioned or replied)',
      example: '.autochatgroup on/off',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only!');
          return;
        }
        const on = ctx.args[0] === 'on';
        (globalThis as any).__autoChatGroup = on;
        await ctx.m.reply(
          `✅ *AI Group Chat ${on ? 'ENABLED' : 'DISABLED'}*\n\n` +
          (on
            ? '🤖 Bot will respond in groups when:\n' +
              '• Someone mentions the bot\n' +
              '• Someone replies to bot message\n' +
              '• Anti-link triggers\n\n' +
              '⚠️ Bot will NOT respond to every group message (avoid spam).'
            : '🔒 Group auto-chat disabled.')
        );
      },
    },
    {
      name: 'setbio',
      aliases: ['setstatus'],
      category: 'ai',
      description: 'Set bot bio/about text',
      example: '.setbio Hello, I am a smart assistant!',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only!');
          return;
        }
        const bio = ctx.args.join(' ');
        if (!bio) {
          await ctx.m.reply(`Usage: ${ctx.prefix}setbio <text>`);
          return;
        }
        await ctx.sock.updateProfileStatus(bio);
        await ctx.m.reply(`✅ Bio updated:\n${bio}`);
      },
    },
    {
      name: 'setimg',
      aliases: ['setprofile', 'setpp'],
      category: 'ai',
      description: 'Set bot profile picture',
      example: '.setimg (send/reply to image)',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only!');
          return;
        }
        const target = ctx.m.quoted || ctx.m;
        const msg = target.message as any;
        if (!msg?.imageMessage && !msg?.stickerMessage) {
          await ctx.m.reply(`Reply to an image with ${ctx.prefix}setimg`);
          return;
        }
        try {
          const { downloadMediaMessage } = await import('baileys');
          const buffer = (await downloadMediaMessage(
            target as any,
            'buffer',
            {},
            { logger: ctx.logger, reuploadRequest: ctx.sock.updateMediaMessage }
          )) as Buffer;
          await ctx.sock.updateProfilePicture(ctx.sock.user!.id, buffer);
          await ctx.m.reply('✅ Profile picture updated!');
        } catch (err: any) {
          await ctx.m.reply(`❌ Failed: ${err?.message}`);
        }
      },
    },
  ];
}
