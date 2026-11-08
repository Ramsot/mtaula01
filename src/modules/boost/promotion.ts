import type { Command, CommandContext } from '../../core/types.js';

/**
 * Promotion helpers that need no API key: caption templates, hashtag packs,
 * per-platform growth checklists and posting-time guidance. Kept separate from
 * index.ts so the paid-order commands stay easy to audit.
 */

const CAPTION_HOOKS = [
  'Stop scrolling — this is worth 10 seconds 👇',
  'Most people get this wrong. Here is what actually works:',
  'I tested this for 30 days. Results:',
  'Save this before it disappears 📌',
  'Nobody talks about this part:',
  'POV: you finally found the shortcut',
];

const CAPTION_CTAS = [
  'Follow for more — new post every day.',
  'Tag someone who needs to see this.',
  'Drop a 🔥 if you want part 2.',
  'Save it, you will need it later.',
  'Comment YES and I will send you the details.',
  'Share to your story so your people see it too.',
];

const HASHTAG_PACKS: Record<string, string[]> = {
  business: ['#business', '#entrepreneur', '#smallbusiness', '#startup', '#marketing', '#hustle', '#success', '#mindset'],
  music: ['#music', '#newmusic', '#songoftheday', '#viral', '#fyp', '#singer', '#producer', '#musician'],
  tech: ['#tech', '#technology', '#ai', '#coding', '#developer', '#innovation', '#startup', '#programming'],
  fashion: ['#fashion', '#style', '#outfitoftheday', '#ootd', '#trending', '#lookbook', '#streetstyle', '#instafashion'],
  food: ['#food', '#foodie', '#recipe', '#homemade', '#delicious', '#cooking', '#foodporn', '#yummy'],
  fitness: ['#fitness', '#gym', '#workout', '#fitfam', '#health', '#motivation', '#training', '#lifestyle'],
  travel: ['#travel', '#wanderlust', '#exploremore', '#travelgram', '#adventure', '#vacation', '#travelphotography', '#nature'],
  default: ['#viral', '#trending', '#fyp', '#explore', '#reels', '#instagood', '#photooftheday', '#love'],
};

interface GrowthStep { step: string; detail: string; }

const GROWTH_PLANS: Record<string, GrowthStep[]> = {
  instagram: [
    { step: 'Optimise the profile', detail: 'Clear photo, name with your keyword, bio saying exactly what you help with + a CTA.' },
    { step: 'Post 3–5 Reels a week', detail: 'Reels get pushed to non-followers — that is where new audience comes from.' },
    { step: 'Hook in the first 1.5s', detail: 'Open with a claim or a question, never with a logo or intro.' },
    { step: 'Reply to every comment in 1h', detail: 'Early engagement tells the algorithm the post is worth showing.' },
    { step: 'Engage before and after posting', detail: '20 min commenting on similar accounts in your niche, daily.' },
    { step: 'Use 3–8 niche hashtags', detail: 'Mix small (under 500k) and mid tags — big tags bury you instantly.' },
    { step: 'Collaborate once a week', detail: 'Joint Reels or collab posts put you in front of a matched audience.' },
    { step: 'Review insights every Sunday', detail: 'Keep the formats with the best reach, drop the rest.' },
  ],
  tiktok: [
    { step: 'Niche down hard', detail: 'One topic, one format. The algorithm needs to know who to show you to.' },
    { step: 'Post 1–3 times daily', detail: 'Volume beats polish — TikTok rewards consistent testing.' },
    { step: 'Hook in the first second', detail: 'Text on screen + a pattern interrupt before you say a word.' },
    { step: 'Reply with video', detail: 'Comment replies as videos are pushed hard and build community.' },
    { step: 'Ride sounds early', detail: 'Use a sound while it is climbing, not after it is everywhere.' },
    { step: 'Loop your videos', detail: 'End where you started so rewatches count as retention.' },
    { step: 'Check watch time, not likes', detail: 'Retention is the metric that decides distribution.' },
    { step: 'Reuse winning formats', detail: 'Remake your top 3 performers with a new angle.' },
  ],
  youtube: [
    { step: 'Search-first titles', detail: 'Answer what people actually type — use the autocomplete suggestions.' },
    { step: 'Thumbnails with 3 words max', detail: 'One face, one emotion, high contrast. Test it on a phone screen.' },
    { step: 'First 30 seconds = promise', detail: 'State the payoff immediately, then deliver.' },
    { step: '8–15 minute videos', detail: 'Long enough for mid-rolls, short enough to hold retention.' },
    { step: 'Shorts 3–5x a week', detail: 'Shorts are the cheapest subscriber engine on the platform.' },
    { step: 'Playlists by topic', detail: 'Keeps viewers in a session instead of leaving after one video.' },
    { step: 'Pin a comment with a CTA', detail: 'Ask for the subscribe where people already are.' },
    { step: 'Double down on the spike', detail: 'When one video pops, make the follow-up within 48 hours.' },
  ],
  whatsapp: [
    { step: 'Publish a channel invite link', detail: 'Put it in your bio, status and every group you are in.' },
    { step: 'Post 1–2 updates daily', detail: 'Consistency keeps you at the top of the Updates tab.' },
    { step: 'Lead with value, not ads', detail: 'Tips, deals and news first — promotional posts second.' },
    { step: 'Cross-post to Status', detail: 'Every channel update can be shared to Status for extra reach.' },
    { step: 'Add people from your contacts', detail: 'Channel members appear in their Updates — warm traffic converts.' },
    { step: 'Use reactions and polls', detail: 'Interaction signals keep the channel surfaced.' },
    { step: 'Promote in related groups', detail: 'Share the invite where the topic is already the subject.' },
    { step: 'Track member growth weekly', detail: 'Note which posts added members and repeat that format.' },
  ],
};

