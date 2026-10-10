import type { Command, CommandContext } from '../../core/types.js';
import logger from '../../core/logger.js';

const AI_CHANNEL_ID = '867051314767696';
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

function getAIJid(): string[] {
  return [
    `${AI_CHANNEL_ID}@newsletter`,
    `${AI_CHANNEL_ID}@s.whatsapp.net`,
    `${AI_CHANNEL_ID}@g.us`,
  ];
}

async function waitForReply(
  sock: any,
  sentId: string,
  timeoutMs: number
): Promise<string | null> {
  return new Promise(resolve => {
    let resolved = false;
    const aiJids = new Set(getAIJid());

    const handler = (events: any) => {
      if (resolved) return;
      for (const evt of events) {
        const msg = evt.message;
        if (!msg) continue;
        if (evt.key?.fromMe) continue;

        const jid = evt.key?.remoteJid || '';
        const isAI = aiJids.has(jid) || jid.includes(AI_CHANNEL_ID);
        if (!isAI) continue;

        const text =
          msg.conversation ||
          msg.extendedTextMessage?.text ||
          msg.imageMessage?.caption ||
          msg.videoMessage?.caption ||
          msg.buttonsResponseMessage?.selectedDisplayText ||
          msg.listResponseMessage?.title ||
          '';

        if (text && evt.key?.id !== sentId) {
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
    }, timeoutMs);
  });
}

async function chatWithAI(
  sock: any,
  prompt: string,
  history: Array<{ role: string; content: string }>
): Promise<string | null> {
  const context = history.slice(-8)
    .map(h => `${h.role}: ${h.content}`)
    .join('\n');
  const fullPrompt = context
    ? `Conversation:\n${context}\nuser: ${prompt}\nassistant:`
    : prompt;

  const jids = getAIJid();

  for (const aiJid of jids) {
    try {
      logger.info({ aiJid, prompt: prompt.slice(0, 50) }, 'Sending to AI channel');

      const sent = await sock.sendMessage(aiJid, { text: fullPrompt });
      if (!sent?.key?.id) continue;

      const response = await waitForReply(sock, sent.key.id, 30000);

      if (response) {
        logger.info({ aiJid, response: response.slice(0, 100) }, 'AI channel responded');
        return response;
      }

      logger.warn({ aiJid }, 'AI channel no response, trying next');
    } catch (err: any) {
      logger.error({ aiJid, err: err?.message }, 'AI channel failed');
      continue;
    }
  }

  return null;
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
            `• ${ctx.prefix}ai What is quantum physics?`
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
          await ctx.m.reply(
            '❌ AI did not respond.\n\n' +
            '💡 Make sure bot has joined the AI channel first.\n' +
            `Try: ${ctx.prefix}joinai`
          );
        }
      },
    },
    {
      name: 'joinai',
      aliases: ['subscribeai'],
      category: 'ai',
      description: 'Join/follow the AI channel',
      example: '.joinai',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) {
          await ctx.m.reply('❌ Owner only!');
          return;
        }
        await ctx.m.react('⏳').catch(() => {});

        const jids = getAIJid();
        const results: string[] = [];

        for (const jid of jids) {
          try {
            await ctx.sock.groupAcceptInvite(jid).catch(() => {});
            results.push(`✅ ${jid}`);
          } catch {
            results.push(`❌ ${jid}`);
          }
        }

        await ctx.m.reply(
          `📨 *AI Channel Join Results:*\n\n${results.join('\n')}\n\n` +
          `💡 If all failed, the channel may need manual joining.`
        );
        await ctx.m.react('✅').catch(() => {});
      },
    },
    {
      name: 'aiv',
      aliases: ['aivision', 'describe'],
      category: 'ai',
      description: 'AI Vision - analyze images/videos',
      example: '.aiv (reply to image with question)',
      execute: async (ctx: CommandContext) => {
        const target = ctx.m.quoted || ctx.m;
        const msg = target.message as any;

        if (!msg?.imageMessage && !msg?.videoMessage) {
          await ctx.m.reply(
            `🖼️ *AI Vision*\n\nReply to an image with ${ctx.prefix}aiv <question>`
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

          const aiJids = getAIJid();

          for (const aiJid of aiJids) {
            try {
              const sent = await ctx.sock.sendMessage(aiJid, {
                image: buffer,
                caption: question,
              });

              const response = await waitForReply(ctx.sock, sent?.key?.id || '', 30000);

              if (response) {
                await ctx.m.send({ text: `🖼️ *AI Vision:*\n\n${response}` });
                await ctx.m.react('✅').catch(() => {});
                return;
              }
            } catch {
              continue;
            }
          }

          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply('❌ AI could not analyze the image.');
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
