import config from '../../config/index.js';
import type { Command, CommandContext } from '../../core/types.js';

async function callGemini(prompt: string, history: { role: string; text: string }[]): Promise<string> {
  if (!config.GEMINI_KEY) throw new Error('GEMINI_KEY not set in environment');

  const contents = [
    ...history.map(h => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [{ text: h.text }],
    })),
    { role: 'user', parts: [{ text: prompt }] },
  ];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${config.GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data: any = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini';
}

async function callOpenAI(prompt: string, history: { role: string; text: string }[]): Promise<string> {
  if (!config.OPENAI_KEY) throw new Error('OPENAI_KEY not set in environment');

  const messages = [
    { role: 'system', content: `You are ${config.BOT_NAME}, a helpful WhatsApp assistant.` },
    ...history.map(h => ({ role: h.role as string, content: h.text })),
    { role: 'user', content: prompt },
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: config.OPENAI_MODEL, messages, max_tokens: 2048 }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data: any = await response.json();
  return data.choices?.[0]?.message?.content || 'No response from OpenAI';
}

const chatHistory = new Map<string, { role: string; text: string }[]>();

function getHistory(chatId: string) {
  if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
  return chatHistory.get(chatId)!;
}

export default function aiCommands(): Command[] {
  return [
    {
      name: 'ai',
      aliases: ['chat', 'gpt', 'ask'],
      category: 'ai',
      description: 'Chat with AI (Gemini)',
      example: '.ai What is the meaning of life?',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) {
          await ctx.m.reply(`Usage: ${ctx.prefix}ai <your question>\nExample: ${ctx.prefix}ai Hello, how are you?`);
          return;
        }

        await ctx.m.react('🤖').catch(() => {});
        const history = getHistory(ctx.m.from);

        let response: string;
        if (config.GEMINI_KEY) {
          response = await callGemini(ctx.text, history);
        } else if (config.OPENAI_KEY) {
          response = await callOpenAI(ctx.text, history);
        } else {
          await ctx.m.reply('❌ No AI key configured. Set GEMINI_KEY or OPENAI_KEY in environment.');
          return;
        }

        history.push({ role: 'user', text: ctx.text }, { role: 'model', text: response });
        if (history.length > 20) history.splice(0, history.length - 20);

        await ctx.m.reply(response);
      },
    },
    {
      name: 'gemini',
      aliases: ['geminichat'],
      category: 'ai',
      description: 'Chat specifically with Gemini AI',
      example: '.gemini Explain quantum physics',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) {
          await ctx.m.reply(`Usage: ${ctx.prefix}gemini <question>`);
          return;
        }

        if (!config.GEMINI_KEY) {
          await ctx.m.reply('❌ GEMINI_KEY not set. Add it to Render environment variables.');
          return;
        }

        await ctx.m.react('✨').catch(() => {});
        const history = getHistory(ctx.m.from);
        const response = await callGemini(ctx.text, history);
        history.push({ role: 'user', text: ctx.text }, { role: 'model', text: response });
        if (history.length > 20) history.splice(0, history.length - 20);
        await ctx.m.reply(response);
      },
    },
    {
      name: 'gpt',
      aliases: ['openai', 'chatgpt'],
      category: 'ai',
      description: 'Chat with OpenAI GPT',
      example: '.gpt Write a poem about Tanzania',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) {
          await ctx.m.reply(`Usage: ${ctx.prefix}gpt <question>`);
          return;
        }

        if (!config.OPENAI_KEY) {
          await ctx.m.reply('❌ OPENAI_KEY not set. Add it to Render environment variables.');
          return;
        }

        await ctx.m.react('🧠').catch(() => {});
        const history = getHistory(ctx.m.from);
        const response = await callOpenAI(ctx.text, history);
        history.push({ role: 'user', text: ctx.text }, { role: 'model', text: response });
        if (history.length > 20) history.splice(0, history.length - 20);
        await ctx.m.reply(response);
      },
    },
    {
      name: 'clearchat',
      aliases: ['resetai', 'clearhistory'],
      category: 'ai',
      description: 'Clear AI chat history',
      execute: async (ctx: CommandContext) => {
        chatHistory.delete(ctx.m.from);
        await ctx.m.reply('✅ Chat history cleared!');
      },
    },
  ];
}
