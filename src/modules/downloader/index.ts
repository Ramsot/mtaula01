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
        await ctx.m.reply('🔍 Searching...');

        try {
          const play = (await import('play-dl')).default;
          let videoUrl = ctx.text;

          if (!ctx.text.includes('youtube.com') && !ctx.text.includes('youtu.be')) {
            const results = await play.search(ctx.text, { limit: 1 });
            if (!results.length) throw new Error('No results found');
            videoUrl = results[0].url;
          }

          const info = await play.video_info(videoUrl);
          const title = info.video_details.title;
          const duration = info.video_details.durationRaw;
          const thumbnail = info.video_details.thumbnails?.[0]?.url;
          const views = info.video_details.views?.toLocaleString();
          const channel = info.video_details.channel?.name;

          await ctx.m.send({
            image: { url: thumbnail },
            caption: `🎵 *Downloading Audio*\n\n📝 Title: ${title}\n👤 Channel: ${channel}\n⏱️ Duration: ${duration}\n👁️ Views: ${views}`,
          });

          // Get audio stream
          const stream = await play.stream(videoUrl, { quality: 2 });
          const chunks: Buffer[] = [];
          stream.stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          await new Promise((resolve) => stream.stream.on('end', resolve));
          const buffer = Buffer.concat(chunks);

          await ctx.m.send({
            audio: buffer,
            mimetype: 'audio/mpeg',
            fileName: `${title}.mp3`,
          });

          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Download error: ${err?.message}`);
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
        await ctx.m.reply('🔍 Searching...');

        try {
          const play = (await import('play-dl')).default;
          let videoUrl = ctx.text;

          if (!ctx.text.includes('youtube.com') && !ctx.text.includes('youtu.be')) {
            const results = await play.search(ctx.text, { limit: 1 });
            if (!results.length) throw new Error('No results found');
            videoUrl = results[0].url;
          }

          const info = await play.video_info(videoUrl);
          const title = info.video_details.title;
          const thumbnail = info.video_details.thumbnails?.[0]?.url;

          await ctx.m.send({
            image: { url: thumbnail },
            caption: `🎬 *Downloading Video*: ${title}\n⚠️ Large videos may fail on WhatsApp`,
          });

          // Get video stream
          const stream = await play.stream(videoUrl, { quality: 1 });
          const chunks: Buffer[] = [];
          stream.stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          await new Promise((resolve) => stream.stream.on('end', resolve));
          const buffer = Buffer.concat(chunks);

          await ctx.m.send({
            video: buffer,
            mimetype: 'video/mp4',
            fileName: `${title}.mp4`,
            caption: `🎬 ${title}`,
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
          const response = await fetch(
            `https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(ctx.text)}`
          );
          const data: any = await response.json();
          if (!data.video?.nowm) throw new Error('Failed to get video');

          await ctx.m.send({
            video: { url: data.video.nowm },
            caption: `🎬 *TikTok Download*\n\n👤 Author: ${data.author?.name || 'Unknown'}\n📝 Title: ${(data.title || '').slice(0, 200)}`,
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
            `https://api.downloaderapi.com/instagram?url=${encodeURIComponent(ctx.text)}`
          );
          const data: any = await response.json();
          if (!data.url_list?.length) throw new Error('Failed to get media');

          for (const url of data.url_list.slice(0, 4)) {
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
