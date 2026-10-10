import type { Command, CommandContext } from '../../core/types.js';


export default function funCommands(): Command[] {
  const truthQuestions = [
    "What's your biggest fear?",
    "What's the most embarrassing thing you've ever done?",
    "Have you ever lied to your best friend?",
    "What's your secret crush's name?",
    "What's the worst thing you've ever said about someone?",
    "Have you ever cheated on a test?",
    "What's your most embarrassing moment?",
    "Do you have a secret talent?",
    "What's the weirdest thing you've eaten?",
    "Have you ever broken someone's trust?",
    "What's your biggest regret?",
    "What's the craziest thing you've done for love?",
    "Have you ever eavesdropped on someone?",
    "What's your guilty pleasure?",
    "Have you ever fallen asleep in class?",
  ];

  const dareQuestions = [
    "Send a message to your crush",
    "Do 20 push-ups right now",
    "Sing your favorite song out loud",
    "Call someone and tell them a joke",
    "Dance for 30 seconds",
    "Take a selfie and post it",
    "Text your mom 'I love you'",
    "Do your best celebrity impression",
    "Speak in an accent for the next 5 minutes",
    "Eat something you don't like",
    "Do a funny dance",
    "Make a funny face and send a selfie",
    "Tell a joke to the person next to you",
    "Do 10 jumping jacks",
    "Speak like a pirate for 5 minutes",
  ];

  const randomFacts = [
    "Honey never spoils. Archaeologists have found 3000-year-old honey that was still edible.",
    "Octopuses have three hearts and blue blood.",
    "A group of flamingos is called a 'flamboyance'.",
    "The shortest war in history was between Britain and Zanzibar in 1896 - it lasted 38 minutes.",
    "Bananas are berries, but strawberries aren't.",
    "A cloud can weigh more than a million pounds.",
    "The Eiffel Tower can grow taller in summer due to heat expansion.",
    "Cows have best friends and get stressed when they're separated.",
    "A day on Venus is longer than its year.",
    "The human body produces enough heat in 30 minutes to boil half a gallon of water.",
    "Honeybees can recognize human faces.",
    "The world's largest snowflake was 15 inches wide.",
    "Butterflies taste with their feet.",
    "A jumbo jet's wingspan is longer than a football field.",
    "The Great Wall of China is visible from space with the naked eye.",
  ];

  const pickUpLines = [
    "Are you a magician? Because whenever I look at you, everyone else disappears.",
    "Do you have a map? I keep getting lost in your eyes.",
    "Are you a time traveler? Because I see you in my future.",
    "Is your name Google? Because you have everything I've been searching for.",
    "Are you a parking ticket? Because you've got 'fine' written all over you.",
    "Do you believe in love at first sight, or should I walk by again?",
    "Are you a camera? Because every time I look at you, I smile.",
    "If you were a vegetable, you'd be a 'cute-cumber'.",
    "Is your dad a boxer? Because you're a knockout!",
    "Are you Wi-Fi? Because I'm feeling a connection.",
  ];

  return [
    {
      name: 'truth',
      aliases: ['t'],
      category: 'fun',
      description: 'Get a random truth question',
      execute: async (ctx: CommandContext) => {
        const q = truthQuestions[Math.floor(Math.random() * truthQuestions.length)];
        await ctx.m.reply(`🤔 *TRUTH*\n\n${q}`);
      },
    },
    {
      name: 'dare',
      aliases: ['d'],
      category: 'fun',
      description: 'Get a random dare',
      execute: async (ctx: CommandContext) => {
        const q = dareQuestions[Math.floor(Math.random() * dareQuestions.length)];
        await ctx.m.reply(`😈 *DARE*\n\n${q}`);
      },
    },
    {
      name: 'fact',
      aliases: ['randomfact'],
      category: 'fun',
      description: 'Get a random fact',
      execute: async (ctx: CommandContext) => {
        const fact = randomFacts[Math.floor(Math.random() * randomFacts.length)];
        await ctx.m.reply(`🧠 *Random Fact*\n\n${fact}`);
      },
    },
    {
      name: 'quote',
      aliases: ['quotes'],
      category: 'fun',
      description: 'Get a random quote',
      execute: async (ctx: CommandContext) => {
        const quotes = [
          '"The only way to do great work is to love what you do." - Steve Jobs',
          '"Innovation distinguishes between a leader and a follower." - Steve Jobs',
          '"Stay hungry, stay foolish." - Steve Jobs',
          '"Life is what happens when you\'re busy making other plans." - John Lennon',
          '"The future belongs to those who believe in the beauty of their dreams." - Eleanor Roosevelt',
          '"It is during our darkest moments that we must focus to see the light." - Aristotle',
          '"The only impossible journey is the one you never begin." - Tony Robbins',
          '"In the middle of difficulty lies opportunity." - Albert Einstein',
          '"Be yourself; everyone else is already taken." - Oscar Wilde',
          '"So many books, so little time." - Frank Zappa',
        ];
        const quote = quotes[Math.floor(Math.random() * quotes.length)];
        await ctx.m.reply(`💭 *Quote*\n\n${quote}`);
      },
    },
    {
      name: 'roast',
      category: 'fun',
      description: 'Roast someone',
      example: '.roast @user',
      execute: async (ctx: CommandContext) => {
        const target = ctx.m.mentionedJid[0] ? `@${ctx.m.mentionedJid[0].split('@')[0]}` : 'you';
        const roasts = [
          `${target}, you're the reason the gene pool needs a lifeguard.`,
          `${target}, you bring everyone so much joy... when you leave the room.`,
          `${target}, you're proof that even nature makes mistakes.`,
          `${target}, I'd agree with you but then we'd both be wrong.`,
          `${target}, you have something on your chin... no, the third one down.`,
          `${target}, you're like a software update - nobody wants you.`,
          `${target}, you're not stupid; you just have bad luck with thinking.`,
          `${target}, I'm not saying you're annoying, but you're why I drink.`,
        ];
        const roast = roasts[Math.floor(Math.random() * roasts.length)];
        await ctx.m.reply(`🔥 *Roast*\n\n${roast}`, { mentions: ctx.m.mentionedJid });
      },
    },
    {
      name: 'flirt',
      category: 'fun',
      description: 'Get a pickup line',
      execute: async (ctx: CommandContext) => {
        const line = pickUpLines[Math.floor(Math.random() * pickUpLines.length)];
        await ctx.m.reply(`😘 *Pick Up Line*\n\n${line}`);
      },
    },
    {
      name: '8ball',
      aliases: ['magicball', 'ball'],
      category: 'fun',
      description: 'Ask the magic 8-ball a question',
      example: '.8ball Will I be rich?',
      execute: async (ctx: CommandContext) => {
        if (!ctx.text) return ctx.m.reply(`Usage: ${ctx.prefix}8ball <question>`);
        const answers = [
          'It is certain.', 'It is decidedly so.', 'Without a doubt.', 'Yes - definitely.',
          'You may rely on it.', 'As I see it, yes.', 'Most likely.', 'Outlook good.',
          'Yes.', 'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.',
          'Better not tell you now.', 'Cannot predict now.', 'Concentrate and ask again.',
          "Don't count on it.", 'My reply is no.', 'My sources say no.',
          'Outlook not so good.', 'Very doubtful.',
        ];
        const answer = answers[Math.floor(Math.random() * answers.length)];
        await ctx.m.reply(`🎱 *Magic 8-Ball*\n\nQ: ${ctx.text}\nA: ${answer}`);
      },
    },
    {
      name: 'roll',
      aliases: ['dice'],
      category: 'fun',
      description: 'Roll a dice',
      example: '.roll 20',
      execute: async (ctx: CommandContext) => {
        const sides = parseInt(ctx.args[0]) || 6;
        const result = Math.floor(Math.random() * sides) + 1;
        await ctx.m.reply(`🎲 Rolled a ${result} (1-${sides})`);
      },
    },
    {
      name: 'coinflip',
      aliases: ['coin', 'flip'],
      category: 'fun',
      description: 'Flip a coin',
      execute: async (ctx: CommandContext) => {
        const result = Math.random() > 0.5 ? 'Heads 🪙' : 'Tails 🪙';
        await ctx.m.reply(`🪙 Coin Flip: ${result}`);
      },
    },
    {
      name: 'ship',
      category: 'fun',
      description: 'Ship two people',
      example: '.ship @user1 @user2',
      execute: async (ctx: CommandContext) => {
        const users = ctx.m.mentionedJid;
        if (users.length < 2) return ctx.m.reply(`Usage: ${ctx.prefix}ship @user1 @user2`);
        const percentage = Math.floor(Math.random() * 101);
        const emojis = percentage > 75 ? '💖💕' : percentage > 50 ? '👍' : percentage > 25 ? '🤔' : '💔';
        await ctx.m.reply(
          `💝 *Ship*\n\n` +
          `@${users[0].split('@')[0]} 💕 @${users[1].split('@')[0]}\n` +
          `Match: ${percentage}% ${emojis}`,
          { mentions: users }
        );
      },
    },
  ];
}
