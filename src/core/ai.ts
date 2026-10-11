import config from '../config/index.js';
import logger from './logger.js';

export const AI_SYSTEM_PROMPT = `You are Mtaula 01, a smart, friendly WhatsApp assistant. You speak Swahili and English fluently and can mix both naturally (Swahili-English code-switching). You are helpful, witty, and conversational.

Rules:
- Be concise but informative (WhatsApp chat, not essays)
- Use Swahili if the user writes in Swahili, English if English
- You can mix Swahili and English naturally
- Be friendly and human-like, not robotic
- Never say you are an AI language model - you are Mtaula 01, a WhatsApp assistant
- If asked about sensitive topics (adult content, violence, illegal acts), politely decline
- You can help with: general knowledge, calculations, translations, advice, jokes, recipes, coding, school work, news, and daily life questions
- Keep responses under 1500 characters for WhatsApp
- Use WhatsApp-friendly formatting (no markdown headers, use *bold* and _italic_ sparingly)`;

export interface ChatTurn {
  role: string;
  content: string;
}

export interface AIServiceResult {
  text: string;
  engine: string;
}

function timed<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

/** Fast cloud engines first (Gemini -> Groq -> OpenAI), Meta AI channel last. */
export async function askAI(
  sock: any,
  prompt: string,
  history: ChatTurn[]
): Promise<AIServiceResult> {
  const engines: Array<[string, () => Promise<string | null>]> = [
    ['gemini', () => callGemini(prompt, history)],
    ['groq', () => callGroq(prompt, history)],
    ['openai', () => callOpenAI(prompt, history)],
    ['meta-ai', () => callMetaAI(sock, prompt, history)],
  ];

  let lastError: Error | null = null;
  for (const [name, run] of engines) {
    try {
      const result = await timed(run(), 30000, name);
      if (result && result.trim()) {
        logger.info({ engine: name, chars: result.length }, 'AI reply generated');
        return { text: result.trim(), engine: name };
      }
    } catch (err: any) {
      lastError = err;
      logger.warn({ engine: name, err: err?.message }, 'AI engine failed, trying next');
    }
  }
  throw lastError || new Error('No AI engine available (set GEMINI_KEY or GROQ_KEY)');
}

export async function callGemini(
  text: string,
  history: ChatTurn[]
): Promise<string | null> {
  if (!config.GEMINI_KEY) return null;

  const contents = [
    ...history.slice(-10).map(h => ({
      role: h.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: h.content }],
    })),
    { role: 'user', parts: [{ text }] },
  ];

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    {
      method: 'POST',
      // Key in header, never in the URL (URLs leak into logs/proxies).
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.GEMINI_KEY,
      },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: AI_SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 2048, temperature: 0.8 },
      }),
      signal: AbortSignal.timeout(25000),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini HTTP ${res.status}: ${body.slice(0, 120)}`);
  }
  const data: any = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const textOut = parts.map((p: any) => p?.text || '').join('').trim();
  return textOut || null;
}

export async function callGroq(
  text: string,
  history: ChatTurn[]
): Promise<string | null> {
  if (!config.GROQ_KEY) return null;

  const messages = [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: text },
  ];

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      messages,
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 120)}`);
  }
  const data: any = await res.json();
  return data?.choices?.[0]?.message?.content || null;
}

export async function callOpenAI(
  text: string,
  history: ChatTurn[]
): Promise<string | null> {
  if (!config.OPENAI_KEY) return null;

  const messages = [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    ...history.slice(-10).map(h => ({ role: h.role, content: h.content })),
    { role: 'user', content: text },
  ];

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: config.OPENAI_MODEL || 'gpt-4o-mini',
      messages,
      max_tokens: 1024,
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${res.status}: ${body.slice(0, 120)}`);
  }
  const data: any = await res.json();
  return data?.choices?.[0]?.message?.content || null;
}

function waitForAIReply(sock: any, sentId: string, aiNum: string, timeoutMs: number): Promise<string | null> {
  return new Promise(resolve => {
    let resolved = false;

    const handler = (events: any) => {
      if (resolved) return;
      for (const evt of events) {
        if (!evt.message || evt.key?.fromMe) continue;

        const jid: string = evt.key?.remoteJid || '';
        if (!jid.includes(aiNum)) continue;

        const text =
          evt.message.conversation ||
          evt.message.extendedTextMessage?.text ||
          evt.message.imageMessage?.caption ||
          evt.message.buttonsResponseMessage?.selectedDisplayText ||
          evt.message.listResponseMessage?.title ||
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

/**
 * Meta AI via WhatsApp channel. This is best-effort only: it depends on the
 * Meta AI number accepting our messages, so it runs LAST in the engine chain.
 */
export async function callMetaAI(
  sock: any,
  text: string,
  history: ChatTurn[]
): Promise<string | null> {
  if (!sock || !config.META_AI_NUMBER) return null;

  const aiNum = config.META_AI_NUMBER.replace(/\D/g, '');
  if (!aiNum) return null;

  const context = history.slice(-8).map(h => `${h.role}: ${h.content}`).join('\n');
  const prompt = context ? `Conversation:\n${context}\nuser: ${text}\nassistant:` : text;

  const jids = [`${aiNum}@s.whatsapp.net`, `${aiNum}@lid`];

  for (const aiJid of jids) {
    try {
      const sent = await sock.sendMessage(aiJid, { text: prompt });
      if (!sent?.key?.id) continue;

      const response = await waitForAIReply(sock, sent.key.id, aiNum, 12000);
      if (response) return response;
    } catch (err: any) {
      logger.warn({ aiJid, err: err?.message }, 'Meta AI attempt failed');
    }
  }
  return null;
}
