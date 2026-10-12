import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import config from '../config/index.js';
import logger from './logger.js';

export type Role = 'admin' | 'operator' | 'viewer';
export type Permission = 'scan' | 'deploy' | 'view' | 'manage_users' | 'run_commands' | 'reset_session';

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  role: Role;
  permissions: Permission[];
  createdAt: number;
  lastLogin: number | null;
  active: boolean;
  createdBy: string;
}

export interface ActivityLog {
  id: string;
  userId: string;
  username: string;
  action: string;
  details: string;
  ip: string;
  timestamp: number;
  status: 'success' | 'failure';
}

export interface DeployStatus {
  id: string;
  triggeredBy: string;
  status: 'pending' | 'building' | 'success' | 'failed';
  commit: string;
  startedAt: number;
  finishedAt: number | null;
  logs: string[];
}

interface Session {
  userId: string;
  expires: number;
  createdAt: number;
}

/** How long a dashboard login token stays valid. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVITY = 500;
const MAX_DEPLOYS = 100;

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ['scan', 'deploy', 'view', 'manage_users', 'run_commands', 'reset_session'],
  operator: ['scan', 'deploy', 'view', 'run_commands'],
  viewer: ['view'],
};

export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'operator' || value === 'viewer';
}

export function permissionsForRole(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function generateId(): string {
  return crypto.randomBytes(12).toString('hex');
}

function usersFilePath(): string {
  return path.join(config.DATA_DIR, 'users.json');
}
function activityFilePath(): string {
  return path.join(config.DATA_DIR, 'activity.json');
}
function deploysFilePath(): string {
  return path.join(config.DATA_DIR, 'deploys.json');
}
function sessionsFilePath(): string {
  return path.join(config.DATA_DIR, 'sessions.json');
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(config.DATA_DIR, { recursive: true });
}

/**
 * Write JSON via a temp file + rename so a crash or power loss mid-write can
 * never leave a truncated users.json behind (which would silently wipe every
 * account on the next boot).
 */
// Serialize writes per file so overlapping saves cannot interleave, and use a
// unique temp name so concurrent writes never collide on rename.
const writeQueues = new Map<string, Promise<void>>();

async function writeJson(file: string, data: unknown): Promise<void> {
  await ensureDataDir();
  const prev = writeQueues.get(file) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(data, null, 2));
    await fs.rename(tmp, file);
  });
  writeQueues.set(file, next.catch(() => {}));
  await next;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

export class AdminStore {
  private users: User[] = [];
  private activity: ActivityLog[] = [];
  private deploys: DeployStatus[] = [];
  private sessions = new Map<string, Session>();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    await ensureDataDir();

    this.users = await readJson<User[]>(usersFilePath(), []);
    this.activity = await readJson<ActivityLog[]>(activityFilePath(), []);
    this.deploys = await readJson<DeployStatus[]>(deploysFilePath(), []);
    const sessions = await readJson<Record<string, Session>>(sessionsFilePath(), {});

    const now = Date.now();
    for (const [token, sess] of Object.entries(sessions)) {
      if (sess && sess.expires > now) this.sessions.set(token, sess);
    }

    this.loaded = true;

    if (this.users.length === 0) {
      await this.bootstrapAdmin();
    }

