import type { WASocket, proto } from 'baileys';
import type { SerializedMessage } from './types.js';

export function serialize(raw: proto.IWebMessageInfo, sock: WASocket): SerializedMessage {
  const key = raw.key!;
  const message = raw.message || {};

  const body =
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    message.templateButtonReplyMessage?.selectedId ||
    '';

  const from = key.remoteJid!;
  const isGroup = from.endsWith('@g.us');
  const sender = key.participant || from;
  const fromMe = key.fromMe ?? false;

  const msg: SerializedMessage = {
    key,
    id: key.id!,
    from,
    sender,
    fromMe,
    pushName: (raw as any).pushName || 'Unknown',
    body,
    text: body,
    caption: message.imageMessage?.caption || message.videoMessage?.caption || '',
    type: getMessageType(message),
    isGroup,
    isPrivate: from.endsWith('@s.whatsapp.net'),
    mentionedJid: message.extendedTextMessage?.contextInfo?.mentionedJid || [],
    quoted: null,
    message,
    timestamp: Number(raw.messageTimestamp) || Date.now(),
    reply: async (text: string, options?: any) => {
      return sock.sendMessage(from, { text, ...options }, { quoted: raw as any });
    },
    send: async (content: any, options?: any) => {
      return sock.sendMessage(from, content, { ...options, quoted: raw as any });
    },
    react: async (emoji: string) => {
      return sock.sendMessage(from, { react: { text: emoji, key } });
    },
  };

  const quotedCtx = message.extendedTextMessage?.contextInfo;
  if (quotedCtx?.quotedMessage) {
    msg.quoted = serialize(
      {
        key: { ...key, id: quotedCtx.stanzaId, participant: quotedCtx.participant },
        message: quotedCtx.quotedMessage,
      } as proto.IWebMessageInfo,
      sock
    );
  }

  return msg;
}

function getMessageType(message: proto.IMessage): string {
  if (!message) return 'unknown';
  const types = Object.keys(message);
  if (types.length === 0) return 'unknown';
  return types[0].replace('Message', '').toLowerCase();
}

export function decodeJid(jid: string): string {
  if (!jid) return jid;
  if (jid.includes(':')) {
    return jid.split(':')[0] + '@s.whatsapp.net';
  }
  return jid;
}

export function isUrl(text: string): boolean {
  const urlRegex = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;
  return urlRegex.test(text);
}

export function parseMention(text: string): string[] {
  const matches = text.match(/@(\d+)/g);
  if (!matches) return [];
  return matches.map(m => m.replace('@', '') + '@s.whatsapp.net');
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
