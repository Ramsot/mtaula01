import config from '../../config/index.js';
import type { Command, CommandContext } from '../../core/types.js';

export default function converterCommands(): Command[] {
  return [
    {
      name: 'sticker',
      aliases: ['s', 'stiker'],
      category: 'converter',
      description: 'Convert image/video to sticker',
      example: '.sticker (reply to image/video)',
      execute: async (ctx: CommandContext) => {
        const target = ctx.m.quoted;
        if (!target || !['image', 'video'].includes(target.type)) {
          return ctx.m.reply(`Reply to an image or video with ${ctx.prefix}sticker`);
        }

        await ctx.m.react('⏳').catch(() => {});
        try {
          // Download media
          const media = await downloadMedia(ctx);
          if (!media) throw new Error('Failed to download media');

          // Use wa-sticker-formatter
          const { Sticker, StickerTypes } = await import('wa-sticker-formatter');
          const sticker = new Sticker(media, {
            pack: 'Mtaula 01',
            author: 'Bot',
            type: StickerTypes.FULL,
            quality: 50,
            background: '#00000000',
          });

          const buffer = await sticker.toBuffer();
          await ctx.m.send({ sticker: buffer });
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Sticker error: ${err?.message}`);
        }
      },
    },
    {
      name: 'toimg',
      aliases: ['toimage', 'img'],
      category: 'converter',
      description: 'Convert sticker to image',
      example: '.toimg (reply to sticker)',
      execute: async (ctx: CommandContext) => {
        const target = ctx.m.quoted;
        if (!target || target.type !== 'sticker') {
          return ctx.m.reply(`Reply to a sticker with ${ctx.prefix}toimg`);
        }

        await ctx.m.react('⏳').catch(() => {});
        try {
          const media = await downloadMedia(ctx);
          if (!media) throw new Error('Failed to download media');

          const Jimp = (await import('jimp')).default;
          const image = Jimp.read(media);
          const buffer = await (await image).getBufferAsync(Jimp.MIME_PNG);
          await ctx.m.send({ image: buffer, caption: '🖼️ Converted!' });
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Conversion error: ${err?.message}`);
        }
      },
    },
    {
      name: 'tomp3',
      aliases: ['audio', 'toaudio'],
      category: 'converter',
      description: 'Convert video to audio',
      example: '.tomp3 (reply to video)',
      execute: async (ctx: CommandContext) => {
        const target = ctx.m.quoted;
        if (!target || target.type !== 'video') {
          return ctx.m.reply(`Reply to a video with ${ctx.prefix}tomp3`);
        }

        await ctx.m.react('⏳').catch(() => {});
        try {
          const media = await downloadMedia(ctx);
          if (!media) throw new Error('Failed to download media');

          const fsMod = await import('fs/promises');
          const os = await import('os');
          const pathMod = await import('path');
          const ffmpeg = (await import('fluent-ffmpeg')).default;
          const tmpIn = pathMod.join(os.tmpdir(), 'in-' + Date.now());
          const tmpOut = tmpIn + '.mp3';
          await fsMod.writeFile(tmpIn, media);
          await new Promise<void>((resolve, reject) => {
            ffmpeg(tmpIn)
              .audioCodec('libmp3lame')
              .format('mp3')
              .on('end', () => resolve())
              .on('error', reject)
              .save(tmpOut);
          });
          const buffer = await fsMod.readFile(tmpOut);
          await fsMod.unlink(tmpIn).catch(() => {});
          await fsMod.unlink(tmpOut).catch(() => {});
          await ctx.m.send({ audio: buffer, mimetype: 'audio/mpeg', fileName: 'audio.mp3' });
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Conversion error: ${err?.message}`);
        }
      },
    },
    {
      name: 'tovideo',
      aliases: ['tomp4', 'togif'],
      category: 'converter',
      description: 'Convert GIF/sticker to video',
      example: '.tovideo (reply to sticker)',
      execute: async (ctx: CommandContext) => {
        await ctx.m.reply('🎬 Video conversion from stickers is limited. Use online tools for better results.');
      },
    },
    {
      name: 'attp',
      aliases: ['text2image'],
      category: 'converter',
      description: 'Convert text to animated sticker',
      example: '.attp Hello World',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}attp <text>`);

        await ctx.m.react('⏳').catch(() => {});
        try {
          const Jimp = (await import('jimp')).default;
          const image = new Jimp(800, 300, 0xffffffff);
          const font = await Jimp.loadFont(Jimp.FONT_SANS_64_BLACK);
          const textWidth = Jimp.measureText(font, ctx.text);
          const x = Math.floor((800 - textWidth) / 2);
          const y = Math.floor((300 - 64) / 2);
          image.print(font, x, y, { text: ctx.text, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER }, 800, 300);

          const buffer = await image.getBufferAsync(Jimp.MIME_PNG);

          const { Sticker, StickerTypes } = await import('wa-sticker-formatter');
          const sticker = new Sticker(buffer, {
            pack: 'ATTP',
            author: 'Mtaula 01',
            type: StickerTypes.FULL,
            quality: 50,
          });
          const stickerBuffer = await sticker.toBuffer();
          await ctx.m.send({ sticker: stickerBuffer });
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Error: ${err?.message}`);
        }
      },
    },
    {
      name: 'emojimix',
      aliases: ['mixemoji', 'emojimix'],
      category: 'converter',
      description: 'Mix two emojis',
      example: '.emojimix 😂❤️',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}emojimix 😂❤️`);
        const emojis = ctx.text.split(/\s+/).filter(Boolean);
        if (emojis.length !== 2) return ctx.m.reply('Provide exactly 2 emojis');

        try {
          const tenorKey = config.TENOR_KEY || 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCl0';
          const url = `https://tenor.googleapis.com/v2/featured?key=${tenorKey}&q=${encodeURIComponent(emojis.join('&'))}&client_key=my_project&component=proactive&country=US&media_filter=png_transparent&proactive=client&roies=1&collection=emoji_kitchen_v5`;
          await ctx.m.send({ image: { url } });
        } catch (err: any) {
          await ctx.m.reply(`❌ Error: ${err?.message}`);
        }
      },
    },
    {
      name: 'blur',
      category: 'converter',
      description: 'Blur an image',
      example: '.blur (reply to image)',
      execute: async (ctx: CommandContext) => {
        const target = ctx.m.quoted;
        if (!target || target.type !== 'image') {
          return ctx.m.reply(`Reply to an image with ${ctx.prefix}blur`);
        }

        await ctx.m.react('⏳').catch(() => {});
        try {
          const media = await downloadMedia(ctx);
          if (!media) throw new Error('Failed to download media');

          const Jimp = (await import('jimp')).default;
          const image = await Jimp.read(media);
          image.blur(10);
          const buffer = await image.getBufferAsync(Jimp.MIME_JPEG);
          await ctx.m.send({ image: buffer, caption: '🌫️ Blurred!' });
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Error: ${err?.message}`);
        }
      },
    },
  ];
}

async function downloadMedia(ctx: CommandContext): Promise<Buffer | null> {
  try {
    const target = ctx.m.quoted || ctx.m;
    const type = target.type;
    let media: any;

    if (type === 'image') {
      media = target.message?.imageMessage;
    } else if (type === 'video') {
      media = target.message?.videoMessage;
    } else if (type === 'sticker') {
      media = target.message?.stickerMessage;
    } else {
      return null;
    }

    if (!media) return null;

    const { downloadMediaMessage } = await import('baileys');
    const buffer = await downloadMediaMessage(
      target as any,
      'buffer',
      {},
      { logger: ctx.logger, reuploadRequest: ctx.sock.updateMediaMessage }
    );
    return buffer as Buffer;
  } catch (err) {
    ctx.logger?.error?.({ err }, 'Failed to download media');
    return null;
  }
}
