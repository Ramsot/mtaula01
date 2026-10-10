import baileys from '@whiskeysockets/baileys';
const { proto } = baileys;

export function serialize(rawMessage, sock, logger) {
  const message = { ...rawMessage };

  message.reply = async (text, options = {}) => {
    return await sock.sendMessage(message.key.remoteJid, { text, ...options }, { quoted: message });
  };

  message.send = async (content, options = {}) => {
    return await sock.sendMessage(message.key.remoteJid, content, { ...options, quoted: message });
  };

  message.forward = async (jid, options = {}) => {
    return await sock.forwardMessage(jid, message, options);
  };

  message.copy = async (jid, options = {}) => {
    return await sock.sendMessage(jid, { forward: message }, options);
  };

  message.react = async (emoji) => {
    return await sock.sendMessage(message.key.remoteJid, {
      react: { text: emoji, key: message.key }
    });
  };

  message.delete = async () => {
    return await sock.sendMessage(message.key.remoteJid, { delete: message.key });
  };

  message.isGroup = message.key.remoteJid?.endsWith('@g.us') ?? false;
  message.isPrivate = message.key.remoteJid?.endsWith('@s.whatsapp.net') ?? false;
  message.isNewsletter = message.key.remoteJid?.endsWith('@newsletter') ?? false;

  message.sender = message.key.participant || message.key.remoteJid;
  message.from = message.key.remoteJid;
  message.id = message.key.id;
  message.fromMe = message.key.fromMe ?? false;
  message.pushName = message.pushName || 'Unknown';

  message.body = message.message?.conversation 
    || message.message?.extendedTextMessage?.text 
    || message.message?.imageMessage?.caption 
    || message.message?.videoMessage?.caption 
    || message.message?.documentMessage?.caption 
    || '';

  message.text = message.body;

  message.caption = message.message?.imageMessage?.caption
    || message.message?.videoMessage?.caption
    || message.message?.documentMessage?.caption
    || '';

  message.type = Object.keys(message.message || {})[0]?.replace('Message', '').toLowerCase() || 'unknown';

  message.quoted = message.message?.extendedTextMessage?.contextInfo?.quotedMessage 
    ? serialize({
        key: message.message.extendedTextMessage.contextInfo.stanzaId 
          ? { ...message.key, id: message.message.extendedTextMessage.contextInfo.stanzaId }
          : message.key,
        message: message.message.extendedTextMessage.contextInfo.quotedMessage,
        messageTimestamp: message.messageTimestamp
      }, sock, logger)
    : null;

  message.mentionedJid = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

  if (message.message?.protocolMessage) {
    message.type = 'protocol';
    message.protocolType = proto.WebMessageInfo.Message.ProtocolMessage.Type[message.message.protocolMessage.type];
  }

  return message;
}

export function decodeJid(jid) {
  if (!jid) return jid;
  if (jid.includes(':')) {
    return jid.split(':')[0] + '@s.whatsapp.net';
  }
  return jid;
}

export function getMessageType(message) {
  if (!message) return 'unknown';
  const msgKeys = Object.keys(message);
  if (msgKeys.length === 0) return 'unknown';
  return msgKeys[0].replace('Message', '').toLowerCase();
}

export function getContent(message) {
  const type = getMessageType(message);
  switch (type) {
    case 'conversation':
    case 'extendedTextMessage':
      return message[type].text || '';
    case 'imageMessage':
    case 'videoMessage':
    case 'documentMessage':
      return message[type].caption || '';
    default:
      return '';
  }
}

export function isMediaMessage(message) {
  const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
  return mediaTypes.some(type => message[type]);
}

export function getMediaType(message) {
  const mediaTypes = ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage', 'stickerMessage'];
  for (const type of mediaTypes) {
    if (message[type]) return type.replace('Message', '');
  }
  return null;
}

export default { serialize, decodeJid, getMessageType, getContent, isMediaMessage, getMediaType };