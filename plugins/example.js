const config = await import('../config.js').then(m => m.default);

const prefix = config.PREFIX || '.';

export default async function examplePlugin(m, sock) {
  const { body, from, sender, reply } = m;
  
  if (!body) return;
  
  if (body === `${prefix}ping`) {
    await reply('🏓 Pong! Mtaula 01 is alive.');
    return;
  }
  
  if (body === `${prefix}uptime`) {
    const uptime = process.uptime();
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);
    await reply(`⏱️ Uptime: ${days}d ${hours}h ${minutes}m ${seconds}s`);
    return;
  }
  
  if (body === `${prefix}info`) {
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
}