import crypto from 'crypto';

/**
 * Pure analysis helpers behind the `.security` command pack.
 *
 * Everything here is offline and side-effect free — no network, no shell, no
 * writes — so it can be unit tested directly and cannot be turned into an
 * attack tool against a third party. The commands only add I/O on top (DNS,
 * RDAP, HTTP, a TLS handshake, or a TCP connect the user explicitly authorised).
 */

// ---------------------------------------------------------------------------
// Hash identification
// ---------------------------------------------------------------------------

export interface HashGuess {
  name: string;
  confidence: 'high' | 'medium' | 'low';
  note?: string;
}

const HEX = /^[a-f0-9]+$/i;

/**
 * Identify likely hash formats from shape alone. This is a family guess, not a
 * verdict: MD5 and NTLM are both 32 hex chars and cannot be told apart without
 * context, so both are reported.
 */
export function identifyHash(input: string): HashGuess[] {
  const value = (input || '').trim();
  if (!value) return [];

  const guesses: HashGuess[] = [];
  const add = (name: string, confidence: HashGuess['confidence'], note?: string) =>
    guesses.push({ name, confidence, note });

  // Prefixed formats are unambiguous.
  if (/^\$2[abxy]?\$\d{2}\$/.test(value)) add('bcrypt', 'high', 'cost factor is the number after $2x$');
  else if (/^\$argon2(id|i|d)\$/.test(value)) add('Argon2', 'high');
  else if (/^\$apr1\$/.test(value)) add('Apache MD5-crypt (apr1)', 'high');
  else if (/^\$1\$/.test(value)) add('MD5-crypt (Unix)', 'high');
  else if (/^\$5\$/.test(value)) add('SHA-256-crypt (Unix)', 'high');
  else if (/^\$6\$/.test(value)) add('SHA-512-crypt (Unix)', 'high');
  else if (/^\$P\$|^\$H\$/.test(value)) add('phpass (WordPress)', 'high');
  else if (/^\$y\$/.test(value)) add('yescrypt', 'high');
  else if (/^\{SSHA\}/.test(value)) add('LDAP SSHA', 'high');
  else if (/^\$krb5(asrep|tgs|pa)\$/.test(value)) add('Kerberos 5', 'high');
  else if (/^\*[A-F0-9]{40}$/i.test(value)) add('MySQL 4.1+ (PASSWORD())', 'high');
  else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    // A bare UUID is a value, not a hash — but people paste them here.
    add('UUID (not a hash)', 'high');
  }

  if (HEX.test(value)) {
    switch (value.length) {
      case 16:
        add('CRC-64 / MySQL 3.x', 'medium');
        break;
      case 32:
        add('MD5', 'high');
        add('NTLM', 'medium', 'same 32-hex shape as MD5 - only context tells them apart');
        break;
      case 40:
        add('SHA-1', 'high');
        add('MySQL 4.1+ / RIPEMD-160', 'medium');
        break;
      case 56:
        add('SHA-224', 'high');
        break;
      case 64:
        add('SHA-256', 'high');
        add('SHA3-256 / Keccak-256', 'low');
        break;
      case 96:
        add('SHA-384', 'high');
        break;
      case 128:
        add('SHA-512', 'high');
        add('Whirlpool', 'low');
        break;
      default:
        add(`unknown hex digest (${value.length} chars)`, 'low');
    }
  }

  if (!guesses.length && /^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0) {
    add('base64 - decode it first, then identify again', 'low');
  }

  if (!guesses.length && /^\d{10}$/.test(value)) add('Unix timestamp (seconds)', 'medium');
  if (!guesses.length && /^\d{13}$/.test(value)) add('Unix timestamp (milliseconds)', 'medium');

  return guesses;
}

/** The digest algorithms we can locally test a candidate against. */
export const CRACKABLE_ALGORITHMS = ['md5', 'sha1', 'sha256', 'sha512'] as const;
export type CrackableAlgorithm = (typeof CRACKABLE_ALGORITHMS)[number];

