import config from '../../config/index.js';
import type { Command, CommandContext } from '../../core/types.js';

export default function ownerCommands(): Command[] {
  return [
    {
      name: 'broadcast',
      aliases: ['bc'],
      category: 'owner',
      description: 'Broadcast a message to all chats',
      example: '.broadcast Hello everyone!',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        if (!ctx.text) {
          await ctx.m.reply(`Usage: ${ctx.prefix}broadcast <message>`);
          return;
        }

        await ctx.m.reply('📢 Broadcasting...');
        const chats = [ctx.m.from];
        let success = 0;
        let failed = 0;

        for (const chat of chats) {
          try {
            await ctx.sock.sendMessage(chat, { text: `📢 *Broadcast*\n\n${ctx.text}` });
            success++;
          } catch {
            failed++;
          }
        }

        await ctx.m.reply(`✅ Broadcast complete!\n📨 Sent: ${success}\n❌ Failed: ${failed}`);
      },
    },
    {
      name: 'block',
      category: 'owner',
      description: 'Block a user',
      usage: '.block @user | .block 255XXXXXXXXX',
      example: '.block @user',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        const number = ctx.args[0]?.replace(/\D/g, '');
        const target = ctx.m.mentionedJid[0] || (number ? number + '@s.whatsapp.net' : '');
        if (!target) {
          await ctx.m.reply(`Usage: ${ctx.prefix}block @user or ${ctx.prefix}block 255XXXXXXXXX`);
          return;
        }
        await ctx.sock.updateBlockStatus(target, 'block');
        await ctx.m.reply(`✅ Blocked ${target.split('@')[0]}`);
      },
    },
    {
      name: 'unblock',
      category: 'owner',
      description: 'Unblock a user',
      usage: '.unblock @user | .unblock 255XXXXXXXXX',
      example: '.unblock @user',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        const number = ctx.args[0]?.replace(/\D/g, '');
        const target = ctx.m.mentionedJid[0] || (number ? number + '@s.whatsapp.net' : '');
        if (!target) {
          await ctx.m.reply(`Usage: ${ctx.prefix}unblock @user or ${ctx.prefix}unblock 255XXXXXXXXX`);
          return;
        }
        await ctx.sock.updateBlockStatus(target, 'unblock');
        await ctx.m.reply(`✅ Unblocked ${target.split('@')[0]}`);
      },
    },
    {
      name: 'setbotpp',
      aliases: ['setppbot'],
      category: 'owner',
      description: 'Set bot profile picture (reply to image)',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        const target = ctx.m.quoted || ctx.m;
        const msg = target.message as any;
        if (!msg?.imageMessage && !msg?.stickerMessage) {
          await ctx.m.reply(`Reply to an image with ${ctx.prefix}setbotpp`);
          return;
        }
        await ctx.m.reply('⏳ Setting profile picture...');
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
    {
      name: 'setname',
      aliases: ['setbotname', 'renamebot'],
      category: 'owner',
      description: 'Set bot name',
      example: '.setname MyBot',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        if (!ctx.text) {
          await ctx.m.reply(`Usage: ${ctx.prefix}setname <new name>`);
          return;
        }
        config.BOT_NAME = ctx.text;
        await ctx.m.reply(`✅ Bot name changed to: ${ctx.text}`);
      },
    },
    {
      name: 'join',
      category: 'owner',
      description: 'Join a group via invite link',
      example: '.join https://chat.whatsapp.com/XXXXX',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        if (!ctx.text.includes('chat.whatsapp.com')) {
          await ctx.m.reply(`Usage: ${ctx.prefix}join <group link>`);
          return;
        }
        try {
          const code = ctx.text.split('chat.whatsapp.com/')[1].split('/')[0];
          await ctx.sock.groupAcceptInvite(code);
          await ctx.m.reply('✅ Joined group!');
        } catch (err: any) {
          await ctx.m.reply(`❌ Failed: ${err?.message}`);
        }
      },
    },
    {
      name: 'leave',
      aliases: ['exit'],
      category: 'owner',
      description: 'Leave current group',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        if (!ctx.isGroup) {
          await ctx.m.reply('❌ This command only works in groups!');
          return;
        }
        await ctx.m.reply('👋 Leaving group...');
        await ctx.sock.groupLeave(ctx.m.from);
      },
    },
    {
      name: 'autotyping',
      aliases: ['typing'],
      category: 'owner',
      description: 'Toggle auto-typing indicator',
      example: '.autotyping on/off',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        const on = ctx.args[0] === 'on';
        config.AUTO_TYPING = on;
        await ctx.m.reply(`✅ Auto-typing ${on ? 'enabled' : 'disabled'}`);
      },
    },
    {
      name: 'alwaysonline',
      aliases: ['online'],
      category: 'owner',
      description: 'Toggle always online status',
      example: '.alwaysonline on/off',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        const on = ctx.args[0] === 'on';
        config.ALWAYS_ONLINE = on;
        if (on) {
          await ctx.sock.sendPresenceUpdate('available').catch(() => {});
        }
        await ctx.m.reply(`✅ Always online ${on ? 'enabled' : 'disabled'}`);
      },
    },
    {
      name: 'autoread',
      aliases: ['read'],
      category: 'owner',
      description: 'Toggle auto-read messages',
      example: '.autoread on/off',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        const on = ctx.args[0] === 'on';
        config.AUTO_READ = on;
        await ctx.m.reply(`✅ Auto-read ${on ? 'enabled' : 'disabled'}`);
      },
    },
    {
      name: 'mode',
      category: 'owner',
      description: 'Set bot mode (public/self)',
      example: '.mode public | .mode self',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        const mode = ctx.args[0]?.toLowerCase();
        if (!['public', 'self'].includes(mode)) {
          await ctx.m.reply(`Usage: ${ctx.prefix}mode public|self`);
          return;
        }
        config.MODE = mode;
        await ctx.m.reply(`✅ Mode set to: ${mode}`);
      },
    },
    {
      name: 'restart',
      aliases: ['reboot'],
      category: 'owner',
      description: 'Restart the bot',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        await ctx.m.reply('🔄 Restarting bot...');
        setTimeout(() => process.exit(0), 2000);
      },
    },
  ];
}
