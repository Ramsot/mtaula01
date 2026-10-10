import config from '../config.js';
import { smsg } from '../lib/myfunc.js';

const prefix = config.PREFIX || '.';

function formatUptime(uptime) {
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function getCommandsList() {
  return {
    main: ['ping', 'uptime', 'info', 'menu', 'alive', 'owner'],
    group: ['tagall', 'hidetag', 'promote', 'demote', 'kick', 'add', 'antilink', 'welcome', 'linkgroup', 'setppgc', 'setname', 'setdesc', 'gcsetting', 'getbio'],
    download: ['ytmp3', 'ytmp4', 'tiktok', 'insta', 'fb', 'play', 'song', 'video', 'mediafire', 'gitclone', 'gdrive', 'pinterestdl', 'apk'],
    ai: ['ai', 'gemini', 'gpt', 'bug', 'report', 'dalle', 'remini'],
    search: ['google', 'yts', 'imdb', 'lyrics', 'pinterest', 'wallpaper', 'wikimedia', 'ytsearch', 'ringtone'],
    fun: ['quote', 'roast', 'flirt', 'fact', 'truth', 'dare'],
    tools: ['calc', 'tts', 'trt', 'tempmail', 'checkmail'],
    converter: ['attp', 'attp2', 'attp3', 'ebinary', 'dbinary', 'emojimix', 'mp3'],
    owner: ['broadcast', 'block', 'unblock', 'setppbot', 'setnamebot', 'setstatus', 'join', 'leave', 'paircode', 'autotyping', 'alwaysonline', 'autoread', 'autosview']
  };
}

export default async function mainPlugin(m, sock) {
  const { body, from, sender, reply, isGroup, pushName } = m;
  
  if (!body) return;
  
  // Only process commands starting with prefix
  if (!body.startsWith(prefix)) return;
  
  const cmd = body.slice(prefix.length).split(' ')[0].toLowerCase();
  const args = body.slice(prefix.length + cmd.length).trim();
  
  // ========== MAIN COMMANDS ==========
  if (cmd === 'ping') {
    await reply('🏓 Pong! Mtaula 01 is alive.');
    return;
  }
  
  if (cmd === 'uptime') {
    await reply(`⏱️ Uptime: ${formatUptime(process.uptime())}`);
    return;
  }
  
  if (cmd === 'info') {
    await reply(`🤖 *Mtaula 01 Bot Info*\n\n` +
      `📝 Name: Mtaula 01\n` +
      `🔢 Version: 10.8.1\n` +
      `👑 Owner: ${config.OWNER_NAME}\n` +
      `🔧 Mode: ${config.MODE}\n` +
      `📱 Prefix: ${config.PREFIX}\n` +
      `⚙️ Runtime: Node.js ${process.version}\n` +
      `💾 Memory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`);
    return;
  }
  
  if (cmd === 'alive') {
    await reply(`🤖 *Mtaula 01 is alive!*\n\n` +
      `✅ Status: Online\n` +
      `⏱️ Uptime: ${formatUptime(process.uptime())}\n` +
      `👑 Owner: ${config.OWNER_NAME}\n` +
      `📱 Prefix: ${config.PREFIX}\n` +
      `🔧 Mode: ${config.MODE}`);
    return;
  }
  
  if (cmd === 'menu' || cmd === 'help') {
    const commands = getCommandsList();
    let menu = `📋 *Mtaula 01 Command Menu*\n\n` +
      `📱 Prefix: ${config.PREFIX}\n` +
      `👑 Owner: ${config.OWNER_NAME}\n\n`;
    
    for (const [category, cmds] of Object.entries(commands)) {
      menu += `📂 *${category.toUpperCase()}*\n`;
      menu += cmds.map(c => `  ${config.PREFIX}${c}`).join(', ') + '\n\n';
    }
    
    menu += `💡 Type ${config.PREFIX}help <command> for details`;
    await reply(menu);
    return;
  }
  
  if (cmd === 'owner') {
    await reply(`👑 *Bot Owner*\n\n` +
      `Name: ${config.OWNER_NAME}\n` +
      `Number: ${config.OWNER_NUMBER}\n` +
      `Bot: Mtaula 01`);
    return;
  }
  
  // ========== GROUP COMMANDS (Stubs) ==========
  const groupCommands = ['tagall', 'hidetag', 'promote', 'demote', 'kick', 'add', 'antilink', 'welcome', 'linkgroup', 'setppgc', 'setname', 'setdesc', 'gcsetting', 'getbio'];
  if (groupCommands.includes(cmd)) {
    await reply(`📝 *${cmd}* command is not fully implemented yet.\nThis is a placeholder for group management features.`);
    return;
  }
  
  // ========== DOWNLOAD COMMANDS (Stubs) ==========
  const downloadCommands = ['ytmp3', 'ytmp4', 'tiktok', 'insta', 'fb', 'play', 'song', 'video', 'mediafire', 'gitclone', 'gdrive', 'pinterestdl', 'apk'];
  if (downloadCommands.includes(cmd)) {
    await reply(`📥 *${cmd}* command is not fully implemented yet.\nThis is a placeholder for media download features.`);
    return;
  }
  
  // ========== AI COMMANDS (Stubs) ==========
  const aiCommands = ['ai', 'gemini', 'gpt', 'bug', 'report', 'dalle', 'remini'];
  if (aiCommands.includes(cmd)) {
    await reply(`🤖 *${cmd}* command is not fully implemented yet.\nThis is a placeholder for AI features.`);
    return;
  }
  
  // ========== SEARCH COMMANDS (Stubs) ==========
  const searchCommands = ['google', 'yts', 'imdb', 'lyrics', 'pinterest', 'wallpaper', 'wikimedia', 'ytsearch', 'ringtone'];
  if (searchCommands.includes(cmd)) {
    await reply(`🔍 *${cmd}* command is not fully implemented yet.\nThis is a placeholder for search features.`);
    return;
  }
  
  // ========== FUN COMMANDS (Stubs) ==========
  const funCommands = ['quote', 'roast', 'flirt', 'fact', 'truth', 'dare'];
  if (funCommands.includes(cmd)) {
    await reply(`🎮 *${cmd}* command is not fully implemented yet.\nThis is a placeholder for fun features.`);
    return;
  }
  
  // ========== TOOLS COMMANDS (Stubs) ==========
  const toolCommands = ['calc', 'tts', 'trt', 'tempmail', 'checkmail'];
  if (toolCommands.includes(cmd)) {
    await reply(`🛠️ *${cmd}* command is not fully implemented yet.\nThis is a placeholder for tool features.`);
    return;
  }
  
  // ========== CONVERTER COMMANDS (Stubs) ==========
  const converterCommands = ['attp', 'attp2', 'attp3', 'ebinary', 'dbinary', 'emojimix', 'mp3'];
  if (converterCommands.includes(cmd)) {
    await reply(`🔄 *${cmd}* command is not fully implemented yet.\nThis is a placeholder for converter features.`);
    return;
  }
  
  // ========== OWNER COMMANDS (Stubs) ==========
  const ownerCommands = ['broadcast', 'block', 'unblock', 'setppbot', 'setnamebot', 'setstatus', 'join', 'leave', 'paircode', 'autotyping', 'alwaysonline', 'autoread', 'autosview'];
  if (ownerCommands.includes(cmd)) {
    const isOwner = sender === config.OWNER_NUMBER + '@s.whatsapp.net';
    if (!isOwner) {
      await reply('❌ Owner only command!');
      return;
    }
    await reply(`👑 *${cmd}* (Owner command) - placeholder implementation`);
    return;
  }
  
  // Unknown command
  await reply(`❓ Unknown command: ${config.PREFIX}${cmd}\nType ${config.PREFIX}menu for available commands.`);
}