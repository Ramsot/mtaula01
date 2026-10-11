import type { Command, CommandContext } from '../../core/types.js';

const NOTO_EMOJI = 'https://fonts.gstatic.com/s/e/notoemoji/latest';

/**
 * Fetch a single emoji's PNG from Google's Noto emoji CDN (no API key needed).
 * Sequence URLs (skin tones, ZWJ) are not always available, so we fall back to
 * the first codepoint, which always resolves.
 */
async function fetchEmojiPng(emoji: string): Promise<Buffer | null> {
  const cps = [...emoji].map(c => c.codePointAt(0)!.toString(16));
  const candidates = [cps.join('-'), cps[0]];

  for (const cp of candidates) {
    try {
      const res = await fetch(`${NOTO_EMOJI}/${cp}/512.png`, {
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > 0) return buf;
      }
    } catch {}
  }
  return null;
}

/** Compose two emoji PNGs side by side into one image. */
async function composeEmojimix(emojis: string[]): Promise<Buffer> {
  const { default: Jimp } = await import('jimp');

  const pngs = await Promise.all(emojis.map(fetchEmojiPng));
  const available = pngs.filter((b): b is Buffer => !!b);
  if (!available.length) throw new Error('Could not fetch emoji images');

  const size = 256;
  const canvas = new Jimp(available.length * size, size, 0x00000000);

  for (let i = 0; i < available.length; i++) {
    const img = await Jimp.read(available[i]);
    img.contain(size, size);
    canvas.composite(img, i * size, 0);
  }

  return canvas.getBufferAsync(Jimp.MIME_PNG);
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

/** Convert webp (sticker) to png: sharp first, then the `dwebp` CLI (installed in Docker). */
async function webpToPng(input: Buffer): Promise<Buffer> {
  try {
    const { default: sharp } = await import('sharp');
    return await sharp(input).png().toBuffer();
  } catch {}

  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const fs = await import('fs/promises');
  const os = await import('os');
  const path = await import('path');
  const run = promisify(execFile);

  const inPath = path.join(os.tmpdir(), `vo-${Date.now()}.webp`);
  const outPath = `${inPath}.png`;
  try {
    await fs.writeFile(inPath, input);
    await run('dwebp', [inPath, '-o', outPath]);
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(inPath, { force: true }).catch(() => {});
    await fs.rm(outPath, { force: true }).catch(() => {});
  }
}

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
          const media = await downloadMedia(ctx);
          if (!media) throw new Error('Failed to download media');

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

          // Stickers are webp; Jimp cannot decode webp, so convert explicitly.
          const png = await webpToPng(media);
          await ctx.m.send({ image: png, caption: '🖼️ Converted!' });
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
          const tmpIn = pathMod.join(os.tmpdir(), `in-${Date.now()}`);
          const tmpOut = `${tmpIn}.mp3`;
          await fsMod.writeFile(tmpIn, media);
          try {
            await new Promise<void>((resolve, reject) => {
              ffmpeg(tmpIn)
                .audioCodec('libmp3lame')
                .format('mp3')
                .on('end', () => resolve())
                .on('error', reject)
                .save(tmpOut);
            });
            const buffer = await fsMod.readFile(tmpOut);
            await ctx.m.send({ audio: buffer, mimetype: 'audio/mpeg', fileName: 'audio.mp3' });
            await ctx.m.react('✅').catch(() => {});
          } finally {
            await fsMod.unlink(tmpIn).catch(() => {});
            await fsMod.unlink(tmpOut).catch(() => {});
          }
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
          const { default: Jimp } = await import('jimp');
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
      aliases: ['mixemoji', 'emix'],
      category: 'converter',
      description: 'Mix two emojis',
      usage: '.emojimix 😂❤️',
      example: '.emojimix 😂❤️',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}emojimix 😂❤️`);

        const emojis = Array.from(ctx.text.replace(/\s+/g, '')).filter(ch => /\p{Extended_Pictographic}/u.test(ch));
        if (emojis.length < 2) return ctx.m.reply('Provide at least 2 emojis, e.g. .emojimix 😂❤️');

        await ctx.m.react('⏳').catch(() => {});
        try {
          // Local composition from Noto emoji PNGs — no API key required.
          const png = await composeEmojimix(emojis.slice(0, 3));
          await ctx.m.send({ image: png, caption: `Emoji mix: ${emojis.slice(0, 3).join(' + ')}` });
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
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

          const { default: Jimp } = await import('jimp');
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
