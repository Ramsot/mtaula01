import config from '../../config/index.js';
import {
  BOOST_PLANS,
  listServices,
  orderAction,
  placeOrder,
  purchaseBoost,
  walletBalance,
  panelBalance,
  panelOrder,
  panelServices,
  panelStatus,
  type SmmService,
} from '../../utils/bwm.js';
import type { Command, CommandContext } from '../../core/types.js';

const PANEL = () => (config.SMM_API_URL && config.SMM_API_KEY
  ? { url: config.SMM_API_URL, key: config.SMM_API_KEY }
  : null);

const BWM_READY = () => Boolean(config.BWM_SESSION_TOKEN);

const PLAN_HELP = BOOST_PLANS.map(p => `• ${p.id} — ${p.label} (${p.xd} XD)`).join('\n');

function serviceLine(s: SmmService): string {
  const flags = [s.refill ? '♻️ refill' : '', s.cancel ? '✖️ cancel' : ''].filter(Boolean).join(' ');
  return `*#${s.service}* ${s.name}\n   💰 ${s.rate}/1k · min ${s.min} · max ${s.max}${flags ? ` · ${flags}` : ''}`;
}

function searchServices(services: SmmService[], query?: string): SmmService[] {
  if (!query) return services.slice(0, 10);
  const q = query.toLowerCase();
  return services
    .filter(s => s.name?.toLowerCase().includes(q) || s.category?.toLowerCase().includes(q))
    .slice(0, 10);
}

