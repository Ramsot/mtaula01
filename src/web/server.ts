import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import config from '../config/index.js';
import logger from '../core/logger.js';
import type { BotClient } from '../core/client.js';
import { adminStore, type Permission, type Role } from '../core/admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createWebServer(bot: BotClient): express.Application {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.resolve(__dirname, '..', '..', 'public')));

  const requireAdmin: express.RequestHandler = (req, res, next) => {
    const provided =
      (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
      (req.query.token as string) ||
      '';

    if (config.ADMIN_TOKEN) {
      if (provided !== config.ADMIN_TOKEN) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
        return;
      }
      return next();
    }

    const ip = req.ip || req.socket?.remoteAddress || '';
    const isLoopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (isLoopback) return next();

    res.status(403).json({
      success: false,
      error: 'Forbidden: set ADMIN_TOKEN to call this endpoint remotely',
    });
  };

  const requireAuth = (perm?: Permission): express.RequestHandler => {
    return (req, res, next) => {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (req.query.token as string) || '';
      const user = adminStore.validateToken(token);
      if (!user) {
        res.status(401).json({ success: false, error: 'Invalid or expired token' });
        return;
      }
      if (perm && !adminStore.hasPermission(user, perm)) {
        res.status(403).json({ success: false, error: `Permission denied: ${perm} required` });
        return;
      }
      (req as any).user = user;
      next();
    };
  };

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

  app.get('/health-web', (_req, res) => {
    res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'health.html'));
  });

  app.get('/', (_req, res) => {
    res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'index.html'));
  });

  app.get('/pair', (_req, res) => {
    res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'pair.html'));
  });

  app.get('/api/status', (_req, res) => {
    res.json(bot.getState());
  });

  app.get('/api/qr', async (_req, res) => {
    const qr = bot.getQr();
    if (!qr) {
      res.status(404).json({ success: false, error: 'No QR available' });
      return;
    }
    try {
      const image = await bot.getQrImage();
      res.setHeader('Content-Type', 'image/png');
      res.send(Buffer.from(image!.split(',')[1], 'base64'));
    } catch {
      res.status(500).json({ success: false, error: 'Failed to generate QR image' });
    }
  });

  app.post('/api/reset', requireAdmin, async (_req, res) => {
    try {
      res.json({ success: true, message: 'Session cleared' });
      await bot.resetSession();
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  app.post('/api/pair', async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber) {
        res.status(400).json({ success: false, error: 'Phone number required' });
        return;
      }
      const state = bot.getState();
      if (state.registered) {
        res.status(409).json({ success: false, error: 'Already linked' });
        return;
      }
      const clean = phoneNumber.replace(/\D/g, '');
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

  app.get('/api/session/export', requireAdmin, async (_req, res) => {
    try {
      const dir = config.SESSION_DIR;
      const files = await fs.readdir(dir).catch(() => []);
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

  app.post('/api/session/import', requireAdmin, async (req, res) => {
    try {
      const { session } = req.body;
      if (!session || typeof session !== 'object') {
        res.status(400).json({ success: false, error: 'Session data required' });
        return;
      }
      const dir = config.SESSION_DIR;
      await fs.mkdir(dir, { recursive: true });
      for (const [f, content] of Object.entries(session)) {
        if (f.endsWith('.json') && typeof content === 'string') {
          await fs.writeFile(path.join(dir, f), content);
        }
      }
      res.json({ success: true, message: 'Session imported' });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ success: false, error: 'Username and password required' });
      return;
    }
    const ip = req.ip || 'unknown';
    const result = adminStore.authenticate(username, password);
    if (!result) {
      await adminStore.logActivity('unknown', username, 'login', `Failed login from ${ip}`, ip, 'failure');
      res.status(401).json({ success: false, error: 'Invalid credentials' });
      return;
    }
    await adminStore.logActivity(result.user.id, username, 'login', `Logged in from ${ip}`, ip);
    res.json({
      success: true,
      token: result.token,
      user: {
        id: result.user.id,
        username: result.user.username,
        role: result.user.role,
        permissions: result.user.permissions,
      },
    });
  });

  app.get('/api/auth/me', requireAuth(), (req, res) => {
    const user = (req as any).user;
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        permissions: user.permissions,
        lastLogin: user.lastLogin,
      },
    });
  });

  app.get('/api/users', requireAuth('manage_users'), (_req, res) => {
    res.json({ success: true, users: adminStore.listUsers() });
  });

  app.post('/api/users', requireAuth('manage_users'), async (req, res) => {
    try {
      const { username, password, role } = req.body;
      if (!username || !password || !role) {
        res.status(400).json({ success: false, error: 'username, password, role required' });
        return;
      }
      if (!['admin', 'operator', 'viewer'].includes(role)) {
        res.status(400).json({ success: false, error: 'role must be admin/operator/viewer' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ success: false, error: 'Password must be 6+ characters' });
        return;
      }
      const creator = (req as any).user;
      const user = await adminStore.createUser(username, password, role as Role, creator.username);
      await adminStore.logActivity(creator.id, creator.username, 'create_user', `Created user ${username} (${role})`, req.ip || '');
      res.json({ success: true, user });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message });
    }
  });

  app.put('/api/users/:id', requireAuth('manage_users'), async (req, res) => {
    try {
      const id = String(req.params.id);
      const { role, active, permissions } = req.body;
      const ok = await adminStore.updateUser(id, { role, active, permissions });
      if (!ok) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }
      const creator = (req as any).user;
      await adminStore.logActivity(creator.id, creator.username, 'update_user', `Updated user ${id}`, req.ip || '');
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
      const creator = (req as any).user;
      await adminStore.logActivity(creator.id, creator.username, 'delete_user', `Deleted user ${id}`, req.ip || '');
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err?.message });
    }
  });

  app.get('/api/activity', requireAuth('view'), (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    res.json({ success: true, activity: adminStore.getActivity(limit) });
  });

  app.get('/api/deploys', requireAuth('view'), (_req, res) => {
    res.json({ success: true, deploys: adminStore.getDeploys() });
  });

  app.post('/api/commands/run', requireAuth('run_commands'), async (req, res) => {
    const { command } = req.body;
    if (!command) {
      res.status(400).json({ success: false, error: 'command required' });
      return;
    }

    const allowed = [
      'npm run build', 'npm run typecheck', 'npm test',
      'git status', 'git log --oneline -5', 'git diff --stat',
      'ls -la', 'whoami', 'date', 'uptime', 'df -h',
      'node -e "console.log(process.uptime())"',
    ];
    const trimmed = command.trim();
    if (!allowed.some(a => trimmed === a || trimmed.startsWith(a + ' '))) {
      res.status(403).json({ success: false, error: 'Command not allowed' });
      return;
    }

    const user = (req as any).user;
    exec(trimmed, { timeout: 30000, cwd: process.cwd() }, async (err, stdout, stderr) => {
      const output = stdout + (stderr ? '\n' + stderr : '');
      await adminStore.logActivity(user.id, user.username, 'run_command', trimmed, req.ip || '', err ? 'failure' : 'success');
      res.json({
        success: !err,
        command: trimmed,
        output: output.slice(0, 50000),
        exitCode: err ? (err as any).code || 1 : 0,
      });
    });
  });

  app.get('/api/engines', requireAuth('view'), (_req, res) => {
    res.json({
      success: true,
      engines: [
        { name: 'Meta AI (WhatsApp)', available: true, configured: true },
        { name: 'Gemini 3.8 Flash', available: !!config.GEMINI_KEY, configured: !!config.GEMINI_KEY },
        { name: 'Groq Qwen 3.8', available: !!config.GROQ_KEY, configured: !!config.GROQ_KEY },
        { name: 'OpenAI GPT-4o', available: !!config.OPENAI_KEY, configured: !!config.OPENAI_KEY },
      ],
    });
  });

  return app;
}
