import type { Command, CommandContext } from '../../core/types.js';

const AI_CHANNEL = '867051314767696';
const AI_HISTORY = new Map<string, Array<{ role: string; content: string }>>();
const MAX_HISTORY = 20;

function getHistory(jid: string) {
  return AI_HISTORY.get(jid) || [];
}

function addHistory(jid: string, role: string, content: string) {
  const h = getHistory(jid);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
  AI_HISTORY.set(jid, h);
}

async function chatWithAI(
  sock: any,
  prompt: string,
  history: Array<{ role: string; content: string }>
): Promise<string | null> {
  const aiJid = AI_CHANNEL + '@s.whatsapp.net';

  const context = history.slice(-8)
    .map(h => `${h.role}: ${h.content}`)
    .join('\n');
  const fullPrompt = context
    ? `Conversation:\n${context}\nuser: ${prompt}\nassistant:`
    : prompt;

  try {
    const sent = await sock.sendMessage(aiJid, { text: fullPrompt });
    if (!sent?.key?.id) return null;

    const response = await new Promise<string | null>(resolve => {
      let resolved = false;
      const handler = (events: any) => {
        if (resolved) return;
        for (const evt of events) {
          const msg = evt.message;
          if (!msg) continue;
          if (evt.key?.remoteJid !== aiJid || evt.key?.fromMe) continue;

          const text =
            msg.conversation ||
            msg.extendedTextMessage?.text ||
            msg.imageMessage?.caption ||
            msg.videoMessage?.caption ||
            '';

          if (text && evt.key?.id !== sent.key.id) {
            resolved = true;
            sock.ev.off('messages.upsert', handler);
            return resolve(text);
          }
        }
      };

      sock.ev.on('messages.upsert', handler);
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          sock.ev.off('messages.upsert', handler);
          resolve(null);
        }
      }, 30000);
    });

    return response;
  } catch {
    return null;
  }
}

export default function aiCommands(): Command[] {
  return [
    {
      name: 'ai',
      aliases: ['gpt', 'bot', 'ask'],
      category: 'ai',
      description: 'Chat with AI (Meta AI WhatsApp)',
      example: '.ai What is the capital of Tanzania?',
      execute: async (ctx: CommandContext) => {
        const prompt = ctx.args.join(' ');
        if (!prompt) {
          await ctx.m.reply(
            `🤖 *AI Chat*\n\n` +
            `Usage: ${ctx.prefix}ai <your question>\n\n` +
            `Examples:\n` +
            `• ${ctx.prefix}ai Habari yako?\n` +
            `• ${ctx.prefix}ai Nisaidie kufanya homework\n` +
            `• ${ctx.prefix}ai What is quantum physics?\n\n` +
            `💡 Reply to bot message for conversation context.`
          );
          return;
        }

        await ctx.m.react('🤖').catch(() => {});

        const history = getHistory(ctx.m.sender);
        const reply = await chatWithAI(ctx.sock, prompt, history);

        if (reply) {
          addHistory(ctx.m.sender, 'user', prompt);
          addHistory(ctx.m.sender, 'assistant', reply);
          await ctx.m.send({ text: reply });
          await ctx.m.react('✅').catch(() => {});
        } else {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply('❌ AI did not respond. Try again later.');
        }
      },
    },
    {
      name: 'aiv',
      aliases: ['aivision', 'seethis', 'describe'],
      category: 'ai',
      description: 'AI can see images - describe/analyze',
      example: '.aiv (send/reply to image with question)',
      execute: async (ctx: CommandContext) => {
        const target = ctx.m.quoted || ctx.m;
        const msg = target.message as any;

        if (!msg?.imageMessage && !msg?.videoMessage) {
          await ctx.m.reply(
            `🖼️ *AI Vision*\n\nReply to an image/video with ${ctx.prefix}aiv <question>\n\n` +
            `Example: ${ctx.prefix}aiv What is in this image?`
          );
          return;
        }

        const question = ctx.args.join(' ') || 'Describe this image in detail';
        await ctx.m.react('🤖').catch(() => {});

        try {
          const { downloadMediaMessage } = await import('baileys');
          const buffer = (await downloadMediaMessage(
            target as any,
            'buffer',
            {},
            { logger: ctx.logger, reuploadRequest: ctx.sock.updateMediaMessage }
          )) as Buffer;
          const base64 = buffer.toString('base64');

          const isVideo = !!msg?.videoMessage;
          const mediaType = isVideo ? 'video' : 'image';

          const aiJid = AI_CHANNEL + '@s.whatsapp.net';

          const sent = await ctx.sock.sendMessage(aiJid, {
            [mediaType]: { url: `data:${isVideo ? 'video/mp4' : 'image/jpeg'};base64,${base64}` },
            caption: question,
          } as any);

          const response = await new Promise<string | null>(resolve => {
            let resolved = false;
            const handler = (events: any) => {
              if (resolved) return;
              for (const evt of events) {
                if (!evt.message || evt.key?.fromMe) continue;
                if (evt.key?.remoteJid !== aiJid) continue;
                const text = evt.message.conversation || evt.message.extendedTextMessage?.text || '';
                if (text && evt.key?.id !== sent?.key?.id) {
                  resolved = true;
                  ctx.sock.ev.off('messages.upsert', handler);
                  return resolve(text);
                }
              }
            };
            ctx.sock.ev.on('messages.upsert', handler);
            setTimeout(() => {
              if (!resolved) {
                resolved = true;
                ctx.sock.ev.off('messages.upsert', handler);
                resolve(null);
              }
            }, 30000);
          });

          if (response) {
            await ctx.m.send({ text: `🖼️ *AI Vision Result:*\n\n${response}` });
            await ctx.m.react('✅').catch(() => {});
          } else {
            await ctx.m.react('❌').catch(() => {});
            await ctx.m.reply('❌ AI could not analyze the image. Try again.');
          }
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ Error: ${err?.message}`);
        }
      },
    },
    {
      name: 'clear',
      aliases: ['clearchat', 'resetchat'],
      category: 'ai',
      description: 'Clear AI conversation history',
      example: '.clear',
      execute: async (ctx: CommandContext) => {
        AI_HISTORY.delete(ctx.m.sender);
        await ctx.m.reply('✅ AI conversation history cleared!');
      },
    },
  ];
}
