import config from '../../config/index.js';
import type { Command, CommandContext } from '../../core/types.js';

const AI_HISTORY = new Map<string, Array<{ role: string; content: string }>>();
const MAX_HISTORY = 20;

const SYSTEM_PROMPT = `You are Mtaula 01, a smart, friendly WhatsApp assistant. You speak Swahili and English fluently and can mix both naturally. You are helpful, witty, and conversational.

Rules:
- Be concise but informative (WhatsApp chat, not essays)
- Use Swahili if the user writes in Swahili, English if English
- You can mix Swahili and English naturally
- Be friendly and human-like, not robotic
- Never say you are an AI language model - you are Mtaula 01
- If asked about sensitive topics, politely decline
- Keep responses under 1500 characters
- Use WhatsApp-friendly formatting`;

function getHistory(jid: string) {
  return AI_HISTORY.get(jid) || [];
}

function addHistory(jid: string, role: string, content: string) {
  const h = getHistory(jid);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
  AI_HISTORY.set(jid, h);
}

async function callMetaAI(prompt: string, history: Array<{ role: string; content: string }>): Promise<string> {
  if (!config.META_AI_TOKEN) throw new Error('META_AI_TOKEN not set');

  const context = history.slice(-8)
    .map(h => `${h.role}: ${h.content}`)
    .join('\n');
  const fullPrompt = context
    ? `Conversation:\n${context}\nuser: ${prompt}\nassistant:`
    : prompt;

  const res = await fetch('https://graph.facebook.com/v19.0/me/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.META_AI_TOKEN}`,
    },
    body: JSON.stringify({
      recipient: 'me',
      message: { text: fullPrompt },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (res.ok) {
    const data: any = await res.json();
    if (data?.message?.text) return data.message.text;
    if (data?.text) return data.text;
    if (data?.response) return data.response;
  }

  const aiRes = await fetch('https://www.meta.ai/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.META_AI_TOKEN}`,
      'User-Agent': 'WhatsApp/2.24.1.78',
    },
    body: JSON.stringify({
      query: `query AIChat($prompt: String!) { aiChat(prompt: $prompt) { response } }`,
      variables: { prompt: fullPrompt },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (aiRes.ok) {
    const data: any = await aiRes.json();
    const response = data?.data?.aiChat?.response || data?.response || data?.text;
    if (response) return response;
  }

  throw new Error('Meta AI failed');
}

async function callGemini(prompt: string, history: Array<{ role: string; content: string }>): Promise<string> {
  if (!config.GEMINI_KEY) throw new Error('GEMINI_KEY not set');

  const contents = [
    ...history.slice(-10).map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    })),
    { role: 'user', parts: [{ text: prompt }] },
  ];

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${config.GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 2048, temperature: 0.8 },
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!response.ok) throw new Error(`Gemini error ${response.status}`);
  const data: any = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
}

async function callGroq(prompt: string, history: Array<{ role: string; content: string }>): Promise<string> {
  if (!config.GROQ_KEY) throw new Error('GROQ_KEY not set');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-10),
    { role: 'user', content: prompt },
  ];

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) throw new Error(`Groq error ${response.status}`);
  const data: any = await response.json();
  return data.choices?.[0]?.message?.content || 'No response';
}

async function callAI(prompt: string, history: Array<{ role: string; content: string }>): Promise<string> {
  const engines = [
    () => callMetaAI(prompt, history),
    () => callGemini(prompt, history),
    () => callGroq(prompt, history),
  ];

  let lastError: Error | null = null;
  for (const engine of engines) {
    try {
      return await engine();
    } catch (err: any) {
      lastError = err;
      continue;
    }
  }
  throw lastError || new Error('No AI engine available');
}

export default function aiCommands(): Command[] {
  return [
    {
      name: 'ai',
      aliases: ['gpt', 'bot', 'ask'],
      category: 'ai',
      description: 'Chat with AI',
      example: '.ai Habari yako?',
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

        try {
          const reply = await callAI(prompt, history);
          addHistory(ctx.m.sender, 'user', prompt);
          addHistory(ctx.m.sender, 'assistant', reply);
          await ctx.m.send({ text: reply });
          await ctx.m.react('✅').catch(() => {});
        } catch (err: any) {
          await ctx.m.react('❌').catch(() => {});
          await ctx.m.reply(`❌ ${err?.message}`);
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
