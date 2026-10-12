import type { WASocket, proto } from 'baileys';
import type { CommandRegistry } from './registry.js';

export type CommandCategory =
  | 'main'
  | 'ai'
  | 'downloader'
  | 'group'
  | 'fun'
  | 'tools'
  | 'search'
  | 'converter'
  | 'owner'
  | 'media';

export interface CommandContext {
  m: SerializedMessage;
  sock: WASocket;
  args: string[];
  text: string;
  cmd: string;
  prefix: string;
  isCreator: boolean;
  isGroup: boolean;
  isAdmin: boolean;
  isBotAdmin: boolean;
  logger: any;
  registry: CommandRegistry;
}

export interface Command {
  name: string;
  aliases?: string[];
  category: CommandCategory;
  description: string;
  usage?: string;
  example?: string;
  execute: (ctx: CommandContext) => Promise<void>;
}

export interface SerializedMessage {
  key: proto.IMessageKey;
  id: string;
  from: string;
  sender: string;
  fromMe: boolean;
  pushName: string;
  body: string;
  text: string;
  caption: string;
  type: string;
  isGroup: boolean;
  isPrivate: boolean;
  mentionedJid: string[];
  quoted: SerializedMessage | null;
  message: proto.IMessage | null;
  timestamp: number;
  reply: (text: string, options?: any) => Promise<any>;
  send: (content: any, options?: any) => Promise<any>;
  react: (emoji: string) => Promise<any>;
  downloadMedia?: () => Promise<Buffer>;
}

export interface BotState {
  connected: boolean;
  registered: boolean;
  connectionState: string;
  user: string | null;
  lastError: string | null;
  qr: string | null;
  uptime: number;
  mode: string;
  prefix: string;
}

export interface BotConfig {
  PREFIX: string;
  MODE: string;
  OWNER_NAME: string;
  OWNER_NUMBER: string;
  OWNERS: string[];
  BOT_NAME: string;
  BOT_IMAGE: string;
  DESCRIPTION: string;
  GEMINI_KEY: string;
  OPENAI_KEY: string;
  GROQ_KEY: string;
  META_AI_TOKEN: string;
  TENOR_KEY: string;
  META_AI_NUMBER: string;
  ADMIN_TOKEN: string;
  OPENAI_MODEL: string;
  ALWAYS_ONLINE: boolean;
  AUTO_READ: boolean;
  AUTO_TYPING: boolean;
  AUTO_RECORDING: boolean;
  AUTO_REACT: boolean;
  REJECT_CALL: boolean;
  WELCOME: boolean;
  GOODBYE: boolean;
  ANTILINK: boolean;
  DEBUG_MODE: boolean;
  TIMEZONE: string;
  SESSION_DIR: string;
  DATA_DIR: string;
  PORT: number;
}
