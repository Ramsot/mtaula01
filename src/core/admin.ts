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

const DATA_DIR = path.join(process.cwd(), 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const DEPLOYS_FILE = path.join(DATA_DIR, 'deploys.json');
const MAX_ACTIVITY = 500;

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: ['scan', 'deploy', 'view', 'manage_users', 'run_commands', 'reset_session'],
  operator: ['scan', 'deploy', 'view', 'run_commands'],
  viewer: ['view'],
};

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function generateId(): string {
  return crypto.randomBytes(12).toString('hex');
}

async function ensureDataDir(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch {}
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

export class AdminStore {
  private users: User[] = [];
  private activity: ActivityLog[] = [];
  private deploys: DeployStatus[] = [];
  private sessions = new Map<string, { userId: string; expires: number }>();
  private loaded = false;

  async load(): Promise<void> {
    if (this.loaded) return;
    await ensureDataDir();
    this.users = await readJson<User[]>(USERS_FILE, []);
    this.activity = await readJson<ActivityLog[]>(ACTIVITY_FILE, []);
    this.deploys = await readJson<DeployStatus[]>(DEPLOYS_FILE, []);
    this.loaded = true;

    if (this.users.length === 0) {
      const salt = crypto.randomBytes(16).toString('hex');
      const adminPass = config.ADMIN_TOKEN || 'admin123';
      this.users.push({
        id: 'admin',
        username: 'admin',
        passwordHash: hashPassword(adminPass, salt),
        salt,
        role: 'admin',
        permissions: ROLE_PERMISSIONS.admin,
        createdAt: Date.now(),
        lastLogin: null,
        active: true,
        createdBy: 'system',
      });
      await this.saveUsers();
      logger.info('Default admin user created');
    }

    this.users.forEach(u => {
      this.sessions.set(u.id, { userId: u.id, expires: Date.now() + 365 * 24 * 60 * 60 * 1000 });
    });
  }

  private async saveUsers(): Promise<void> {
    await writeJson(USERS_FILE, this.users);
  }

  private async saveActivity(): Promise<void> {
    if (this.activity.length > MAX_ACTIVITY) {
      this.activity = this.activity.slice(-MAX_ACTIVITY);
    }
    await writeJson(ACTIVITY_FILE, this.activity);
  }

  private async saveDeploys(): Promise<void> {
    await writeJson(DEPLOYS_FILE, this.deploys);
  }

  async logActivity(userId: string, username: string, action: string, details: string, ip: string, status: 'success' | 'failure' = 'success'): Promise<void> {
    this.activity.push({ id: generateId(), userId, username, action, details, ip, timestamp: Date.now(), status });
    await this.saveActivity();
  }

  async logDeploy(triggeredBy: string, commit: string): Promise<string> {
    const id = generateId();
    this.deploys.push({ id, triggeredBy, status: 'pending', commit, startedAt: Date.now(), finishedAt: null, logs: [] });
    if (this.deploys.length > 100) this.deploys = this.deploys.slice(-100);
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
  getActivity(limit = 100): ActivityLog[] { return [...this.activity].slice(-limit).reverse(); }

  authenticate(username: string, password: string): { token: string; user: User } | null {
    const user = this.users.find(u => u.username === username && u.active);
    if (!user) return null;
    if (hashPassword(password, user.salt) !== user.passwordHash) return null;

    user.lastLogin = Date.now();
    this.saveUsers();

    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, { userId: user.id, expires: Date.now() + 24 * 60 * 60 * 1000 });
    return { token, user };
  }

  validateToken(token: string): User | null {
    const sess = this.sessions.get(token);
    if (!sess) return null;
    if (Date.now() > sess.expires) { this.sessions.delete(token); return null; }
    return this.users.find(u => u.id === sess.userId && u.active) || null;
  }

  hasPermission(user: User, perm: Permission): boolean {
    return user.permissions.includes(perm);
  }

  listUsers(): Omit<User, 'passwordHash' | 'salt'>[] {
    return this.users.map(({ passwordHash: _, salt: __, ...u }) => u);
  }

  async createUser(username: string, password: string, role: Role, createdBy: string): Promise<Omit<User, 'passwordHash' | 'salt'>> {
    if (this.users.find(u => u.username === username)) {
      throw new Error('Username already exists');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const user: User = {
      id: generateId(),
      username,
      passwordHash: hashPassword(password, salt),
      salt,
      role,
      permissions: ROLE_PERMISSIONS[role],
      createdAt: Date.now(),
      lastLogin: null,
      active: true,
      createdBy,
    };
    this.users.push(user);
    await this.saveUsers();
    const { passwordHash: _, salt: __, ...safe } = user;
    return safe;
  }

  async updateUser(id: string, updates: { role?: Role; active?: boolean; permissions?: Permission[] }): Promise<boolean> {
    const user = this.users.find(u => u.id === id);
    if (!user) return false;
    if (updates.role) { user.role = updates.role; user.permissions = ROLE_PERMISSIONS[updates.role]; }
    if (updates.active !== undefined) user.active = updates.active;
    if (updates.permissions) user.permissions = updates.permissions;
    await this.saveUsers();
    return true;
  }

  async deleteUser(id: string): Promise<boolean> {
    const idx = this.users.findIndex(u => u.id === id);
    if (idx === -1) return false;
    if (this.users[idx].role === 'admin' && this.users.filter(u => u.role === 'admin').length <= 1) {
      throw new Error('Cannot delete the last admin');
    }
    this.users.splice(idx, 1);
    await this.saveUsers();
    return true;
  }
}

export const adminStore = new AdminStore();