/** Best guess at a locally testable digest, or null when it is a slow/KDF format. */
export function crackableAlgorithm(input: string): CrackableAlgorithm | null {
  const value = (input || '').trim();
  if (/^\$2[abxy]?\$|^\$argon2|^\$1\$|^\$5\$|^\$6\$|^\$P\$|^\$H\$|^\{SSHA\}/i.test(value)) {
    // KDFs are deliberately slow: a dictionary attack here is not worth running
    // from a chat command and would just burn the host CPU.
    return null;
  }
  if (!HEX.test(value)) return null;
  switch (value.length) {
    case 32:
      return 'md5';
    case 40:
      return 'sha1';
    case 64:
      return 'sha256';
    case 128:
      return 'sha512';
    default:
      return null;
  }
}

function digest(algorithm: CrackableAlgorithm, input: string): string {
  return crypto.createHash(algorithm).update(input).digest('hex');
}

export interface CrackResult {
  password: string | null;
  algorithm: CrackableAlgorithm;
  attempts: number;
  timedOut: boolean;
}

/**
 * Local dictionary attack against a hash the *user* supplied, for CTF practice
 * and auditing their own data. Pure computation: it never touches the network,
 * so it cannot be aimed at someone else's login.
 *
 * Each word is tried raw, lowercased and capitalised, plus common suffix
 * mutations. The loop checks a time budget so a large wordlist cannot hang the
 * bot.
 */
export function crackHash(
  hash: string,
  words: Iterable<string>,
  opts: { algorithm: CrackableAlgorithm; budgetMs?: number; maxAttempts?: number }
): CrackResult {
  const target = hash.trim().toLowerCase();
  const budgetMs = opts.budgetMs ?? 8000;
  const maxAttempts = opts.maxAttempts ?? 200_000;
  const startedAt = Date.now();

  let attempts = 0;
  let timedOut = false;

  const suffixes = ['', '0', '1', '2', '3', '7', '9', '12', '21', '123', '1234', '!', '2024', '2025', '2026'];

  for (const raw of words) {
    const word = (raw || '').replace(/\r?\n/g, '').trim();
    if (!word) continue;
    if (word.length > 64) continue;

    const variants = new Set<string>([
      word,
      word.toLowerCase(),
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    ]);
    for (const base of Array.from(variants)) {
      for (const suffix of suffixes) {
        const candidate = suffix ? `${base}${suffix}` : base;
        attempts += 1;
        if (digest(opts.algorithm, candidate) === target) {
          return { password: candidate, algorithm: opts.algorithm, attempts, timedOut: false };
        }
        if (attempts % 2000 === 0) {
          if (Date.now() - startedAt > budgetMs || attempts > maxAttempts) {
            return { password: null, algorithm: opts.algorithm, attempts, timedOut: true };
          }
        }
      }
    }
  }

  return { password: null, algorithm: opts.algorithm, attempts, timedOut: false };
}

/** A small built-in wordlist (common passwords) for `.crack` without an upload. */
export const BUILTIN_WORDLIST: string[] = [
  'password', '123456', '123456789', '12345678', 'qwerty', 'abc123', 'password1', '111111',
  '123123', 'admin', 'letmein', 'welcome', 'monkey', 'dragon', 'football', 'iloveyou',
  'master', 'sunshine', 'princess', 'shadow', 'superman', 'michael', 'trustno1', 'batman',
  'hello', 'freedom', 'whatever', 'qazwsx', 'starwars', 'computer', 'internet', 'samsung',
  'nairobi', 'tanzania', 'kenya', 'mtaula', 'diamond', 'arsenal', 'chelsea', 'messi',
  'ronaldo', 'google', 'facebook', 'whatsapp', 'secret', 'summer', 'winter', 'flower',
  'charlie', 'daniel', 'jessica', 'jordan', 'harley', 'ranger', 'buster', 'soccer',
  'hockey', 'killer', 'george', 'andrew', 'pepper', 'ginger', 'zaq12wsx', 'qwerty123',
  'passw0rd', 'p@ssword', 'p@ssw0rd', 'admin123', 'root', 'toor', 'test', 'test123',
  'changeme', 'default', 'guest', 'user', 'login', 'secret123', 'iloveu', 'loveme',
  'tinkerbell', 'jesus', 'angel', 'family', 'mother', 'school', 'money', 'bitcoin',
];