    // A user list persisted from an older build may be missing the fields we
    // rely on now; repair it lazily so nothing crashes at request time.
    for (const user of this.users) {
      if (!Array.isArray(user.permissions) || user.permissions.length === 0) {
        user.permissions = isRole(user.role) ? permissionsForRole(user.role) : ['view'];
      }
      if (typeof user.active !== 'boolean') user.active = true;
    }
  }

  private async bootstrapAdmin(): Promise<void> {
    const salt = crypto.randomBytes(16).toString('hex');
    const usingToken = !!config.ADMIN_TOKEN;
    const adminPass = usingToken ? config.ADMIN_TOKEN : 'admin123';
    this.users.push({
      id: 'admin',
      username: 'admin',
      passwordHash: hashPassword(adminPass, salt),
      salt,
      role: 'admin',
      permissions: permissionsForRole('admin'),
      createdAt: Date.now(),
      lastLogin: null,
      active: true,
      createdBy: 'system',
    });
    await this.saveUsers();
    if (usingToken) {
      logger.info('Default admin user created (password = ADMIN_TOKEN)');
    } else {
      logger.warn(
        { hint: 'Set ADMIN_TOKEN in the environment to replace the default password' },
        'Default admin user created with password "admin123" - CHANGE IT'
      );
    }
  }

  private async saveUsers(): Promise<void> {
    await writeJson(usersFilePath(), this.users);
  }

  private async saveSessions(): Promise<void> {
    const now = Date.now();
    const out: Record<string, Session> = {};
    for (const [token, sess] of this.sessions) {
      if (sess.expires > now) out[token] = sess;
    }
    await writeJson(sessionsFilePath(), out);
  }

  private async saveActivity(): Promise<void> {
    if (this.activity.length > MAX_ACTIVITY) {
      this.activity = this.activity.slice(-MAX_ACTIVITY);
    }
    await writeJson(activityFilePath(), this.activity);
  }

  private async saveDeploys(): Promise<void> {
    if (this.deploys.length > MAX_DEPLOYS) {
      this.deploys = this.deploys.slice(-MAX_DEPLOYS);
    }
    await writeJson(deploysFilePath(), this.deploys);
  }

  async logActivity(
    userId: string,
    username: string,
    action: string,
    details: string,
    ip: string,
    status: 'success' | 'failure' = 'success'
  ): Promise<void> {
    this.activity.push({ id: generateId(), userId, username, action, details, ip, timestamp: Date.now(), status });
    await this.saveActivity().catch(err => logger.error({ err: err?.message }, 'Failed to save activity'));
  }

  async logDeploy(triggeredBy: string, commit: string): Promise<string> {
    const id = generateId();
    this.deploys.push({ id, triggeredBy, status: 'pending', commit, startedAt: Date.now(), finishedAt: null, logs: [] });
    await this.saveDeploys();
    return id;
  }

  async updateDeploy(id: string, update: Partial<DeployStatus>): Promise<void> {
    const d = this.deploys.find(x => x.id === id);
    if (!d) return;
    Object.assign(d, update);
    if (update.status === 'success' || update.status === 'failed') d.finishedAt = Date.now();
    await this.saveDeploys();
  }

  getDeploys(): DeployStatus[] { return [...this.deploys].reverse(); }
  getActivity(limit = 100): ActivityLog[] { return [...this.activity].slice(-Math.max(1, limit)).reverse(); }

  async authenticate(username: string, password: string): Promise<{ token: string; user: User } | null> {
    const user = this.users.find(u => u.username === username && u.active);
    if (!user) return null;
    const candidate = hashPassword(password, user.salt);
    // Constant-time compare to avoid leaking hash bytes through timing.
    const a = Buffer.from(candidate, 'hex');
    const b = Buffer.from(user.passwordHash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    user.lastLogin = Date.now();

    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, { userId: user.id, expires: Date.now() + SESSION_TTL_MS, createdAt: Date.now() });

    // Persist before returning so a restart immediately after login cannot
    // lose the just-issued token (was previously fire-and-forget).
    await Promise.all([
      this.saveUsers().catch(err => logger.error({ err: err?.message }, 'Failed to persist lastLogin')),
      this.saveSessions().catch(err => logger.error({ err: err?.message }, 'Failed to persist session')),
    ]);
    return { token, user };
  }

  validateToken(token: string): User | null {
    if (!token) return null;
    const sess = this.sessions.get(token);
    if (!sess) return null;
    if (Date.now() > sess.expires) {
      this.sessions.delete(token);
      void this.saveSessions().catch(() => {});
      return null;
    }
    return this.users.find(u => u.id === sess.userId && u.active) || null;
  }

  revokeToken(token: string): void {
    if (this.sessions.delete(token)) void this.saveSessions().catch(() => {});
  }

  hasPermission(user: User, perm: Permission): boolean {
    if (user.role === 'admin') return true;
    return user.permissions.includes(perm);
  }

  getUser(id: string): User | undefined {
    return this.users.find(u => u.id === id);
  }

  findByUsername(username: string): User | undefined {
    return this.users.find(u => u.username === username);
  }

  listUsers(): Omit<User, 'passwordHash' | 'salt'>[] {
    return this.users.map(({ passwordHash: _, salt: __, ...u }) => u);
  }

  sanitize(user: User): Omit<User, 'passwordHash' | 'salt'> {
    const { passwordHash: _, salt: __, ...safe } = user;
    return safe;
  }

  async createUser(
    username: string,
    password: string,
    role: Role,
    createdBy: string
  ): Promise<Omit<User, 'passwordHash' | 'salt'>> {
    const clean = username.trim();
    if (!clean) throw new Error('Username is required');
    if (this.users.find(u => u.username.toLowerCase() === clean.toLowerCase())) {
      throw new Error('Username already exists');
    }
    if (!isRole(role)) throw new Error('Invalid role');
    if (password.length < 6) throw new Error('Password must be 6+ characters');

    const salt = crypto.randomBytes(16).toString('hex');
    const user: User = {
      id: generateId(),
      username: clean,
      passwordHash: hashPassword(password, salt),
      salt,
      role,
      permissions: permissionsForRole(role),
      createdAt: Date.now(),
      lastLogin: null,
      active: true,
      createdBy,
    };
    this.users.push(user);
    await this.saveUsers();
    return this.sanitize(user);
  }

  async updateUser(
    id: string,
    updates: { role?: Role; active?: boolean; permissions?: Permission[] }
  ): Promise<boolean> {
    const user = this.users.find(u => u.id === id);
    if (!user) return false;
    if (updates.role) {
      if (!isRole(updates.role)) throw new Error('Invalid role');
      if (user.role === 'admin' && updates.role !== 'admin' && this.adminCount() <= 1) {
        throw new Error('Cannot demote the last admin');
      }
      user.role = updates.role;
      user.permissions = permissionsForRole(updates.role);
    }
    if (updates.active !== undefined) {
      if (!updates.active && user.role === 'admin' && this.adminCount() <= 1) {
        throw new Error('Cannot disable the last admin');
      }
      user.active = updates.active;
    }
    if (updates.permissions) {
      const allowed: Permission[] = ['scan', 'deploy', 'view', 'manage_users', 'run_commands', 'reset_session'];
      user.permissions = updates.permissions.filter((p): p is Permission => allowed.includes(p));
    }
    await this.saveUsers();
    return true;
  }

  async setPassword(id: string, password: string): Promise<boolean> {
    if (password.length < 6) throw new Error('Password must be 6+ characters');
    const user = this.users.find(u => u.id === id);
    if (!user) return false;
    user.salt = crypto.randomBytes(16).toString('hex');
    user.passwordHash = hashPassword(password, user.salt);
    await this.saveUsers();
    return true;
  }

  async deleteUser(id: string): Promise<boolean> {
    const idx = this.users.findIndex(u => u.id === id);
    if (idx === -1) return false;
    if (this.users[idx].role === 'admin' && this.adminCount() <= 1) {
      throw new Error('Cannot delete the last admin');
    }
    this.users.splice(idx, 1);
    // Drop any live sessions belonging to the deleted account.
    for (const [token, sess] of this.sessions) {
      if (sess.userId === id) this.sessions.delete(token);
    }
    await this.saveUsers();
    void this.saveSessions().catch(() => {});
    return true;
  }

  private adminCount(): number {
    return this.users.filter(u => u.role === 'admin' && u.active).length;
  }
}

export const adminStore = new AdminStore();
