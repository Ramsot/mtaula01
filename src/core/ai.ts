import config from '../config/index.js';
import logger from './logger.js';
import { metrics } from './storage.js';

/**
 * Secondary model per provider. Providers retire model ids without notice, and
 * a hardcoded id then fails every request — so a model-level error retries the
 * same engine once with a known-good alternative before falling through to the
 * next engine entirely.
 */
const GEMINI_FALLBACK_MODEL = 'gemini-3.6-flash';
const GROQ_FALLBACK_MODEL = 'openai/gpt-oss-120b';

/** HTTP statuses that mean "this model id is not usable", not "the request failed". */
function isModelError(status: number): boolean {
  return status === 400 || status === 404;
}

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

/** Which cloud engines actually have a key configured. */
export function availableAiEngines(): string[] {
  const out: string[] = [];
  if (config.GEMINI_KEY) out.push('gemini');
  if (config.GROQ_KEY) out.push('groq');
  if (config.OPENAI_KEY) out.push('openai');
  return out;
}

/** One-line, key-safe summary for logs (never prints the key itself). */
export function aiDiagnostics(): Record<string, string | boolean> {
  const mask = (k: string) => (k ? `set(${k.length} chars)` : 'MISSING');
  return {
    GEMINI_KEY: mask(config.GEMINI_KEY),
    GROQ_KEY: mask(config.GROQ_KEY),
    OPENAI_KEY: mask(config.OPENAI_KEY),
    META_AI_NUMBER: config.META_AI_NUMBER || 'MISSING',
    engines: availableAiEngines().join(',') || 'none',
    GEMINI_MODEL: config.GEMINI_MODEL,
    GROQ_MODEL: config.GROQ_MODEL,
    OPENAI_MODEL: config.OPENAI_MODEL,
    GEMINI_IMAGE_MODEL: config.GEMINI_IMAGE_MODEL,
    GROQ_STT_MODEL: config.GROQ_STT_MODEL,
  };
}

/**
 * Ping every configured engine once at boot and log the outcome.
 *
 * Model ids rot, keys expire and quotas run out; without this the first sign of
 * trouble is a user seeing "AI failed" minutes after a deploy. Never fatal.
 */
export async function runAiSelfTest(): Promise<Record<string, string>> {
  const engines = availableAiEngines();
  const results: Record<string, string> = {};
  if (engines.length === 0) return results;

  await Promise.all(
    engines.map(async engine => {
      const started = Date.now();
      try {
        const text = await timed(
          engine === 'gemini'
            ? callGemini('Reply with the single word: pong', [])
            : engine === 'groq'
              ? callGroq('Reply with the single word: pong', [])
              : callOpenAI('Reply with the single word: pong', []),
          20_000,
          engine
        );
        const ms = Date.now() - started;
        metrics.aiResult(engine, !!text, ms);
        results[engine] = text ? `OK (${ms}ms)` : 'empty response';
        logger.info({ engine, ms }, 'AI engine self-test passed');
      } catch (err: any) {
        const ms = Date.now() - started;
        metrics.aiResult(engine, false, ms);
        results[engine] = `FAILED: ${err?.message || 'unknown error'}`;
        logger.warn({ engine, ms, err: err?.message }, 'AI engine self-test failed');
      }
    })
  );

  return results;
}