// ---------------------------------------------------------------------------
// Password strength
// ---------------------------------------------------------------------------

export interface PasswordReport {
  length: number;
  charsetSize: number;
  entropyBits: number;
  score: 0 | 1 | 2 | 3 | 4;
  verdict: string;
  onlineGuessTime: string;
  offlineGuessTime: string;
  warnings: string[];
}

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '123456', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'abc123', 'letmein', 'welcome', 'monkey', 'dragon', 'iloveyou',
  'admin', 'admin123', 'root', 'toor', 'login', 'guest', 'master', 'sunshine', 'princess',
  'football', 'baseball', 'superman', 'batman', 'trustno1', 'changeme', 'secret', 'passw0rd',
]);

const KEYBOARD_RUNS = ['qwerty', 'asdf', 'zxcv', 'qazwsx', '1234', 'abcd', 'qwer'];

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'effectively forever';
  if (seconds < 1) return 'instantly';
  const units: Array<[string, number]> = [
    ['year', 31_536_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [label, size] of units) {
    if (seconds >= size) {
      const value = seconds / size;
      const rounded = value >= 100 ? Math.round(value).toLocaleString('en-US') : value.toFixed(1);
      return `${rounded} ${label}${Number(rounded) === 1 && size === 1 ? '' : 's'}`;
    }
  }
  return `${seconds.toFixed(3)} seconds`;
}

/**
 * Charset-aware entropy estimate plus pattern penalties. It deliberately
 * penalises the shapes that make a long password weak (a dictionary word, a
 * keyboard run, a date, pure repetition) instead of only counting characters.
 */
export function analyzePassword(password: string): PasswordReport {
  const value = password || '';
  const warnings: string[] = [];

  let charsetSize = 0;
  if (/[a-z]/.test(value)) charsetSize += 26;
  if (/[A-Z]/.test(value)) charsetSize += 26;
  if (/[0-9]/.test(value)) charsetSize += 10;
  if (/[^A-Za-z0-9]/.test(value)) charsetSize += 33;

  const rawEntropy = value.length > 0 ? value.length * Math.log2(Math.max(charsetSize, 2)) : 0;
  let entropyBits = rawEntropy;

  const lower = value.toLowerCase();

  if (COMMON_PASSWORDS.has(lower)) {
    warnings.push('in the top common-password list');
    entropyBits = Math.min(entropyBits, 12);
  }
  const dictionaryWord = lower.length >= 4 && /^[a-z]+$/.test(lower) && !/^[a-z]{1,3}$/.test(lower)
    ? /\b(password|admin|welcome|secret|qwerty|login|money|love|god|boss|hello)\b/.test(lower)
    : false;
  if (dictionaryWord) {
    warnings.push('a single dictionary word (try a multi-word passphrase)');
    entropyBits -= 12;
  }
  if (KEYBOARD_RUNS.some(run => lower.includes(run))) {
    warnings.push('contains a keyboard/written sequence (qwerty, 1234, abcd)');
    entropyBits -= 8;
  }
  if (/(.)\1{2,}/.test(value)) {
    warnings.push('repeated characters (aaa, 111)');
    entropyBits -= 6;
  }
  if (/(19|20)\d{2}/.test(value)) {
    warnings.push('contains a year - very common pattern');
    entropyBits -= 6;
  }
  if (/^[a-z]+$/.test(value) || /^\d+$/.test(value)) {
    warnings.push('single character class only');
    entropyBits -= 6;
  }
  if (/^[A-Z][a-z]+\d{1,4}!?$/.test(value)) {
    warnings.push('looks like Name+digits - the first pattern every cracker tries');
    entropyBits -= 10;
  }
  if (value.length < 12) warnings.push('shorter than 12 characters');

  entropyBits = Math.max(0, Math.round(entropyBits));

  // A GPU rig tries ~1e10 guesses/sec; an online login form ~1e3/sec.
  const guesses = Math.pow(2, Math.min(entropyBits, 200));
  const onlineGuessTime = formatDuration(guesses / 2 / 1e3);
  const offlineGuessTime = formatDuration(guesses / 2 / 1e10);

  let score: PasswordReport['score'] = 0;
  if (entropyBits >= 28) score = 1;
  if (entropyBits >= 46) score = 2;
  if (entropyBits >= 66) score = 3;
  if (entropyBits >= 90) score = 4;

  const verdict =
    score === 0 ? 'Very weak' :
    score === 1 ? 'Weak' :
    score === 2 ? 'Reasonable' :
    score === 3 ? 'Strong' : 'Very strong';

  return {
    length: value.length,
    charsetSize,
    entropyBits,
    score,
    verdict,
    onlineGuessTime,
    offlineGuessTime,
    warnings,
  };
}

