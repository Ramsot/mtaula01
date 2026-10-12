import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import qrcode from 'qrcode';
import config from '../config/index.js';
import logger from '../core/logger.js';
import type { BotClient } from '../core/client.js';
import {
  adminStore,
  isRole,
  type Permission,
  type Role,
  type User,
} from '../core/admin.js';
import { pairingStore, type Pairing } from '../core/pairing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: User;
      authPairing?: Pairing;
    }
  }
}

/** Commands the in-dashboard terminal is allowed to run. Exact or prefix match. */
const ALLOWED_COMMANDS = [
  'npm run build',
  'npm run typecheck',
  'npm test',
  'git status',
  'git log',
  'git diff',
  'ls -la',
  'whoami',
  'date',
  'uptime',
  'df -h',
  'node -e "console.log(process.uptime())"',
];

/** Characters that would let an allowed command chain into an arbitrary one. */
const SHELL_META = /[;&|`$><\n\r]/;

function clientIp(req: express.Request): string {
  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return fwd || req.socket.remoteAddress || '';
}

/** Tiny in-memory fixed-window rate limiter (per IP, per bucket). */
function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = clientIp(req) || 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now > entry.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.status(429).json({ success: false, error: 'Too many requests, slow down' });
      return;
    }
    next();
  };
}

function bearerToken(req: express.Request): string {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  const fromQuery = typeof req.query.token === 'string' ? req.query.token : '';
  return fromQuery.trim();
}

export function createWebServer(bot: BotClient): express.Application {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.resolve(__dirname, '..', '..', 'public')));

  /**
   * Resolve the caller: first as a dashboard login token, then as a persistent
   * device pairing token. Pairings survive redeploys, so a paired device never
   * has to log in (or re-pair) again after an update.
   */
  const resolveIdentity: express.RequestHandler = (req, _res, next) => {
    const token = bearerToken(req);
    if (token) {
      const user = adminStore.validateToken(token);
      if (user) {
        req.authUser = user;
      } else {
        const pairing = pairingStore.verifyPairing(token);
        if (pairing) {
          const pairedUser = adminStore.getUser(pairing.userId);
          if (pairedUser && pairedUser.active) {
            req.authUser = pairedUser;
            req.authPairing = pairing;
          }
        }
      }
    }
    next();
  };
  app.use(resolveIdentity);

  const requireAuth = (perm?: Permission): express.RequestHandler => {
    return (req, res, next) => {
      const user = req.authUser;
      if (!user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }
      if (perm && !adminStore.hasPermission(user, perm)) {
        res.status(403).json({ success: false, error: `Missing permission: ${perm}` });
        return;
      }
      next();
    };
  };

  // --- Public pages ---------------------------------------------------------

  app.get('/health', (_req, res) => {
    const state = bot.getState();
    res.json({
      status: 'ok',
      bot: config.BOT_NAME,
      version: '2.0.0',
      uptime: process.uptime(),
      connected: state.connected,
      registered: state.registered,
      timestamp: new Date().toISOString(),
    });
  });

  const sendPublic = (file: string) => (_req: express.Request, res: express.Response) =>
    res.sendFile(path.resolve(__dirname, '..', '..', 'public', file));

  app.get('/', sendPublic('index.html'));
  app.get('/dashboard', sendPublic('index.html'));
  app.get('/pair', sendPublic('pair.html'));
  app.get('/health-web', sendPublic('health.html'));

  // --- Public status/pairing endpoints (used by /pair before any login) -----

  app.get('/api/status', (_req, res) => {
    const s = bot.getState();
    res.json({
      connected: s.connected,
      registered: s.registered,
      state: s.connectionState,
      jid: s.user,
      pushName: null,
      lastError: s.lastError,
      error: s.lastError,
      mode: s.mode,
      prefix: s.prefix,
      uptime: s.uptime,
    });
  });

  app.get('/api/qr', async (_req, res) => {
    const qr = bot.getQr();
    if (!qr) {
      res.status(404).json({ success: false, error: 'No QR available' });
      return;
    }
    try {
      const image = await bot.getQrImage();
      if (!image) {
        res.status(404).json({ success: false, error: 'QR image generation failed' });
        return;
      }
      const base64 = image.includes(',') ? image.split(',')[1] : image;
      res.setHeader('Content-Type', 'image/png');
      res.send(Buffer.from(base64, 'base64'));
    } catch (e: any) {
      res.status(500).json({ success: false, error: 'Failed to generate QR image: ' + e?.message });
    }
  });

  app.get('/api/qr/raw', (_req, res) => {
    const qr = bot.getQr();
    if (!qr) {
      res.status(404).json({ success: false, error: 'No QR available' });
      return;
    }
    res.json({ success: true, qr });
  });

  // WhatsApp pairing code (bootstraps the bot's own link). Rate-limited so the
  // endpoint cannot be hammered to spam pairing requests.
  app.post('/api/pair', rateLimit(5, 60_000), async (req, res) => {
    try {
      const { phoneNumber } = req.body || {};
      if (!phoneNumber) {
        res.status(400).json({ success: false, error: 'Phone number required' });
        return;
      }
      const state = bot.getState();
      if (state.registered) {
        res.status(409).json({ success: false, error: 'Already linked' });
        return;
      }
      const clean = String(phoneNumber).replace(/\D/g, '');
      if (clean.length < 10 || clean.length > 15) {
        res.status(400).json({ success: false, error: 'Invalid phone number' });
        return;
      }
      const sock = bot.getSocket();
      if (!sock) {
        res.status(503).json({ success: false, error: 'Socket not ready' });
        return;
      }
      const code = await sock.requestPairingCode(clean);
      res.json({ success: true, pairingCode: code });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  // --- Auth ----------------------------------------------------------------

  app.post('/api/auth/login', rateLimit(10, 60_000), async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      res.status(400).json({ success: false, error: 'username and password required' });
      return;
    }
    const result = await adminStore.authenticate(String(username), String(password));
    if (!result) {
      await adminStore.logActivity('unknown', String(username), 'login', 'Failed login attempt', clientIp(req), 'failure');
      res.status(401).json({ success: false, error: 'Invalid username or password' });
      return;
    }
    await adminStore.logActivity(result.user.id, result.user.username, 'login', 'Dashboard login', clientIp(req));
    res.json({ success: true, token: result.token, user: adminStore.sanitize(result.user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = bearerToken(req);
    if (token) adminStore.revokeToken(token);
    res.json({ success: true });
  });

  app.get('/api/auth/me', requireAuth(), (req, res) => {
    const user = req.authUser!;
    res.json({
      success: true,
      user: adminStore.sanitize(user),
      pairing: req.authPairing
        ? { id: req.authPairing.id, deviceName: req.authPairing.deviceName, pairedAt: req.authPairing.pairedAt }
        : null,
    });
  });

  // --- Persistent device pairing -------------------------------------------

  /** Claim a pairing token from a scanned QR. Public, but token-guarded. */
  app.post('/api/pair/claim', rateLimit(20, 60_000), async (req, res) => {
    const { token, deviceName, phone } = req.body || {};
    if (!token) {
      res.status(400).json({ success: false, error: 'token required' });
      return;
    }
    const pairing = await pairingStore.claimPairing(String(token), {
      deviceName: deviceName ? String(deviceName) : undefined,
      phone: phone ? String(phone) : undefined,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] || undefined,
    });
    if (!pairing) {
      res.status(404).json({ success: false, error: 'Invalid or revoked pairing token' });
      return;
    }
    const user = adminStore.getUser(pairing.userId);
    if (!user || !user.active) {
      res.status(403).json({ success: false, error: 'Account is not active' });
      return;
    }
    await adminStore.logActivity(user.id, user.username, 'pair_device', `Device "${pairing.deviceName}" paired`, clientIp(req));
    res.json({
      success: true,
      token: pairing.token,
      user: adminStore.sanitize(user),
    });
  });

  app.get('/api/pairings', requireAuth('manage_users'), (_req, res) => {
    res.json({ success: true, pairings: pairingStore.listPairings() });
  });

  app.post('/api/pairings', requireAuth('manage_users'), async (req, res) => {
    try {
      const { userId, deviceName } = req.body || {};
      const user = userId ? adminStore.getUser(String(userId)) : undefined;
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      const pairing = await pairingStore.createPairing(user.id, user.username, deviceName ? String(deviceName) : 'New device');

      const origin = `${req.protocol}://${req.get('host')}`;
      const claimUrl = `${origin}/?pair=${pairing.token}`;
      const qr = await qrcode.toDataURL(claimUrl, { width: 320, margin: 1 });

      await adminStore.logActivity(
        req.authUser!.id,
        req.authUser!.username,
        'generate_pairing',
        `Generated pairing QR for ${user.username} (${pairing.deviceName})`,
        clientIp(req)
      );
      res.json({ success: true, pairing, claimUrl, qr });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  app.delete('/api/pairings/:id', requireAuth('manage_users'), async (req, res) => {
    const id = String(req.params.id);
    const ok = await pairingStore.revokePairing(id);
    if (!ok) {
      res.status(404).json({ success: false, error: 'Pairing not found' });
      return;
    }
    await adminStore.logActivity(
      req.authUser!.id,
      req.authUser!.username,
      'revoke_pairing',
      `Revoked pairing ${id}`,
      clientIp(req)
    );
    res.json({ success: true });
  });

  // --- Session (WhatsApp creds) export/import ------------------------------
  // Extremely sensitive: these files ARE the WhatsApp account. Reset-session
  // permission (admin/operator-by-default) is required.

  app.post('/api/reset', requireAuth('reset_session'), async (req, res) => {
    try {
      await adminStore.logActivity(req.authUser!.id, req.authUser!.username, 'reset_session', 'Session reset requested', clientIp(req));
      res.json({ success: true, message: 'Session cleared' });
      await bot.resetSession();
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  app.get('/api/session/export', requireAuth('reset_session'), async (_req, res) => {
    try {
      const dir = config.SESSION_DIR;
      const files = await fs.readdir(dir).catch(() => [] as string[]);
      const session: Record<string, string> = {};
      for (const f of files) {
        if (f.endsWith('.json')) {
          session[f] = await fs.readFile(path.join(dir, f), 'utf-8');
        }
      }
      res.json({ success: true, session });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  app.post('/api/session/import', requireAuth('reset_session'), async (req, res) => {
    try {
      const { session } = req.body || {};
      if (!session || typeof session !== 'object') {
        res.status(400).json({ success: false, error: 'Session data required' });
        return;
      }
      const dir = config.SESSION_DIR;
      await fs.mkdir(dir, { recursive: true });
      for (const [f, content] of Object.entries(session)) {
        // Only ever write plain session json, never a path-traversal filename.
        if (f.endsWith('.json') && !f.includes('/') && !f.includes('\\') && typeof content === 'string') {
          await fs.writeFile(path.join(dir, f), content);
        }
      }
      res.json({ success: true, message: 'Session imported - restart to connect' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  // --- User management ------------------------------------------------------

  app.get('/api/users', requireAuth('manage_users'), (_req, res) => {
    res.json({ success: true, users: adminStore.listUsers() });
  });

  app.post('/api/users', requireAuth('manage_users'), async (req, res) => {
    try {
      const { username, password, role, generateQr, deviceName } = req.body || {};
      if (!username || !password || !role) {
        res.status(400).json({ success: false, error: 'username, password, role required' });
        return;
      }
      if (!isRole(role)) {
        res.status(400).json({ success: false, error: 'role must be admin/operator/viewer' });
        return;
      }
      const user = await adminStore.createUser(String(username), String(password), role as Role, req.authUser!.username);
      await adminStore.logActivity(
        req.authUser!.id,
        req.authUser!.username,
        'create_user',
        `Created user ${username} (${role})`,
        clientIp(req)
      );

      let pairingPayload: { pairing: Pairing; claimUrl: string; qr: string } | null = null;
      if (generateQr) {
        const pairing = await pairingStore.createPairing(user.id, user.username, deviceName ? String(deviceName) : 'New device');
        const origin = `${req.protocol}://${req.get('host')}`;
        const claimUrl = `${origin}/?pair=${pairing.token}`;
        const qr = await qrcode.toDataURL(claimUrl, { width: 320, margin: 1 });
        pairingPayload = { pairing, claimUrl, qr };
      }

      res.json({ success: true, user, pairing: pairingPayload });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message });
    }
  });

  app.put('/api/users/:id', requireAuth('manage_users'), async (req, res) => {
    try {
      const id = String(req.params.id);
      const { role, active, permissions } = req.body || {};
      const ok = await adminStore.updateUser(id, { role, active, permissions });
      if (!ok) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      await adminStore.logActivity(req.authUser!.id, req.authUser!.username, 'update_user', `Updated user ${id}`, clientIp(req));
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message });
    }
  });

  app.put('/api/users/:id/password', requireAuth('manage_users'), async (req, res) => {
    try {
      const id = String(req.params.id);
      const { password } = req.body || {};
      if (!password) {
        res.status(400).json({ success: false, error: 'password required' });
        return;
      }
      const ok = await adminStore.setPassword(id, String(password));
      if (!ok) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      await adminStore.logActivity(req.authUser!.id, req.authUser!.username, 'set_password', `Changed password for ${id}`, clientIp(req));
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message });
    }
  });

  app.delete('/api/users/:id', requireAuth('manage_users'), async (req, res) => {
    try {
      const id = String(req.params.id);
      const ok = await adminStore.deleteUser(id);
      if (!ok) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      const removedPairings = await pairingStore.removeForUser(id);
      await adminStore.logActivity(
        req.authUser!.id,
        req.authUser!.username,
        'delete_user',
        `Deleted user ${id}${removedPairings ? ` (+${removedPairings} pairing(s))` : ''}`,
        clientIp(req)
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message });
    }
  });

  // --- Read-only views ------------------------------------------------------

  app.get('/api/activity', requireAuth('view'), (req, res) => {
    const raw = parseInt(String(req.query.limit ?? '100'), 10);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 500) : 100;
    res.json({ success: true, activity: adminStore.getActivity(limit) });
  });

  app.get('/api/deploys', requireAuth('view'), (_req, res) => {
    res.json({ success: true, deploys: adminStore.getDeploys() });
  });

  app.get('/api/engines', requireAuth('view'), (_req, res) => {
    res.json({
      success: true,
      engines: [
        { name: 'Meta AI (WhatsApp)', available: true, configured: true },
        { name: 'Gemini', available: !!config.GEMINI_KEY, configured: !!config.GEMINI_KEY },
        { name: 'Groq', available: !!config.GROQ_KEY, configured: !!config.GROQ_KEY },
        { name: 'OpenAI', available: !!config.OPENAI_KEY, configured: !!config.OPENAI_KEY },
      ],
    });
  });

  /** The live command registry, so the dashboard never drifts from reality. */
  app.get('/api/commands', requireAuth('view'), (_req, res) => {
    const commands = bot.getRegistry().getAll().map(c => ({
      name: c.name,
      aliases: c.aliases || [],
      category: c.category,
      description: c.description,
    }));
    res.json({ success: true, commands, allowedShell: ALLOWED_COMMANDS });
  });

  // --- Terminal -------------------------------------------------------------

  app.post('/api/commands/run', requireAuth('run_commands'), (req, res) => {
    const { command } = req.body || {};
    if (!command || typeof command !== 'string') {
      res.status(400).json({ success: false, error: 'command required' });
      return;
    }
    const trimmed = command.trim();
    const allowed = ALLOWED_COMMANDS.some(a => trimmed === a || trimmed.startsWith(a + ' '));
    if (!allowed || SHELL_META.test(trimmed)) {
      res.status(403).json({ success: false, error: 'Command not allowed' });
      return;
    }

    exec(trimmed, { timeout: 30000, cwd: process.cwd() }, async (err, stdout, stderr) => {
      const output = stdout + (stderr ? '\n' + stderr : '');
      await adminStore.logActivity(
        req.authUser!.id,
        req.authUser!.username,
        'run_command',
        trimmed,
        clientIp(req),
        err ? 'failure' : 'success'
      );
      res.json({
        success: !err,
        command: trimmed,
        output: output.slice(0, 50000),
        exitCode: err ? (err as any).code || 1 : 0,
      });
    });
  });

  logger.info({ allowedCommands: ALLOWED_COMMANDS.length }, 'Web server routes ready');
  return app;
}
