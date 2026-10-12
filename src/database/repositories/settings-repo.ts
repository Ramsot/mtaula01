import { JsonStore } from '../../core/store.js';

/**
 * Runtime settings changed by owner commands (`.mode self`, `.antidelete on`,
 * `.autochat on`, ...). These used to live only in `globalThis` / the in-memory
 * config object, so every redeploy silently reset them and the owner had to
 * re-issue the commands. They are now persisted on the same Disk as the session.
 */
export interface RuntimeSettings {
  mode?: 'public' | 'self';
  autoChat?: boolean;
  autoChatGroup?: boolean;
  autoViewOnce?: boolean;
  antiDelete?: boolean;
  antiDeleteStatus?: boolean;
  autoRead?: boolean;
  autoTyping?: boolean;
  autoReact?: boolean;
  alwaysOnline?: boolean;
  antilink?: boolean;
  welcome?: boolean;
  goodbye?: boolean;
}

/** Keyed by setting name so the persisted shape stays stable across versions. */
export class SettingsRepo {
  private store: JsonStore<{ values: RuntimeSettings } & Record<string, unknown>>;
  private ready: Promise<unknown> | null = null;

  constructor(file: string) {
    this.store = new JsonStore<{ values: RuntimeSettings } & Record<string, unknown>>(
      file,
      { values: {} },
      0
    );
  }

  init(): Promise<unknown> {
    if (!this.ready) this.ready = this.store.load();
    return this.ready;
  }

  all(): RuntimeSettings {
    return { ...this.store.get().values };
  }

  get<K extends keyof RuntimeSettings>(key: K): RuntimeSettings[K] {
    return this.store.get().values[key];
  }

  set<K extends keyof RuntimeSettings>(key: K, value: RuntimeSettings[K]): void {
    this.store.update(d => {
      d.values[key] = value;
    });
  }

  flush(): Promise<void> {
    return this.store.flush();
  }
}
