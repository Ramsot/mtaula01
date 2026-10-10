import type { Command, CommandContext } from '../../core/types.js';

export default function groupCommands(): Command[] {
  return [
    {
      name: 'tagall',
      aliases: ['everyone', 'all'],
      category: 'group',
      description: 'Tag all group members',
      example: '.tagall Hello everyone',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isGroup) return ctx.m.reply('❌ Group only!');
        if (!ctx.isAdmin) return ctx.m.reply('❌ Admin only!');
        const meta = await ctx.sock.groupMetadata(ctx.m.from);
        const members = meta.participants.map((p: any) => p.id);
        const text = ctx.text || '📢 Attention everyone!';
        await ctx.m.send({ text: `${text}\n\n${members.map((m: string) => `@${m.split('@')[0]}`).join(' ')}`, mentions: members });
      },
    },
    {
      name: 'hidetag',
      aliases: ['taghidden'],
      category: 'group',
      description: 'Tag all members silently',
      example: '.hidetag Secret message',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isGroup) return ctx.m.reply('❌ Group only!');
        if (!ctx.isAdmin) return ctx.m.reply('❌ Admin only!');
        const meta = await ctx.sock.groupMetadata(ctx.m.from);
        const members = meta.participants.map((p: any) => p.id);
        const text = ctx.text || '📢 Secret message';
        await ctx.m.send({ text, mentions: members });
      },
    },
    {
      name: 'promote',
      category: 'group',
      description: 'Promote a member to admin',
      example: '.promote @user',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isGroup) return ctx.m.reply('❌ Group only!');
        if (!ctx.isAdmin) return ctx.m.reply('❌ Admin only!');
        if (!ctx.isBotAdmin) return ctx.m.reply('❌ Bot needs admin!');
        const target = ctx.m.mentionedJid[0];
        if (!target) return ctx.m.reply(`Usage: ${ctx.prefix}promote @user`);
        await ctx.sock.groupParticipantsUpdate(ctx.m.from, [target], 'promote');
        await ctx.m.reply(`✅ Promoted @${target.split('@')[0]}`, { mentions: [target] });
      },
    },
    {
      name: 'demote',
      category: 'group',
      description: 'Demote an admin',
      example: '.demote @user',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isGroup) return ctx.m.reply('❌ Group only!');
        if (!ctx.isAdmin) return ctx.m.reply('❌ Admin only!');
        if (!ctx.isBotAdmin) return ctx.m.reply('❌ Bot needs admin!');
        const target = ctx.m.mentionedJid[0];
        if (!target) return ctx.m.reply(`Usage: ${ctx.prefix}demote @user`);
        await ctx.sock.groupParticipantsUpdate(ctx.m.from, [target], 'demote');
        await ctx.m.reply(`✅ Demoted @${target.split('@')[0]}`, { mentions: [target] });
      },
    },
    {
      name: 'kick',
      aliases: ['remove'],
      category: 'group',
      description: 'Remove a member from group',
      example: '.kick @user',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isGroup) return ctx.m.reply('❌ Group only!');
        if (!ctx.isAdmin) return ctx.m.reply('❌ Admin only!');
        if (!ctx.isBotAdmin) return ctx.m.reply('❌ Bot needs admin!');
        const target = ctx.m.mentionedJid[0];
        if (!target) return ctx.m.reply(`Usage: ${ctx.prefix}kick @user`);
        await ctx.sock.groupParticipantsUpdate(ctx.m.from, [target], 'remove');
        await ctx.m.reply(`✅ Removed @${target.split('@')[0]}`, { mentions: [target] });
      },
    },
    {
      name: 'add',
      category: 'group',
      description: 'Add a member to group',
      example: '.add 255XXXXXXXXX',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isGroup) return ctx.m.reply('❌ Group only!');
        if (!ctx.isAdmin) return ctx.m.reply('❌ Admin only!');
        if (!ctx.isBotAdmin) return ctx.m.reply('❌ Bot needs admin!');
        const number = ctx.args[0]?.replace(/\D/g, '');
        if (!number) return ctx.m.reply(`Usage: ${ctx.prefix}add 255XXXXXXXXX`);
        await ctx.sock.groupParticipantsUpdate(ctx.m.from, [number + '@s.whatsapp.net'], 'add');
        await ctx.m.reply(`✅ Added ${number}`);
      },
    },
    {
      name: 'linkgroup',
      aliases: ['grouplink', 'invite'],
      category: 'group',
      description: 'Get group invite link',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isGroup) return ctx.m.reply('❌ Group only!');
        if (!ctx.isAdmin) return ctx.m.reply('❌ Admin only!');
        const code = await ctx.sock.groupInviteCode(ctx.m.from);
        await ctx.m.reply(`🔗 Group Link:\nhttps://chat.whatsapp.com/${code}`);
      },
    },
    {
      name: 'setname',
      aliases: ['groupname'],
      category: 'group',
      description: 'Change group name',
      example: '.setname New Group Name',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isGroup) return ctx.m.reply('❌ Group only!');
        if (!ctx.isAdmin) return ctx.m.reply('❌ Admin only!');
        if (!ctx.isBotAdmin) return ctx.m.reply('❌ Bot needs admin!');
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}setname <new name>`);
        await ctx.sock.groupUpdateSubject(ctx.m.from, ctx.text);
        await ctx.m.reply(`✅ Group name changed to: ${ctx.text}`);
      },
    },
    {
      name: 'setdesc',
      aliases: ['groupdesc'],
      category: 'group',
      description: 'Change group description',
      example: '.setdesc New description',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isGroup) return ctx.m.reply('❌ Group only!');
        if (!ctx.isAdmin) return ctx.m.reply('❌ Admin only!');
        if (!ctx.isBotAdmin) return ctx.m.reply('❌ Bot needs admin!');
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}setdesc <description>`);
        await ctx.sock.groupUpdateDescription(ctx.m.from, ctx.text);
        await ctx.m.reply('✅ Group description updated!');
      },
    },
    {
      name: 'groupinfo',
      aliases: ['gcinfo'],
      category: 'group',
      description: 'Show group information',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isGroup) return ctx.m.reply('❌ Group only!');
        const meta = await ctx.sock.groupMetadata(ctx.m.from);
        const admins = meta.participants.filter((p: any) => p.admin);
        await ctx.m.reply(
          `📋 *Group Info*\n\n` +
          `📛 Name: ${meta.subject}\n` +
          `📝 Description: ${meta.desc || 'None'}\n` +
          `👥 Members: ${meta.participants.length}\n` +
          `👑 Admins: ${admins.length}\n` +
          `🆔 ID: ${meta.id}\n` +
          `📅 Created: ${meta.creation ? new Date(meta.creation * 1000).toLocaleDateString() : 'Unknown'}\n` +
          `🔗 Link: https://chat.whatsapp.com/${await ctx.sock.groupInviteCode(ctx.m.from)}`
        );
      },
    },
    {
      name: 'gcsettings',
      aliases: ['groupsettings'],
      category: 'group',
      description: 'Show group settings',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isGroup) return ctx.m.reply('❌ Group only!');
        const meta = await ctx.sock.groupMetadata(ctx.m.from);
        await ctx.m.reply(
          `⚙️ *Group Settings*\n\n` +
          `📛 Name: ${meta.subject}\n` +
          `📝 Description: ${meta.desc ? 'Set' : 'Not set'}\n` +
          `📢 Announce: ${meta.announce ? 'Yes' : 'No'}\n` +
          `🔒 Locked: ${meta.restrict ? 'Yes' : 'No'}\n` +
          `👥 Members: ${meta.participants.length}`
        );
      },
    },
  ];
}
