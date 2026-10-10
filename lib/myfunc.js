import config from '../config.js';

export function smsg(conn, m, store, content, options = {}) {
  const { text, ...rest } = typeof content === 'string' ? { text: content } : content;
  const msg = {
    text: text || '',
    ...rest,
    contextInfo: {
      mentionedJid: options.mentions || [],
      forwardingScore: 999,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterJid: '120363200417751490@newsletter',
        serverMessageId: -1,
        newsletterName: 'Mtaula 01'
      },
      ...(options.contextInfo || {})
    }
  };
  
  if (options.quoted) {
    msg.contextInfo.stanzaId = options.quoted.key?.id;
    msg.contextInfo.participant = options.quoted.key?.participant || options.quoted.key?.remoteJid;
    msg.contextInfo.quotedMessage = options.quoted.message;
  }
  
  return conn.sendMessage(m.from, msg, { quoted: options.quoted || m });
}

export function formatDate(date = new Date(), locale = 'en-US', options = {}) {
  const defaultOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    ...options
  };
  return date.toLocaleString(locale, defaultOptions);
}

export function runtime(seconds) {
  seconds = Number(seconds);
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor(seconds % (3600 * 24) / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || !parts.length) parts.push(`${s}s`);
  return parts.join(' ');
}

export function bytesToSize(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

export function getRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function generateMessageId() {
  return '3EB0' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function isUrl(text) {
  const urlRegex = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;
  return urlRegex.test(text);
}

export function parseMention(text) {
  const mentionedJid = [];
  const matches = text.match(/@(\d+)/g);
  if (matches) {
    for (const match of matches) {
      mentionedJid.push(match.replace('@', '') + '@s.whatsapp.net');
    }
  }
  return mentionedJid;
}

export function getGroupMetadata(conn, jid) {
  return conn.groupMetadata(jid);
}

export async function getGroupAdmins(conn, jid) {
  const metadata = await conn.groupMetadata(jid);
  return metadata.participants
    .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
    .map(p => p.id);
}

export function formatNumber(num) {
  if (num >= 1e9) return (num / 1e9).toFixed(1) + 'B';
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toString();
}

export function truncate(text, length = 100) {
  if (text.length <= length) return text;
  return text.substring(0, length) + '...';
}

export function escapeHtml(text) {
  const map = {
    '&': '&',
    '<': '<',
    '>': '>',
    '"': '"',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

export function removeHtmlTags(text) {
  return text.replace(/<[^>]*>/g, '');
}

export function toTitleCase(str) {
  return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

export function isOwner(sender, ownerNumber) {
  const ownerJid = ownerNumber + '@s.whatsapp.net';
  return sender === ownerJid;
}

export function getTimezone() {
  return process.env.TIMEZONE || config.TIMEZONE || 'Asia/Kolkata';
}

export function formatTime(date = new Date(), tz = getTimezone()) {
  return date.toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatDateOnly(date = new Date(), tz = getTimezone()) {
  return date.toLocaleDateString('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
}

export default {
  smsg,
  formatDate,
  runtime,
  bytesToSize,
  getRandom,
  sleep,
  generateMessageId,
  isUrl,
  parseMention,
  getGroupMetadata,
  getGroupAdmins,
  formatNumber,
  truncate,
  escapeHtml,
  removeHtmlTags,
  toTitleCase,
  isOwner,
  getTimezone,
  formatTime,
  formatDateOnly
};