/**
 * Fast cloud engines first (Gemini -> Groq -> OpenAI), Meta AI channel last.
 * Fails FAST when nothing is configured instead of hanging on Meta AI.
 */
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

  const hasCloudKey = availableAiEngines().length > 0;
  const canUseMetaAI = !!sock && !!config.META_AI_NUMBER;

  // Nothing to try: fail immediately with an actionable message rather than
  // making the user wait on Meta AI timeouts that will never succeed.
  if (!hasCloudKey && !canUseMetaAI) {
    throw new Error(
      'No AI engine configured. Set GEMINI_KEY, GROQ_KEY, or OPENAI_KEY in your environment '
      + '(on Render: Settings → Environment, not a local .env file).'
    );
  }

  let lastError: Error | null = null;
  for (const [name, run] of engines) {
    // Skip Meta AI when we already know there is no point (keeps failures fast).
    if (name === 'meta-ai' && !canUseMetaAI) continue;
    const started = Date.now();
    try {
      const result = await timed(run(), 20000, name);
      const ms = Date.now() - started;
      if (result && result.trim()) {
        metrics.aiResult(name, true, ms);
        logger.info({ engine: name, chars: result.length, ms }, 'AI reply generated');
        return { text: result.trim(), engine: name };
      }
      // A key was set but returned nothing — record it so the final error is useful.
      metrics.aiResult(name, false, ms);
      lastError = lastError || new Error(`${name} returned an empty response`);
    } catch (err: any) {
      metrics.aiResult(name, false, Date.now() - started);
      lastError = err;
      logger.warn({ engine: name, err: err?.message }, 'AI engine failed, trying next');
    }
  }

  const detail = availableAiEngines().length
    ? `Tried engines: ${engines.map(([n]) => n).join(', ')}. Last error: ${lastError?.message || 'unknown'}`
    : 'No GEMINI_KEY / GROQ_KEY / OPENAI_KEY is set.';
  throw new Error(`AI failed. ${detail}`);
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

  const models = [config.GEMINI_MODEL, GEMINI_FALLBACK_MODEL]
    .filter((m, i, all) => !!m && all.indexOf(m) === i);

  let lastError = 'unknown error';
  for (const model of models) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
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
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.8,
            // Gemini 3.x is a "thinking" model; disabling the thinking budget
            // keeps replies fast for chat (it was blowing past the timeout and
            // forcing a fallback to Groq, adding ~20s of latency).
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: AbortSignal.timeout(20000),
      }
    );

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      lastError = `Gemini HTTP ${res.status}: ${body.slice(0, 120)}`;
      // Retire-proofing: only retry when the model id itself was rejected.
      if (isModelError(res.status) && model !== models[models.length - 1]) {
        logger.warn({ model, fallback: GEMINI_FALLBACK_MODEL, status: res.status }, 'Gemini model rejected, retrying with fallback');
        continue;
      }
      throw new Error(lastError);
    }

    const data: any = await res.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const textOut = parts.map((p: any) => p?.text || '').join('').trim();
    if (model !== config.GEMINI_MODEL) {
      logger.info({ model }, 'Gemini replied using the fallback model');
    }
    return textOut || null;
  }

  throw new Error(lastError);
}

/**
 * Text-to-image through Gemini's image models. Returns raw image bytes.
 *
 * The model can be configured with GEMINI_IMAGE_MODEL; the response carries
 * base64 `inlineData` parts alongside any text it produced.
 */
export async function generateImage(
  prompt: string
): Promise<{ buffer: Buffer; mimetype: string } | null> {
  if (!config.GEMINI_KEY) return null;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${config.GEMINI_IMAGE_MODEL}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.GEMINI_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
      signal: AbortSignal.timeout(60000),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Gemini image HTTP ${res.status}: ${body.slice(0, 160)}`);
  }

  const data: any = await res.json();
  const parts: any[] = data?.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find(p => p?.inlineData?.data || p?.inline_data?.data);
  const inline = imagePart?.inlineData || imagePart?.inline_data;
  if (!inline?.data) return null;

  return {
    buffer: Buffer.from(inline.data, 'base64'),
    mimetype: inline.mimeType || inline.mime_type || 'image/png',
  };
}

/**
 * Speech-to-text through Groq's Whisper endpoint. Whisper handles Swahili and
 * English without an explicit language hint, which is what this bot needs.
 */
export async function transcribeAudio(
  audio: Buffer,
  mimetype = 'audio/ogg',
  filename = 'audio.ogg'
): Promise<string | null> {
  if (!config.GROQ_KEY) return null;

  const models = [config.GROQ_STT_MODEL, 'whisper-large-v3']
    .filter((m, i, all) => !!m && all.indexOf(m) === i);

  let lastError = 'unknown error';
  for (const model of models) {
    const form = new FormData();
    form.append('file', new Blob([audio], { type: mimetype }), filename);
    form.append('model', model);
    form.append('response_format', 'json');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.GROQ_KEY}` },
      body: form,
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      lastError = `Groq STT HTTP ${res.status}: ${body.slice(0, 160)}`;
      if (isModelError(res.status) && model !== models[models.length - 1]) continue;
      throw new Error(lastError);
    }

    const data: any = await res.json();
    return (data?.text || '').trim() || null;
  }

  throw new Error(lastError);
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

  const models = [config.GROQ_MODEL, GROQ_FALLBACK_MODEL]
    .filter((m, i, all) => !!m && all.indexOf(m) === i);

  let lastError = 'unknown error';
  for (const model of models) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.GROQ_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 1024,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      lastError = `Groq HTTP ${res.status}: ${body.slice(0, 120)}`;
      if (isModelError(res.status) && model !== models[models.length - 1]) {
        logger.warn({ model, fallback: GROQ_FALLBACK_MODEL, status: res.status }, 'Groq model rejected, retrying with fallback');
        continue;
      }
      throw new Error(lastError);
    }

    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (model !== config.GROQ_MODEL) {
      logger.info({ model }, 'Groq replied using the fallback model');
    }
    return text || null;
  }

  throw new Error(lastError);
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

      const response = await waitForAIReply(sock, sent.key.id, aiNum, 9000);
      if (response) return response;
    } catch (err: any) {
      logger.warn({ aiJid, err: err?.message }, 'Meta AI attempt failed');
    }
  }
  return null;
}
