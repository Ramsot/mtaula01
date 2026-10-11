import type { Command, CommandContext } from '../../core/types.js';

export default function downloadCommands(): Command[] {
  return [
    {
      name: 'play',
      aliases: ['ytmp3', 'song', 'music'],
      category: 'downloader',
      description: 'Download YouTube audio',
      example: '.play Shape of You',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}play <song name or URL>`);

        await ctx.m.react('⏳').catch(() => {});

        try {
          const { ytSearch, ytVideoInfo } = await import('../../utils/youtube.js');

          let videoUrl = ctx.text;
          if (!/youtube\.com|youtu\.be/.test(ctx.text)) {
            const results = await ytSearch(ctx.text, 1);
            if (!results.length) throw new Error('No results found');
            videoUrl = results[0].url;
          }

          const info = await ytVideoInfo(videoUrl);
          if (!info) throw new Error('Could not read video info');
          await ctx.m.reply(
            `🎵 *Downloading Audio*\n\n📝 Title: ${info.title}\n👤 Channel: ${info.channel}${info.durationRaw ? `\n⏱️ ${info.durationRaw}` : ''}${info.views ? `\n👁️ ${info.views.toLocaleString()} views` : ''}`
          );

          const play = (await import('play-dl')).default;
          const stream = await play.stream(videoUrl, { quality: 2 });
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            stream.stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.stream.on('end', () => resolve());
            stream.stream.on('error', reject);
          });
          const buffer = Buffer.concat(chunks);
          if (!buffer.length) throw new Error('Empty audio stream');

          await ctx.m.send({
            audio: buffer,
            mimetype: 'audio/webm',
            fileName: `${info.title.replace(/[\\/:*?"<>|]/g, '')}.webm`,
          });

          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Download error: ${err?.message}\n\n💡 Try a shorter/older video, or use ${ctx.prefix}yts to pick a specific result.`);
        }
      },
    },
    {
      name: 'ytmp4',
      aliases: ['ytvideo', 'video'],
      category: 'downloader',
      description: 'Download YouTube video',
      example: '.ytmp4 https://youtube.com/watch?v=XXXX',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}ytmp4 <URL or search>`);

        await ctx.m.react('⏳').catch(() => {});

        try {
          const { ytSearch, ytVideoInfo } = await import('../../utils/youtube.js');

          let videoUrl = ctx.text;
          if (!/youtube\.com|youtu\.be/.test(ctx.text)) {
            const results = await ytSearch(ctx.text, 1);
            if (!results.length) throw new Error('No results found');
            videoUrl = results[0].url;
          }

          const info = await ytVideoInfo(videoUrl);
          if (!info) throw new Error('Could not read video info');
          await ctx.m.reply(`🎬 *Downloading Video*: ${info.title}\n⚠️ Large videos may fail on WhatsApp`);

          const play = (await import('play-dl')).default;
          const stream = await play.stream(videoUrl, { quality: 1 });
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            stream.stream.on('data', (chunk: Buffer) => chunks.push(chunk));
            stream.stream.on('end', () => resolve());
            stream.stream.on('error', reject);
          });
          const buffer = Buffer.concat(chunks);
          if (!buffer.length) throw new Error('Empty video stream');

          await ctx.m.send({
            video: buffer,
            mimetype: 'video/mp4',
            fileName: `${info.title.replace(/[\\/:*?"<>|]/g, '')}.mp4`,
            caption: `🎬 ${info.title}`,
          });

          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Download error: ${err?.message}\n\n💡 Try a shorter video.`);
        }
      },
    },
    {
      name: 'tiktok',
      aliases: ['tt'],
      category: 'downloader',
      description: 'Download TikTok video',
      example: '.tiktok https://tiktok.com/@user/video/XXXX',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}tiktok <URL>`);
        if (!ctx.text.includes('tiktok.com')) return ctx.m.reply('❌ Invalid TikTok URL');

        await ctx.m.react('⏳').catch(() => {});
        try {
          // tiklydown.eu.org has been unreliable; tikwm is the primary now.
          let data: any = null;
          for (const endpoint of [
            `https://www.tikwm.com/api/?url=${encodeURIComponent(ctx.text)}`,
            `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(ctx.text)}`,
          ]) {
            try {
              const response = await fetch(endpoint, {
                headers: { 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(25000),
              });
              const json: any = await response.json();
              const videoUrl = json?.data?.play || json?.data?.hdplay || json?.video?.nowm;
              if (videoUrl) {
                data = {
                  videoUrl,
                  author: json?.data?.author?.nickname || json?.author?.name,
                  title: json?.data?.title || json?.title,
                };
                break;
              }
            } catch {}
          }
          if (!data) throw new Error('Failed to get video (links may be expired)');

          await ctx.m.send({
            video: { url: data.videoUrl },
            caption: `🎬 *TikTok Download*\n\n👤 Author: ${data.author || 'Unknown'}\n📝 Title: ${(data.title || '').slice(0, 200)}`,
          });
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Download error: ${err?.message}`);
        }
      },
    },
    {
      name: 'instagram',
      aliases: ['ig', 'igdl'],
      category: 'downloader',
      description: 'Download Instagram content',
      example: '.ig https://instagram.com/reel/XXXX',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}ig <URL>`);
        if (!ctx.text.includes('instagram.com')) return ctx.m.reply('❌ Invalid Instagram URL');

        await ctx.m.react('⏳').catch(() => {});
        try {
          const response = await fetch(
            `https://api.downloaderapi.com/instagram?url=${encodeURIComponent(ctx.text)}`,
            { signal: AbortSignal.timeout(25000) }
          );
          const data: any = await response.json();
          const urls: string[] = data.url_list || [];
          if (!urls.length) {
            throw new Error('Failed to get media (Instagram may require login for this post)');
          }

          for (const url of urls.slice(0, 4)) {
            if (url.includes('.mp4')) {
              await ctx.m.send({ video: { url } });
            } else {
              await ctx.m.send({ image: { url } });
            }
          }
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Download error: ${err?.message}`);
        }
      },
    },
    {
      name: 'facebook',
      aliases: ['fb', 'fbdl'],
      category: 'downloader',
      description: 'Download Facebook video',
      example: '.fb https://facebook.com/watch/XXXX',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}fb <URL>`);
        if (!ctx.text.includes('facebook.com')) return ctx.m.reply('❌ Invalid Facebook URL');

        await ctx.m.react('⏳').catch(() => {});
        try {
          const response = await fetch(
            `https://api.downloaderapi.com/facebook?url=${encodeURIComponent(ctx.text)}`
          );
          const data: any = await response.json();
          const videoUrl = data.url || data.links?.[0]?.url;
          if (!videoUrl) throw new Error('Failed to get video');

          await ctx.m.send({ video: { url: videoUrl }, caption: '🎬 Facebook Video' });
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Download error: ${err?.message}`);
        }
      },
    },
    {
      name: 'twitter',
      aliases: ['x', 'xdl'],
      category: 'downloader',
      description: 'Download Twitter/X content',
      example: '.twitter https://x.com/user/status/XXXX',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}twitter <URL>`);

        await ctx.m.react('⏳').catch(() => {});
        try {
          const response = await fetch(
            `https://api.vxtwitter.com/${ctx.text.replace('https://', '')}`
          );
          const data: any = await response.json();
          if (!data.mediaURLs?.length) throw new Error('No media found');

          for (const url of data.mediaURLs.slice(0, 3)) {
            if (url.includes('.mp4')) {
              await ctx.m.send({ video: { url }, caption: data.text?.slice(0, 200) });
            } else {
              await ctx.m.send({ image: { url } });
            }
          }
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Download error: ${err?.message}`);
        }
      },
    },
    {
      name: 'mediafire',
      aliases: ['mfdl'],
      category: 'downloader',
      description: 'Download from MediaFire',
      example: '.mediafire https://mediafire.com/file/XXXX',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}mediafire <URL>`);

        await ctx.m.react('⏳').catch(() => {});
        try {
          const response = await fetch(
            `https://api-downloader.vercel.app/api/mediafire?url=${encodeURIComponent(ctx.text)}`
          );
          const data: any = await response.json();
          if (!data.url) throw new Error('Failed to get download URL');

          await ctx.m.send({
            document: { url: data.url },
            fileName: data.filename || 'download',
            caption: `📥 MediaFire: ${data.filename}`,
          });
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Download error: ${err?.message}`);
        }
      },
    },
    {
      name: 'gitclone',
      aliases: ['github', 'clone'],
      category: 'downloader',
      description: 'Download GitHub repository as ZIP',
      example: '.gitclone https://github.com/user/repo',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}gitclone <github URL>`);
        if (!ctx.text.includes('github.com')) return ctx.m.reply('❌ Invalid GitHub URL');

        await ctx.m.react('⏳').catch(() => {});
        try {
          const zipUrl = ctx.text.replace('github.com', 'codeload.github.com').replace(/\/$/, '') + '/zip/refs/heads/main';
          await ctx.m.send({
            document: { url: zipUrl },
            fileName: `${ctx.text.split('/').pop()}.zip`,
            caption: `📦 GitHub Repository: ${ctx.text}`,
          });
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Download error: ${err?.message}`);
        }
      },
    },
    {
      name: 'apk',
      aliases: ['playstore'],
      category: 'downloader',
      description: 'Download APK from Play Store',
      example: '.apk WhatsApp',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}apk <app name>`);
        await ctx.m.reply('📱 APK download requires external API. Use: https://apkcombo.com');
      },
    },
  ];
}