const BEST_TIMES: Record<string, string> = {
  Instagram: 'Tue–Fri 11:00–13:00 and 19:00–21:00 (your audience local time)',
  TikTok: 'Tue 06:00, Wed 07:00, Thu 05:00, Fri 04:00 — plus 19:00–21:00 daily',
  YouTube: 'Fri–Sat 14:00–16:00, and Thu 15:00–16:00 for long-form',
  Facebook: 'Wed 11:00–13:00, Fri 10:00–11:00',
  X: 'Mon–Fri 08:00–10:00 and 12:00–13:00',
  WhatsApp: 'Tue–Thu 09:00–11:00 and 17:00–19:00',
};

function pick<T>(list: T[], seed: number): T {
  return list[Math.abs(seed) % list.length];
}

export default function promotionCommands(): Command[] {
  return [
    {
      name: 'promo',
      aliases: ['caption', 'promo-caption'],
      category: 'boost',
      description: 'Generate a ready-to-post promo caption for a niche',
      example: '.promo digital marketing',
      execute: async (ctx: CommandContext) => {
        const niche = ctx.text || 'my brand';
        const seed = Date.now();
        const hook = pick(CAPTION_HOOKS, seed);
        const cta = pick(CAPTION_CTAS, seed + 7);
        const tags = HASHTAG_PACKS.default.slice(0, 6).join(' ');

        const caption =
          `${hook}\n\n` +
          `Here is the short version about ${niche}:\n` +
          `1️⃣ Start with the problem your audience already feels\n` +
          `2️⃣ Show one concrete win or proof\n` +
          `3️⃣ Tell them exactly what to do next\n\n` +
          `${cta}\n\n${tags}`;

        await ctx.m.reply(
          `📝 *Promo caption — ${niche}*\n\n${caption}\n\n` +
          `💡 Tip: swap the first line for a real result from your own page — specificity beats cleverness.`
        );
      },
    },

    {
      name: 'tags',
      aliases: ['hashtag', 'hashtags'],
      category: 'boost',
      description: 'Hashtag pack for a topic',
      example: '.tags music',
      execute: async (ctx: CommandContext) => {
        const topic = (ctx.args[0] || '').toLowerCase();
        const pack = HASHTAG_PACKS[topic];
        const tags = pack || HASHTAG_PACKS.default;
        const label = pack ? topic : (ctx.text || 'general');

        await ctx.m.reply(
          `#️⃣ *Hashtag pack — ${label}*\n\n${tags.join(' ')}\n\n` +
          (pack ? '' : `Available packs: ${Object.keys(HASHTAG_PACKS).filter(k => k !== 'default').join(', ')}\n`) +
          `\n💡 Use 3–8 per post. Mix in 2–3 tags specific to *your* content, not just these.`
        );
      },
    },

    {
      name: 'growth',
      aliases: ['growthplan', 'grow'],
      category: 'boost',
      description: 'Step-by-step growth checklist for a platform',
      example: '.growth tiktok',
      execute: async (ctx: CommandContext) => {
        const key = (ctx.args[0] || '').toLowerCase();
        const plan = GROWTH_PLANS[key];
        if (!plan) {
          return ctx.m.reply(
            `Usage: ${ctx.prefix}growth <platform>\n\nPlatforms: ${Object.keys(GROWTH_PLANS).join(', ')}`
          );
        }
        const label = key.charAt(0).toUpperCase() + key.slice(1);
        const body = plan
          .map((s, i) => `${i + 1}. *${s.step}*\n   ${s.detail}`)
          .join('\n\n');

        await ctx.m.reply(`📈 *${label} growth checklist*\n\n${body}`);
      },
    },

    {
      name: 'besttime',
      aliases: ['posttime', 'timing'],
      category: 'boost',
      description: 'Best times to post on each platform',
      example: '.besttime tiktok',
      execute: async (ctx: CommandContext) => {
        const key = (ctx.args[0] || '').toLowerCase();
        const entry = Object.entries(BEST_TIMES).find(([name]) => name.toLowerCase().startsWith(key));

        if (entry) {
          await ctx.m.reply(`⏰ *Best time — ${entry[0]}*\n\n${entry[1]}`);
          return;
        }
        const body = Object.entries(BEST_TIMES)
          .map(([name, times]) => `• *${name}*: ${times}`)
          .join('\n');
        await ctx.m.reply(
          `⏰ *Best posting times*\n\n${body}\n\n` +
          `💡 These are global averages — after 2 weeks, switch to when *your* Insights say your audience is online.`
        );
      },
    },
  ];
}
