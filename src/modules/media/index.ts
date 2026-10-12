import { setRuntimeSetting } from '../../core/settings.js';
import type { Command, CommandContext } from '../../core/types.js';

export default function viewOnceCommands(): Command[] {
  return [
    {
      name: 'saveviewonce',
      aliases: ['vo', 'svo', 'vv', 'savevv'],
      category: 'media',
      description: 'Save view-once media (image/video)',
      example: '.vo (reply to view-once image/video)',
      execute: async (ctx: CommandContext) => {
        const target = ctx.m.quoted || ctx.m;

        const media =
          target.message?.imageMessage?.viewOnce ||
          target.message?.videoMessage?.viewOnce ||
          target.message?.viewOnceMessage?.message?.imageMessage ||
          target.message?.viewOnceMessage?.message?.videoMessage ||
          target.message?.ephemeralMessage?.message?.imageMessage?.viewOnce ||
          target.message?.ephemeralMessage?.message?.videoMessage?.viewOnce;

        const hasMedia = !!(
          target.message?.imageMessage ||
          target.message?.videoMessage ||
          target.message?.viewOnceMessage ||
          target.message?.viewOnceMessageV2Extension ||
          target.message?.ephemeralMessage?.message?.imageMessage?.viewOnce ||
          target.message?.ephemeralMessage?.message?.videoMessage?.viewOnce
        );

        if (!hasMedia && !media) {
          await ctx.m.reply(
            `❌ Reply to a view-once image/video with ${ctx.prefix}vo\n\n` +
            `💡 Tip: Quote the disappearing message and send .vo`
          );
          return;
        }

        await ctx.m.react('⏳').catch(() => {});

        try {
          const { downloadMediaMessage } = await import('baileys');

          const buffer = (await downloadMediaMessage(
            target as any,
            'buffer',
            {},
            {
              logger: ctx.logger,
              reuploadRequest: ctx.sock.updateMediaMessage,
            }
          )) as Buffer;

          if (!buffer || buffer.length === 0) {
            throw new Error('Failed to download media');
          }

          const isVideo =
            !!target.message?.videoMessage ||
            !!target.message?.viewOnceMessage?.message?.videoMessage;

          const caption = `🔓 *View Once Saved!*\n\n👤 From: @${ctx.m.sender.split('@')[0]}`;

          if (isVideo) {
            await ctx.m.send(
              {
                video: buffer,
                mimetype: 'video/mp4',
                caption,
                mentions: [ctx.m.sender],
              }
            );
          } else {
            await ctx.m.send(
              {
                image: buffer,
                mimetype: 'image/jpeg',
                caption,
                mentions: [ctx.m.sender],
              }
            );
          }

          await ctx.m.react('✅').catch(() => {});
          ctx.logger?.info?.({ from: ctx.m.sender, type: isVideo ? 'video' : 'image' }, 'View once saved');
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(
            `❌ Failed to save view-once media: ${err?.message}\n\n` +
            `💡 Try again within a few seconds of receiving the message.`
          );
          ctx.logger?.error?.({ err: err?.message }, 'View once save failed');
        }
      },
    },
    {
      name: 'autovo',
      aliases: ['autoviewonce', 'autoss'],
      category: 'media',
      description: 'Toggle auto-save view-once media',
      example: '.autovo on/off',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        const on = ctx.args[0] === 'on';
        // Persisted so view-once capture survives a redeploy.
        setRuntimeSetting('autoViewOnce', on);
        await ctx.m.reply(
          `✅ Auto-save view-once ${on ? '**ENABLED**' : '**DISABLED**'}\n\n` +
          (on
            ? '🔓 All view-once media will be automatically saved and re-sent.'
            : '🔒 View-once media will no longer be auto-saved.')
        );
      },
    },
    {
      name: 'anticviewonce',
      aliases: ['anticvo'],
      category: 'media',
      description: 'Anti copy-view-once: Save and notify owner',
      example: '.anticvo on/off',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only command!');
          return;
        }
        const on = ctx.args[0] === 'on';
        // This flag used to be written to a global nothing ever read, so the
        // command was a no-op. It drives the same persisted switch as .autovo.
        setRuntimeSetting('autoViewOnce', on);
        await ctx.m.reply(
          `✅ Anti copy-view-once ${on ? '**ENABLED**' : '**DISABLED**'}\n\n` +
          (on
            ? '🔒 View-once media is saved and forwarded to the owner (same switch as .autovo).'
            : '🔓 Anti copy-view-once disabled.')
        );
      },
    },
  ];
}
