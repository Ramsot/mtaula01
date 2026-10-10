import type { Command, CommandContext } from '../../core/types.js';

export default function toolCommands(): Command[] {
  return [
    {
      name: 'calc',
      aliases: ['calculator', 'math'],
      category: 'tools',
      description: 'Calculate a math expression',
      example: '.calc 2 + 2 * 3',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}calc <expression>\nExample: ${ctx.prefix}calc 2 + 2`);
        try {
          const { evaluate } = await import('mathjs');
          const result = evaluate(ctx.text);
          await ctx.m.reply(`🧮 *Calculation*\n\n${ctx.text} = ${result}`);
        } catch (err: any) {
          await ctx.m.reply(`❌ Invalid expression: ${err?.message}`);
        }
      },
    },
    {
      name: 'tts',
      aliases: ['say', 'speak'],
      category: 'tools',
      description: 'Convert text to speech',
      example: '.tts Hello world',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}tts <text>`);
        try {
          const { getAudioUrl } = await import('google-tts-api');
          const lang = ctx.args[0]?.length === 2 && /^[a-z]{2}$/.test(ctx.args[0]) ? ctx.args[0] : 'en';
          const text = ctx.args[0]?.length === 2 && /^[a-z]{2}$/.test(ctx.args[0]) ? ctx.args.slice(1).join(' ') : ctx.text;
          const url = getAudioUrl(text, { lang, slow: false });
          await ctx.m.send({ audio: { url }, mimetype: 'audio/mpeg' });
        } catch (err: any) {
          await ctx.m.reply(`❌ TTS error: ${err?.message}`);
        }
      },
    },
    {
      name: 'trt',
      aliases: ['translate'],
      category: 'tools',
      description: 'Translate text',
      example: '.trt en Hello world',
      execute: async (ctx: CommandContext) => {
        if (!ctx.args[0] || !ctx.text) {
          return ctx.m.reply(`Usage: ${ctx.prefix}trt <lang> <text>\nExample: ${ctx.prefix}trt sw Hello`);
        }
        try {
          // @ts-ignore
          const translatte = (await import('translatte')).default;
          const lang = ctx.args[0];
          const text = ctx.args.slice(1).join(' ');
          const result = await translatte(text, { to: lang });
          await ctx.m.reply(`🌐 *Translation* (${lang})\n\n${result.text}`);
        } catch (err: any) {
          await ctx.m.reply(`❌ Translation error: ${err?.message}`);
        }
      },
    },
    {
      name: 'shorten',
      aliases: ['shorturl', 'tinyurl'],
      category: 'tools',
      description: 'Shorten a URL',
      example: '.shorten https://example.com',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}shorten <url>`);
        try {
          const response = await fetch(
            `https://tinyurl.com/api-create.php?url=${encodeURIComponent(ctx.text)}`
          );
          const shortUrl = await response.text();
          await ctx.m.reply(`🔗 *Shortened URL*\n\n${shortUrl}`);
        } catch (err: any) {
          await ctx.m.reply(`❌ Error: ${err?.message}`);
        }
      },
    },
    {
      name: 'base64',
      aliases: ['encode64', 'decode64'],
      category: 'tools',
      description: 'Encode/Decode base64',
      example: '.base64 encode Hello',
      execute: async (ctx: CommandContext) => {
        if (!ctx.args[0] || !ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}base64 encode/decode <text>`);
        const action = ctx.args[0].toLowerCase();
        const text = ctx.args.slice(1).join(' ');
        try {
          if (action === 'encode') {
            const encoded = Buffer.from(text).toString('base64');
            await ctx.m.reply(`🔐 *Base64 Encoded*\n\n${encoded}`);
          } else if (action === 'decode') {
            const decoded = Buffer.from(text, 'base64').toString('utf-8');
            await ctx.m.reply(`🔓 *Base64 Decoded*\n\n${decoded}`);
          } else {
            await ctx.m.reply(`Usage: ${ctx.prefix}base64 encode/decode <text>`);
          }
        } catch (err: any) {
          await ctx.m.reply(`❌ Error: ${err?.message}`);
        }
      },
    },
    {
      name: 'hash',
      aliases: ['md5', 'sha256'],
      category: 'tools',
      description: 'Generate hash of text',
      example: '.hash md5 Hello',
      execute: async (ctx: CommandContext) => {
        if (!ctx.args[0] || !ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}hash md5/sha256/sha1 <text>`);
        const type = ctx.args[0].toLowerCase();
        const text = ctx.args.slice(1).join(' ');
        try {
          const crypto = await import('crypto');
          const hash = crypto.createHash(type).update(text).digest('hex');
          await ctx.m.reply(`🔐 *${type.toUpperCase()} Hash*\n\n${hash}`);
        } catch (err: any) {
          await ctx.m.reply(`❌ Error: ${err?.message}`);
        }
      },
    },
    {
      name: 'tempmail',
      aliases: ['tmpmail'],
      category: 'tools',
      description: 'Get a temporary email address',
      execute: async (ctx: CommandContext) => {
        try {
          const response = await fetch('https://api.mail.tm/domains');
          const data: any = await response.json();
          const domain = data['hydra:member'][0]?.domain;
          if (!domain) throw new Error('No domain available');
          const random = Math.random().toString(36).substring(2, 10);
          const email = `${random}@${domain}`;
          await ctx.m.reply(
            `📧 *Temporary Email*\n\n` +
            `Address: ${email}\n\n` +
            `⚠️ Check inbox at https://mail.tm\n` +
            `⏰ Valid for ~10 minutes`
          );
        } catch (err: any) {
          await ctx.m.reply(`❌ Error: ${err?.message}`);
        }
      },
    },
    {
      name: 'weather',
      aliases: ['forecast'],
      category: 'tools',
      description: 'Get weather information',
      example: '.weather Dar es Salaam',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}weather <city>`);
        try {
          const response = await fetch(
            `https://wttr.in/${encodeURIComponent(ctx.text)}?format=j1`
          );
          const data: any = await response.json();
          const current = data.current_condition?.[0];
          const area = data.nearest_area?.[0];
          if (!current) throw new Error('No data');

          await ctx.m.reply(
            `🌤️ *Weather: ${area?.areaName?.[0]?.value || ctx.text}*\n\n` +
            `🌡️ Temperature: ${current.temp_C}°C (${current.temp_F}°F)\n` +
            `🤔 Feels like: ${current.FeelsLikeC}°C\n` +
            `💧 Humidity: ${current.humidity}%\n` +
            `💨 Wind: ${current.windspeedKmph} km/h ${current.winddir16Point}\n` +
            `☁️ Condition: ${current.weatherDesc?.[0]?.value}\n` +
            `👁️ Visibility: ${current.visibility} km\n` +
            `🌅 Local Time: ${current.localObsDateTime}`
          );
        } catch (err: any) {
          await ctx.m.reply(`❌ Weather error: ${err?.message}`);
        }
      },
    },
    {
      name: 'urlpreview',
      aliases: ['linkpreview', 'og'],
      category: 'tools',
      description: 'Get URL preview/info',
      example: '.urlpreview https://example.com',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}urlpreview <url>`);
        try {
          // @ts-ignore
          const { getPreviewFromContent } = await import('link-preview-js');
          const preview: any = await getPreviewFromContent({ headers: {} } as any, { url: ctx.text } as any);
          let text = `🔗 *URL Preview*\n\n📍 URL: ${ctx.text}\n`;
          if (preview.title) text += `📝 Title: ${preview.title}\n`;
          if (preview.description) text += `📄 Description: ${preview.description}\n`;
          if ((preview as any).siteName) text += `🌐 Site: ${(preview as any).siteName}\n`;
          await ctx.m.reply(text);
        } catch (err: any) {
          await ctx.m.reply(`❌ Error: ${err?.message}`);
        }
      },
    },
  ];
}
