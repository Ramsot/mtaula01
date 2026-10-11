import config from '../../config/index.js';
import type { Command, CommandContext } from '../../core/types.js';
import { askAI, type ChatTurn } from '../../core/ai.js';

const AI_HISTORY = new Map<string, ChatTurn[]>();
const MAX_HISTORY = 20;

function getHistory(jid: string): ChatTurn[] {
  return AI_HISTORY.get(jid) || [];
}

function addHistory(jid: string, role: string, content: string): void {
  const h = getHistory(jid);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
  AI_HISTORY.set(jid, h);
}

export default function aiCommands(): Command[] {
  return [
    {
      name: 'ai',
      aliases: ['gpt', 'ask', 'chat'],
      category: 'ai',
      description: 'Chat with AI (Gemini → Groq → OpenAI → Meta AI)',
      usage: '.ai <your question>',
      example: '.ai Habari yako?',
      execute: async (ctx: CommandContext) => {
        const prompt = ctx.text;
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

        if (config.AUTO_TYPING) {
          await ctx.sock.sendPresenceUpdate('composing', ctx.m.from).catch(() => {});
        }

        const history = getHistory(ctx.m.sender);

        try {
          const { text } = await askAI(ctx.sock, prompt, history);
          addHistory(ctx.m.sender, 'user', prompt);
          addHistory(ctx.m.sender, 'assistant', text);
          await ctx.m.reply(text);
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(
            `❌ AI error: ${err?.message || 'unknown'}\n\n` +
            `💡 Make sure GEMINI_KEY or GROQ_KEY is set in the bot config.`
          );
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