export default function boostCommands(): Command[] {
  return [
    {
      name: 'boost',
      aliases: ['smm', 'boostmenu'],
      category: 'boost',
      description: 'Social media boost menu — followers, likes, views & promotion',
      example: '.boost',
      execute: async (ctx: CommandContext) => {
        const panel = PANEL();
        const lines = [
          `🚀 *SOCIAL MEDIA BOOST*`,
          ``,
          `📊 *BWM XMD panel*`,
          `• ${ctx.prefix}smmsvc <query> — search services`,
          `• ${ctx.prefix}smmbalance — your XD wallet`,
          `• ${ctx.prefix}smmorder <id> <link> <qty> — place order`,
          `• ${ctx.prefix}smmstatus <order id> — track order`,
          `• ${ctx.prefix}wa-channel <link> <plan> — boost WhatsApp channel`,
          ``,
          `🛠️ *Own SMM panel*`,
          panel
            ? `• ${ctx.prefix}pservices — catalogue\n• ${ctx.prefix}pbal — balance\n• ${ctx.prefix}porder <id> <link> <qty>`
            : `• Not configured. Set SMM_API_URL + SMM_API_KEY in .env`,
          ``,
          `📣 *Promotion (no account needed)*`,
          `• ${ctx.prefix}promo <niche> — ready-to-post caption`,
          `• ${ctx.prefix}tags <topic> — hashtag pack`,
          `• ${ctx.prefix}growth <platform> — growth checklist`,
          `• ${ctx.prefix}besttime — best posting times`,
          ``,
          `🔑 Wallet & orders: ${BWM_READY() ? 'ready ✅' : 'set BWM_SESSION_TOKEN in .env'}`,
          `🧾 WA channel plans:\n${PLAN_HELP}`,
        ];
        await ctx.m.reply(lines.join('\n'));
      },
    },

    // ---------------------------------------------------------------- BWM --
    {
      name: 'smmsvc',
      aliases: ['services', 'smmservices'],
      category: 'boost',
      description: 'Search the BWM XMD SMM service catalogue',
      example: '.smmsvc instagram followers',
      execute: async (ctx: CommandContext) => {
        await ctx.m.react('⏳').catch(() => {});
        try {
          const services = await listServices(ctx.text || undefined);
          if (!services.length) {
            return ctx.m.reply(ctx.text
              ? `❌ No services match "${ctx.text}".`
              : `❌ The catalogue came back empty — the panel may be down.`);
          }
          const shown = searchServices(services, ctx.text);
          const text = `📊 *Services*${ctx.text ? ` matching "${ctx.text}"` : ''} (${services.length} total)\n\n` +
            shown.map(serviceLine).join('\n\n') +
            `\n\n💡 Use ${ctx.prefix}smmorder <id> <link> <qty> to order.`;
          await ctx.m.reply(text);
        } catch (err: any) {
          await ctx.m.reply(`❌ Catalogue error: ${err?.message}`);
        }
      },
    },

    {
      name: 'smmbalance',
      aliases: ['wallet', 'balance'],
      category: 'boost',
      description: 'Show your BWM XMD wallet balance',
      example: '.smmbalance',
      execute: async (ctx: CommandContext) => {
        if (!BWM_READY()) {
          return ctx.m.reply(`🔑 *Not configured*\n\nSet \`BWM_SESSION_TOKEN\` in .env (from the dashboard login) to read your wallet.`);
        }
        await ctx.m.react('⏳').catch(() => {});
        try {
          const balance = await walletBalance(config.BWM_SESSION_TOKEN);
          if (balance === null) return ctx.m.reply('⚠️ Could not read the wallet balance.');
          await ctx.m.reply(`💰 *BWM XMD Wallet*\n\nBalance: *${balance} XD*`);
        } catch (err: any) {
          await ctx.m.reply(`❌ Balance error: ${err?.message}\n\nYour session token may have expired — log in again and update .env.`);
        }
      },
    },

    {
      name: 'smmorder',
      aliases: ['order', 'boostorder'],
      category: 'boost',
      cooldownMs: 10000,
      description: 'Place an SMM order on BWM XMD (owner only)',
      example: '.smmorder 8280 https://youtube.com/watch?v=xyz 1000',
      execute: async (ctx: CommandContext) => {
        // Spending real wallet money must never be reachable by a random user,
        // so this is gated to the owner regardless of MODE.
        if (!ctx.isCreator) return ctx.m.reply('🔒 Only the bot owner can place paid orders.');
        if (!BWM_READY()) return ctx.m.reply('🔑 Set `BWM_SESSION_TOKEN` in .env first.');

        const [idArg, link, qtyArg] = ctx.args;
        if (!idArg || !link || !qtyArg) {
          return ctx.m.reply(`Usage: ${ctx.prefix}smmorder <service id> <link> <quantity>\n\nFind ids with ${ctx.prefix}smmsvc <query>`);
        }
        const serviceId = Number(idArg);
        const quantity = Number(qtyArg);
        if (!Number.isFinite(serviceId)) return ctx.m.reply('❌ Service id must be a number.');
        if (!Number.isFinite(quantity) || quantity <= 0) return ctx.m.reply('❌ Quantity must be a positive number.');
        if (!/^https?:\/\//i.test(link)) return ctx.m.reply('❌ The link must start with http:// or https://');

        await ctx.m.react('⏳').catch(() => {});
        try {
          // Re-read the catalogue so the order carries the live rate/name
          // rather than whatever the user typed.
          const services = await listServices();
          const service = services.find(s => s.service === serviceId);
          if (!service) return ctx.m.reply(`❌ Service #${serviceId} not found. Check ${ctx.prefix}smmsvc.`);
          if (quantity < service.min || quantity > service.max) {
            return ctx.m.reply(`❌ Quantity out of range for #${serviceId}: min ${service.min}, max ${service.max}.`);
          }

          const result = await placeOrder({
            service,
            link,
            quantity,
            sessionToken: config.BWM_SESSION_TOKEN,
          });

          if (result?.success === false) {
            return ctx.m.reply(`❌ Order rejected: ${result?.error || 'unknown error'}`);
          }

          const orderId = result?.order ?? result?.orderId ?? result?.id ?? '—';
          const charge = Number(result?.charge);
          await ctx.m.reply(
            `✅ *Order placed*\n\n` +
            `🧾 Order: *${orderId}*\n` +
            `📦 ${service.name}\n` +
            `🔗 ${link}\n` +
            `🔢 Quantity: ${quantity}\n` +
            (Number.isFinite(charge) ? `💸 Charged: ${charge} XD\n` : '') +
            `\nTrack it with ${ctx.prefix}smmstatus ${orderId}`
          );
        } catch (err: any) {
          await ctx.m.reply(`❌ Order failed: ${err?.message}`);
        }
      },
    },

    {
      name: 'smmstatus',
      aliases: ['orderstatus', 'track'],
      category: 'boost',
      description: 'Track a BWM XMD order',
      example: '.smmstatus 12345',
      execute: async (ctx: CommandContext) => {
        const orderId = ctx.args[0];
        if (!orderId) return ctx.m.reply(`Usage: ${ctx.prefix}smmstatus <order id>`);
        await ctx.m.react('⏳').catch(() => {});
        try {
          const res = await orderAction(
            'check_status',
            { order_ids: orderId },
            config.BWM_SESSION_TOKEN || undefined
          );
          if (res?.success === false) return ctx.m.reply(`❌ ${res?.error || 'Could not read that order'}`);
          const status = res?.status || res?.[0]?.status || 'unknown';
          const start = res?.start_count ?? res?.[0]?.start_count;
          const remains = res?.remains ?? res?.[0]?.remains;
          await ctx.m.reply(
            `📦 *Order ${orderId}*\n\n` +
            `Status: *${status}*\n` +
            (start != null ? `Start count: ${start}\n` : '') +
            (remains != null ? `Remaining: ${remains}\n` : '')
          );
        } catch (err: any) {
          await ctx.m.reply(`❌ Track error: ${err?.message}`);
        }
      },
    },

    {
      name: 'wa-channel',
      aliases: ['wachannel', 'channelboost'],
      category: 'boost',
      cooldownMs: 10000,
      description: 'Boost a WhatsApp channel followers package (owner only)',
      example: '.wa-channel https://whatsapp.com/channel/0029... boost-500',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) return ctx.m.reply('🔒 Only the bot owner can buy boost packages.');
        if (!BWM_READY()) return ctx.m.reply('🔑 Set `BWM_SESSION_TOKEN` in .env first.');

        const [link, planId] = ctx.args;
        if (!link || !planId) {
          return ctx.m.reply(
            `Usage: ${ctx.prefix}wa-channel <channel link> <plan>\n\nPlans:\n${PLAN_HELP}`
          );
        }
        const plan = BOOST_PLANS.find(p => p.id === planId.toLowerCase());
        if (!plan) return ctx.m.reply(`❌ Unknown plan "${planId}".\n\nPlans:\n${PLAN_HELP}`);
        if (!/^https?:\/\//i.test(link)) return ctx.m.reply('❌ The link must start with http:// or https://');

        await ctx.m.react('⏳').catch(() => {});
        try {
          const result = await purchaseBoost(plan, link, config.BWM_SESSION_TOKEN);
          if (result?.success === false) {
            return ctx.m.reply(`❌ ${result?.error || 'Boost purchase failed'}`);
          }
          await ctx.m.reply(
            `🚀 *Boost purchased!*\n\n` +
            `📦 ${plan.label}\n` +
            `🔗 ${link}\n` +
            `💸 ${plan.xd} XD\n` +
            `💳 New balance: ${result?.new_balance ?? '—'} XD\n\n` +
            `Submit your channel details if the dashboard asks, and the boost starts.`
          );
        } catch (err: any) {
          await ctx.m.reply(`❌ Boost failed: ${err?.message}`);
        }
      },
    },

    // ------------------------------------------------------ own SMM panel --
    {
      name: 'pservices',
      aliases: ['psvc', 'panelservices'],
      category: 'boost',
      description: 'List services from your own SMM panel',
      example: '.pservices followers',
      execute: async (ctx: CommandContext) => {
        const panel = PANEL();
        if (!panel) return ctx.m.reply('🔑 Set `SMM_API_URL` and `SMM_API_KEY` in .env first.');
        await ctx.m.react('⏳').catch(() => {});
        try {
          const services = await panelServices(panel);
          if (!services.length) return ctx.m.reply('❌ Your panel returned no services.');
          const shown = searchServices(services, ctx.text);
          await ctx.m.reply(
            `📊 *Your panel* (${services.length} services)\n\n` +
            shown.map(serviceLine).join('\n\n') +
            `\n\n💡 ${ctx.prefix}porder <id> <link> <qty>`
          );
        } catch (err: any) {
          await ctx.m.reply(`❌ Panel error: ${err?.message}`);
        }
      },
    },

    {
      name: 'pbal',
      aliases: ['panelbalance'],
      category: 'boost',
      description: 'Balance on your own SMM panel',
      example: '.pbal',
      execute: async (ctx: CommandContext) => {
        const panel = PANEL();
        if (!panel) return ctx.m.reply('🔑 Set `SMM_API_URL` and `SMM_API_KEY` in .env first.');
        try {
          const balance = await panelBalance(panel);
          await ctx.m.reply(`💰 *Panel balance*\n\n${balance}`);
        } catch (err: any) {
          await ctx.m.reply(`❌ Panel error: ${err?.message}`);
        }
      },
    },

    {
      name: 'porder',
      aliases: ['panelorder'],
      category: 'boost',
      cooldownMs: 10000,
      description: 'Place an order on your own SMM panel (owner only)',
      example: '.porder 1234 https://tiktok.com/@you/video/1 500',
      execute: async (ctx: CommandContext) => {
        if (!ctx.isCreator) return ctx.m.reply('🔒 Only the bot owner can place paid orders.');
        const panel = PANEL();
        if (!panel) return ctx.m.reply('🔑 Set `SMM_API_URL` and `SMM_API_KEY` in .env first.');

        const [idArg, link, qtyArg] = ctx.args;
        if (!idArg || !link || !qtyArg) {
          return ctx.m.reply(`Usage: ${ctx.prefix}porder <service id> <link> <quantity>`);
        }
        const serviceId = Number(idArg);
        const quantity = Number(qtyArg);
        if (!Number.isFinite(serviceId)) return ctx.m.reply('❌ Service id must be a number.');
        if (!Number.isFinite(quantity) || quantity <= 0) return ctx.m.reply('❌ Quantity must be a positive number.');
        if (!/^https?:\/\//i.test(link)) return ctx.m.reply('❌ The link must start with http:// or https://');

        await ctx.m.react('⏳').catch(() => {});
        try {
          const result = await panelOrder(panel, serviceId, link, quantity);
          await ctx.m.reply(`✅ *Order placed*\n\n🧾 Order: *${result?.order ?? '—'}*`);
        } catch (err: any) {
          await ctx.m.reply(`❌ Panel order failed: ${err?.message}`);
        }
      },
    },

    {
      name: 'pstatus',
      aliases: ['panelstatus'],
      category: 'boost',
      description: 'Track an order on your own SMM panel',
      example: '.pstatus 98765',
      execute: async (ctx: CommandContext) => {
        const panel = PANEL();
        if (!panel) return ctx.m.reply('🔑 Set `SMM_API_URL` and `SMM_API_KEY` in .env first.');
        const orderId = ctx.args[0];
        if (!orderId) return ctx.m.reply(`Usage: ${ctx.prefix}pstatus <order id>`);
        try {
          const res = await panelStatus(panel, orderId);
          const status = res?.status || 'unknown';
          const start = res?.start_count;
          const remains = res?.remains;
          await ctx.m.reply(
            `📦 *Panel order ${orderId}*\n\nStatus: *${status}*\n` +
            (start != null ? `Start count: ${start}\n` : '') +
            (remains != null ? `Remaining: ${remains}\n` : '')
          );
        } catch (err: any) {
          await ctx.m.reply(`❌ ${err?.message}`);
        }
      },
    },
  ];
}
