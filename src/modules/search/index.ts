import type { Command, CommandContext } from '../../core/types.js';

export default function searchCommands(): Command[] {
  return [
    {
      name: 'google',
      aliases: ['g', 'search'],
      category: 'search',
      description: 'Search on Google',
      example: '.google What is AI?',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}google <query>`);
        try {
          // @ts-ignore
          const { googleIt } = await import('google-it');
          const results: any[] = await googleIt({ query: ctx.text, limit: 5 });
          if (!results.length) return ctx.m.reply('❌ No results found');

          let text = `🔍 *Google Results for: ${ctx.text}*\n\n`;
          for (const [i, result] of results.entries()) {
            text += `${i + 1}. *${result.title}*\n${result.link}\n${result.snippet || ''}\n\n`;
          }
          await ctx.m.reply(text);
        } catch (err: any) {
          await ctx.m.reply(`❌ Search error: ${err?.message}`);
        }
      },
    },
    {
      name: 'yts',
      aliases: ['ytsearch', 'youtube'],
      category: 'search',
      description: 'Search YouTube',
      example: '.yts Tanzania music',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}yts <query>`);
        try {
          const play = (await import('play-dl')).default;
          const results = await play.search(ctx.text, { limit: 5 });
          if (!results.length) return ctx.m.reply('❌ No results found');

          let text = `🎬 *YouTube Results*\n\n`;
          for (const [i, video] of results.entries()) {
            text += `${i + 1}. *${video.title}*\n`;
            text += `   👤 ${video.channel?.name || 'Unknown'}\n`;
            text += `   👁️ ${video.views?.toLocaleString() || 'N/A'} views\n`;
            text += `   ⏱️ ${video.durationRaw || 'N/A'}\n`;
            text += `   🔗 ${video.url}\n\n`;
          }
          await ctx.m.reply(text);
        } catch (err: any) {
          await ctx.m.reply(`❌ YouTube search error: ${err?.message}`);
        }
      },
    },
    {
      name: 'lyrics',
      aliases: ['songlyrics', 'lyric'],
      category: 'search',
      description: 'Search song lyrics',
      example: '.lyrics Bohemian Rhapsody',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}lyrics <song title>`);
        try {
          const Genius = (await import('genius-lyrics')).default;
          const client = new Genius.Client();
          const songs: any[] = await (client.songs as any).search(ctx.text);
          if (!songs.length) return ctx.m.reply('❌ No lyrics found');

          const song = songs[0];
          const lyrics = await song.lyrics();
          await ctx.m.reply(
            `🎵 *${song.title}* by ${song.artist.name}\n\n` +
            `${lyrics.slice(0, 4000)}\n\n` +
            `🔗 ${song.url}`
          );
        } catch (err: any) {
          await ctx.m.reply(`❌ Lyrics error: ${err?.message}`);
        }
      },
    },
    {
      name: 'wikipedia',
      aliases: ['wiki'],
      category: 'search',
      description: 'Search Wikipedia',
      example: '.wikipedia Tanzania',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}wikipedia <topic>`);
        try {
          const wiki = (await import('wikipedia')).default;
          const page = await wiki.summary(ctx.text, { autoSuggest: true });
          await ctx.m.reply(
            `📚 *${page.title}*\n\n` +
            `${page.extract}\n\n` +
            `🔗 ${page.content_urls?.desktop?.page}`
          );
        } catch (err: any) {
          await ctx.m.reply(`❌ Wikipedia error: ${err?.message}`);
        }
      },
    },
    {
      name: 'imdb',
      aliases: ['movie', 'film'],
      category: 'search',
      description: 'Search movie/series info',
      example: '.imdb Inception',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}imdb <movie title>`);
        try {
          const response = await fetch(
            `https://www.omdbapi.com/?t=${encodeURIComponent(ctx.text)}&apikey=trilogy`
          );
          const data: any = await response.json();
          if (data.Response === 'False') return ctx.m.reply('❌ Movie not found');

          await ctx.m.reply(
            `🎬 *${data.Title}* (${data.Year})\n\n` +
            `⭐ Rating: ${data.imdbRating}/10\n` +
            `🎭 Genre: ${data.Genre}\n` +
            `🎬 Director: ${data.Director}\n` +
            `👥 Cast: ${data.Actors}\n` +
            `📝 Plot: ${data.Plot}\n` +
            `⏱️ Runtime: ${data.Runtime}\n` +
            `🏆 Awards: ${data.Awards}\n` +
            `🔗 https://www.imdb.com/title/${data.imdbID}`
          );
        } catch (err: any) {
          await ctx.m.reply(`❌ IMDB error: ${err?.message}`);
        }
      },
    },
    {
      name: 'pinterest',
      aliases: ['pin'],
      category: 'search',
      description: 'Search Pinterest images',
      example: '.pinterest beautiful sunset',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}pinterest <query>`);
        try {
          const response = await fetch(
            `https://api.pinterest.com/v5/search/pins?query=${encodeURIComponent(ctx.text)}&limit=5`
          );
          // Pinterest API requires auth, so we'll use a fallback
          await ctx.m.reply(
            `📌 *Pinterest Search*\n\n` +
            `🔍 ${ctx.text}\n\n` +
            `🔗 Search: https://www.pinterest.com/search/pins/?q=${encodeURIComponent(ctx.text)}`
          );
        } catch (err: any) {
          await ctx.m.reply(
            `📌 *Pinterest*\n\n` +
            `🔍 ${ctx.text}\n\n` +
            `🔗 https://www.pinterest.com/search/pins/?q=${encodeURIComponent(ctx.text)}`
          );
        }
      },
    },
    {
      name: 'wallpaper',
      aliases: ['wall'],
      category: 'search',
      description: 'Get a wallpaper',
      example: '.wallpaper nature',
      execute: async (ctx: CommandContext) => {
        const query = ctx.text || 'nature';
        try {
          const response = await fetch(
            `https://api.unsplash.com/photos/random?query=${encodeURIComponent(query)}&client_id=demo`
          );
          // Fallback to a static source
          await ctx.m.send({
            image: { url: `https://source.unsplash.com/random/1920x1080/?${encodeURIComponent(query)}` },
            caption: `🖼️ Wallpaper: ${query}`,
          });
        } catch {
          await ctx.m.reply(`🖼️ *Wallpaper Search*\n\n🔗 https://www.pexels.com/search/${encodeURIComponent(query)}/`);
        }
      },
    },
  ];
}