export function generatePassword(length = 20, opts: { symbols?: boolean; ambiguous?: boolean } = {}): string {
  const symbols = opts.symbols ?? true;
  let alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  if (symbols) alphabet += '!@#$%^&*()-_=+[]{}?';
  if (opts.ambiguous) alphabet += 'lIO01';

  const size = Math.min(Math.max(length, 8), 128);
  const bytes = crypto.randomBytes(size * 2);
  let out = '';
  for (let i = 0; out.length < size && i < bytes.length; i += 1) {
    // Rejection sampling keeps the distribution uniform instead of biased by %.
    const limit = 256 - (256 % alphabet.length);
    if (bytes[i] >= limit) continue;
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

const PASSPHRASE_WORDS = [
  'simba', 'tembo', 'kifaru', 'twiga', 'nyati', 'chui', 'paka', 'mbwa', 'ndege', 'samaki',
  'mti', 'maji', 'moto', 'jua', 'mwezi', 'nyota', 'mvua', 'upepo', 'bahari', 'mlima',
  'safari', 'daraja', 'shule', 'kitabu', 'kalamu', 'soko', 'chakula', 'nyumbani', 'rafiki',
  'furaha', 'amani', 'nguvu', 'haraka', 'pole', 'siri', 'habari', 'gari', 'pikipiki',
];

export function generatePassphrase(wordCount = 4): string {
  const count = Math.min(Math.max(wordCount, 3), 8);
  const picks: string[] = [];
  while (picks.length < count) {
    const word = PASSPHRASE_WORDS[crypto.randomInt(0, PASSPHRASE_WORDS.length)];
    if (!picks.includes(word)) picks.push(word);
  }
  // One separator digit keeps entropy high while staying typeable on a phone.
  const separator = crypto.randomInt(0, 10);
  return picks.join(String(separator));
}

// ---------------------------------------------------------------------------
// Phishing heuristics
// ---------------------------------------------------------------------------

export interface PhishingReport {
  score: number;
  verdict: string;
  findings: string[];
}

const SUSPICIOUS_TLDS = [
  'zip', 'mov', 'top', 'xyz', 'tk', 'ml', 'ga', 'cf', 'gq', 'work', 'click', 'link',
  'country', 'kim', 'loan', 'rest', 'monster', 'quest', 'cfd', 'sbs',
];

const SHORTENERS = [
  'bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rebrand.ly', 'shorturl.at',
  'rb.gy', 'ow.ly', 'buff.ly', 't.ly', 'tiny.cc', 'soo.gd',
];

const TARGETED_BRANDS = [
  'paypal', 'whatsapp', 'facebook', 'instagram', 'netflix', 'apple', 'microsoft', 'google',
  'amazon', 'binance', 'metamask', 'trustwallet', 'mpesa', 'm-pesa', 'airtel', 'tigo',
  'halopesa', 'mixx', 'crdb', 'nmb', 'absa', 'stanbic', 'bank', 'crdb', 'equity',
  'safaricom', 'vodacom', 'airtel', 'twitter', 'linkedin', 'dhl', 'fedex', 'usps', 'irs',
];

const CREDENTIAL_PATHS = [
  'login', 'signin', 'verify', 'verification', 'account', 'update', 'secure', 'security',
  'password', 'wallet', 'seed', 'airdrop', 'claim', 'reward', 'bonus', 'otp', 'pin',
  'confirm', 'billing', 'invoice', 'unlock', 'suspend', 'recovery', 'kyc', 'refund',
];

/** Local, offline heuristics: no lookups, no reputation API, no network calls. */
export function scorePhishing(rawUrl: string): PhishingReport {
  const findings: string[] = [];
  let score = 0;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`);
  } catch {
    return { score: 0, verdict: 'Could not parse that URL', findings: ['invalid URL'] };
  }

  const host = url.hostname.toLowerCase();
  const full = url.href.toLowerCase();

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    score += 25;
    findings.push('host is a raw IP address, not a domain name');
  }
  if (host.includes('xn--')) {
    score += 25;
    findings.push('punycode domain (xn--) - a homograph trick for look-alike characters');
  }
  if (rawUrl.includes('@') && !/^mailto:/i.test(rawUrl)) {
    score += 20;
    findings.push('"@" in the URL hides the real host from a quick read');
  }
  if (url.protocol !== 'https:') {
    score += 10;
    findings.push('not HTTPS - credentials would travel in clear text');
  }
  if (SHORTENERS.includes(host)) {
    score += 10;
    findings.push('URL shortener: the real destination is hidden');
  }
  const tld = host.split('.').pop() || '';
  if (SUSPICIOUS_TLDS.includes(tld)) {
    score += 15;
    findings.push(`.${tld} is a TLD with a high abuse ratio`);
  }

  const labels = host.split('.');
  if (labels.length >= 5) {
    score += 10;
    findings.push(`very deep subdomain chain (${labels.length} labels)`);
  }
  if (labels.some(l => l.length > 30)) {
    score += 8;
    findings.push('an unusually long host label');
  }

  // Brand in a subdomain whose registrable domain is something else:
  // paypal.com.secure-login.tk
  const registrable = labels.slice(-2).join('.');
  const brandMatch = TARGETED_BRANDS.find(brand => host.includes(brand) && !registrable.includes(brand));
  if (brandMatch) {
    score += 25;
    findings.push(`"${brandMatch}" appears in the host but the real domain is ${registrable}`);
  } else {
    const brandElsewhere = TARGETED_BRANDS.find(
      brand => full.includes(brand) && !registrable.startsWith(brand)
    );
    if (brandElsewhere) {
      score += 5;
      findings.push(`brand name "${brandElsewhere}" appears in the path/subdomain only`);
    }
  }

  const pathHits = CREDENTIAL_PATHS.filter(word => full.includes(word));
  if (pathHits.length) {
    score += Math.min(15, 5 * pathHits.length);
    findings.push(`credential-bait wording: ${pathHits.slice(0, 5).join(', ')}`);
  }

  if (/\.(exe|apk|scr|bat|cmd|js|jar|msi|vbs)(\?|$)/.test(full)) {
    score += 20;
    findings.push('links directly to an executable/installer file');
  }

  score = Math.min(100, score);
  const verdict =
    score >= 75 ? 'Almost certainly phishing' :
    score >= 50 ? 'Highly suspicious - do not open' :
    score >= 20 ? 'Suspicious - verify the sender first' :
    'No strong phishing signals found (this is not a guarantee)';

  if (!findings.length) findings.push('nothing matched the heuristic checks');
  return { score, verdict, findings };
}

// ---------------------------------------------------------------------------
// Encoders / ciphers
// ---------------------------------------------------------------------------

const MORSE: Record<string, string> = {
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..',
  j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.',
  s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..',
  '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....',
  '6': '-....', '7': '--...', '8': '---..', '9': '----.',
};

const MORSE_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE).map(([letter, code]) => [code, letter])
);

export const CIPHER_MODES = [
  'b64e', 'b64d', 'hexe', 'hexd', 'urle', 'urld', 'rot13', 'caesar', 'vigenere',
  'morse', 'unmorse', 'binary', 'unbinary', 'rev', 'atbash',
] as const;

function atbash(text: string): string {
  return text.replace(/[a-z]/gi, ch => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(base + (25 - (ch.charCodeAt(0) - base)));
  });
}

function caesar(text: string, shift: number): string {
  const s = ((shift % 26) + 26) % 26;
  return text.replace(/[a-z]/gi, ch => {
    const base = ch <= 'Z' ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + s) % 26) + base);
  });
}

function vigenere(text: string, key: string, decode: boolean): string {
  const cleanKey = key.toLowerCase().replace(/[^a-z]/g, '');
  if (!cleanKey) throw new Error('Vigenere needs a key of letters, e.g. .cipher vigenere:key <text>');
  let index = 0;
  return text.replace(/[a-z]/gi, ch => {
    const base = ch <= 'Z' ? 65 : 97;
    const shift = cleanKey.charCodeAt(index % cleanKey.length) - 97;
    index += 1;
    const dir = decode ? -shift : shift;
    return String.fromCharCode(((ch.charCodeAt(0) - base + dir + 26) % 26) + base);
  });
}

/**
 * One entry point for every encoder/cipher, so `.cipher` can expose them all
 * without 15 near-identical commands. `mode` may carry a parameter
 * (`caesar:3`, `vigenere:key`).
 */
export function transform(mode: string, text: string, decode = false): string {
  const [rawMode, param] = mode.split(':');
  const name = rawMode.toLowerCase();

  switch (name) {
    case 'b64e':
      return Buffer.from(text, 'utf-8').toString('base64');
    case 'b64d':
      return Buffer.from(text, 'base64').toString('utf-8');
    case 'hexe':
      return Buffer.from(text, 'utf-8').toString('hex');
    case 'hexd':
      return Buffer.from(text.replace(/\s+/g, ''), 'hex').toString('utf-8');
    case 'urle':
      return encodeURIComponent(text);
    case 'urld':
      return decodeURIComponent(text);
    case 'rot13':
      return caesar(text, 13);
    case 'caesar': {
      const shift = Number(param ?? (decode ? -3 : 3));
      if (!Number.isFinite(shift)) throw new Error('caesar needs a number, e.g. .cipher caesar:3 <text>');
      return caesar(text, decode ? -shift : shift);
    }
    case 'vigenere':
      return vigenere(text, param || '', decode);
    case 'morse':
      return text
        .toLowerCase()
        .split('')
        .map(ch => (ch === ' ' ? '/' : MORSE[ch] || ''))
        .filter(Boolean)
        .join(' ');
    case 'unmorse':
      return text
        .trim()
        .split(/\s+/)
        .map(code => (code === '/' ? ' ' : MORSE_REVERSE[code] || ''))
        .join('');
    case 'binary':
      return text
        .split('')
        .map(ch => ch.charCodeAt(0).toString(2).padStart(8, '0'))
        .join(' ');
    case 'unbinary':
      return text
        .trim()
        .split(/\s+/)
        .map(bits => String.fromCharCode(parseInt(bits, 2)))
        .join('');
    case 'rev':
      return text.split('').reverse().join('');
    case 'atbash':
      return atbash(text);
    default:
      throw new Error(`Unknown mode. Try: ${CIPHER_MODES.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

export interface JwtReport {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  warnings: string[];
  expiresAt: Date | null;
}

export function decodeJwt(token: string): JwtReport {
  const parts = (token || '').trim().split('.');
  if (parts.length < 2) throw new Error('A JWT has three dot-separated parts');

  const decodePart = (part: string): Record<string, unknown> => {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json);
  };

  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  const warnings: string[] = [];

  const alg = String(header.alg ?? '');
  if (!alg || alg.toLowerCase() === 'none') {
    warnings.push('alg is "none": the signature is not verified at all. Reject this token.');
  }
  if (alg.startsWith('HS')) {
    warnings.push('HMAC (HS*) signing: a weak shared secret can be brute-forced offline');
  }
  if (!parts[2]) warnings.push('no signature part - this token is unsigned');

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = typeof payload.exp === 'number' ? new Date(payload.exp * 1000) : null;
  if (typeof payload.exp === 'number' && payload.exp < now) {
    warnings.push('token is expired (exp is in the past)');
  }
  if (typeof payload.nbf === 'number' && payload.nbf > now) {
    warnings.push('token is not valid yet (nbf is in the future)');
  }
  if (typeof payload.exp !== 'number') {
    warnings.push('no exp claim: the token never expires');
  }
  if (typeof payload.exp === 'number' && payload.exp - now > 30 * 24 * 3600) {
    warnings.push('expires more than 30 days from now - unusually long-lived');
  }
  if (!('aud' in payload)) warnings.push('no aud claim: the token is accepted by any audience');
  if (!('iss' in payload)) warnings.push('no iss claim');

  return { header, payload, warnings, expiresAt };
}

// ---------------------------------------------------------------------------
// HTTP security headers
// ---------------------------------------------------------------------------

export interface HeaderCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface HeaderReport {
  score: number;
  grade: string;
  checks: HeaderCheck[];
}

/**
 * Grade the security-relevant response headers and cookie flags, the way a
 * hardening review would: one point per recommended protection.
 */
export function gradeSecurityHeaders(
  get: (name: string) => string | undefined,
  cookies: string[] = []
): HeaderReport {
  const checks: HeaderCheck[] = [];
  const value = (name: string) => (get(name) || '').trim();

  const hsts = value('strict-transport-security');
  checks.push({
    name: 'Strict-Transport-Security',
    ok: !!hsts,
    detail: hsts || 'missing: browsers may downgrade to plain HTTP',
  });

  const csp = value('content-security-policy');
  const cspWeak = /unsafe-inline|unsafe-eval/i.test(csp);
  checks.push({
    name: 'Content-Security-Policy',
    ok: !!csp && !cspWeak,
    detail: !csp
      ? 'missing: no XSS containment'
      : cspWeak
        ? 'present but allows unsafe-inline/unsafe-eval'
        : 'present',
  });

  const xfo = value('x-frame-options');
  const frameAncestors = csp.includes('frame-ancestors');
  checks.push({
    name: 'X-Frame-Options',
    ok: !!xfo || frameAncestors,
    detail: xfo || (frameAncestors ? 'covered by CSP frame-ancestors' : 'missing: clickjacking risk'),
  });

  const nosniff = value('x-content-type-options');
  checks.push({
    name: 'X-Content-Type-Options',
    ok: nosniff.toLowerCase() === 'nosniff',
    detail: nosniff || 'missing: MIME sniffing can turn uploads into scripts',
  });

  const referrer = value('referrer-policy');
  checks.push({
    name: 'Referrer-Policy',
    ok: !!referrer,
    detail: referrer || 'missing: URLs leak to third parties',
  });

  const permissions = value('permissions-policy') || value('feature-policy');
  checks.push({
    name: 'Permissions-Policy',
    ok: !!permissions,
    detail: permissions || 'missing: camera/mic/geo are unrestricted by policy',
  });

  const server = value('server');
  const poweredBy = value('x-powered-by');
  checks.push({
    name: 'Banner disclosure',
    ok: !poweredBy && !/\d/.test(server),
    detail: poweredBy ? `x-powered-by: ${poweredBy}` : server ? `server: ${server}` : 'no version banner',
  });

  if (cookies.length) {
    const insecure = cookies.filter(c => !/;\s*secure/i.test(c) || !/;\s*httponly/i.test(c));
    checks.push({
      name: 'Cookie flags',
      ok: insecure.length === 0,
      detail: insecure.length === 0
        ? `${cookies.length} cookie(s) with Secure + HttpOnly`
        : `${insecure.length}/${cookies.length} cookie(s) missing Secure or HttpOnly`,
    });
  }

  const passed = checks.filter(c => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  const grade =
    score >= 95 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : score >= 35 ? 'E' : 'F';

  return { score, grade, checks };
}
