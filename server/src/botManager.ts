import { wxBridge } from './wxBridge.js';
import { MockBot } from './mockBot.js';

const USE_MOCK = process.env.USE_MOCK_BOT === 'true';

// ── Caches (keyed by id = display name) ──────────────────────────────
let roomCache: Map<string, any> = new Map();
let contactCache: Map<string, any> = new Map();
let loginTime: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

let botInstance: any = null;
let initialized = false;

function ensureBot(): any {
  if (botInstance) return botInstance;

  if (USE_MOCK) {
    console.log('[BotManager] Using MockBot (USE_MOCK_BOT=true)');
    botInstance = new MockBot('admin');
    loginTime = new Date().toISOString();
    initialized = true;
    return botInstance;
  }

  // Real wx4py-backed bot wrapper
  botInstance = {
    get isLoggedIn() {
      return initialized;
    },

    get currentUser() {
      return { name: () => 'WeChat User', id: 'wx4py_user' };
    },

    Room: {
      findAll: async () => {
        const groups = await wxBridge.groups();
        cacheRooms(groups);
        return groups.map(g => ({
          id: g.id,
          topic: async () => g.topic,
          memberAll: async () => new Array(g.memberCount),
          say: async (text: string) => {
            await wxBridge.send(g.id, text, 'group');
          },
        }));
      },
      find: async (query: any) => {
        const results = await wxBridge.search(query.topic || query.id || '', 'group');
        if (results.length === 0) return null;
        const r = results[0];
        return {
          id: r.id,
          topic: async () => r.name,
          memberAll: async () => [],
          say: async (text: string) => {
            await wxBridge.send(r.name, text, 'group');
          },
        };
      },
    },

    Contact: {
      findAll: async () => {
        const contacts = await wxBridge.contacts();
        cacheContacts(contacts);
        return contacts.map(c => ({
          id: c.id,
          name: () => c.name,
          friend: () => true,
          type: () => 1,
          say: async (text: string) => {
            await wxBridge.send(c.name, text, 'contact');
          },
        }));
      },
      find: async (query: any) => {
        const results = await wxBridge.search(query.name || query.id || '', 'contact');
        if (results.length === 0) return null;
        const r = results[0];
        return {
          id: r.id,
          name: () => r.name,
          friend: () => true,
          type: () => 1,
          say: async (text: string) => {
            await wxBridge.send(r.name, text, 'contact');
          },
        };
      },
    },
  };

  initialized = true;
  return botInstance;
}

// ── Public API (single-user) ─────────────────────────────────────────

export class BotManager {
  static getBot(_username?: string): any {
    return ensureBot();
  }

  static getLoginTime(): string | null {
    return loginTime;
  }

  static getQrCode(): null {
    return null; // wx4py has no QR — WeChat is pre-logged-in
  }

  // ── Cache ──────────────────────────────────────────────────────────

  static cacheRooms(_user: string, rooms: any[]): void {
    for (const r of rooms) roomCache.set(r.id, r);
  }

  static cacheContacts(_user: string, contacts: any[]): void {
    for (const c of contacts) contactCache.set(c.id, c);
  }

  static getCachedRoom(_user: string, roomId: string): any | null {
    return roomCache.get(roomId) ?? null;
  }

  static getCachedContact(_user: string, contactId: string): any | null {
    return contactCache.get(contactId) ?? null;
  }

  static clearCache(_user?: string): void {
    roomCache.clear();
    contactCache.clear();
    cacheTimestamp = 0;
  }

  static isCacheFresh(): boolean {
    return Date.now() - cacheTimestamp < CACHE_TTL;
  }

  static markCacheFresh(): void {
    cacheTimestamp = Date.now();
  }

  static getCachedRooms(): any[] {
    return Array.from(roomCache.values());
  }

  static getCachedContacts(): any[] {
    return Array.from(contactCache.values());
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  static async stopBot(_username?: string): Promise<void> {
    // wx4py bridge handles its own lifecycle; just clear our state
    initialized = false;
    botInstance = null;
    loginTime = null;
    this.clearCache();
  }

  /** Try to connect to wx4py bridge and mark as logged in if reachable */
  static async initBridge(): Promise<boolean> {
    try {
      const status = await wxBridge.status();
      if (status.connected) {
        loginTime = new Date().toISOString();
        initialized = true;
        ensureBot();
        console.log('[BotManager] wx4py bridge connected');
        return true;
      }
      console.warn('[BotManager] wx4py bridge running but WeChat not connected');
      return false;
    } catch (e) {
      console.warn('[BotManager] wx4py bridge not reachable:', (e as Error).message);
      return false;
    }
  }
}

// ── Backward-compat helpers (used by existing API code) ──────────────

function cacheRooms(rooms: any[]): void {
  for (const r of rooms) roomCache.set(r.id, r);
  cacheTimestamp = Date.now();
}

function cacheContacts(contacts: any[]): void {
  for (const c of contacts) contactCache.set(c.id, c);
  cacheTimestamp = Date.now();
}
