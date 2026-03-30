import { Wechaty, WechatyBuilder } from 'wechaty';
import { UserManager } from './userManager.js';
import path from 'path';
import QRCode from 'qrcode';
import { MockBot } from './mockBot.js';

export class BotManager {
    private static instances: Map<string, Wechaty | any> = new Map();
    private static qrCodes: Map<string, string> = new Map();
    private static loginTimes: Map<string, string> = new Map();
    // Prevent concurrent auto-restarts for the same user
    private static restartingUsers: Set<string> = new Set();

    // Room / Contact caches — populated when the user views the groups or contacts
    // list in the UI, and cleared whenever the bot session ends. This eliminates
    // the repeated doGet HTTP round-trips to WeChat on every task execution.
    private static roomCaches: Map<string, Map<string, any>> = new Map();
    private static contactCaches: Map<string, Map<string, any>> = new Map();

    // ── Cache write ──────────────────────────────────────────────────────────

    static cacheRooms(username: string, rooms: any[]): void {
        if (!this.roomCaches.has(username)) {
            this.roomCaches.set(username, new Map());
        }
        const cache = this.roomCaches.get(username)!;
        for (const room of rooms) {
            cache.set(room.id, room);
        }
        console.log(`[BotManager] Room cache updated for ${username}: ${cache.size} rooms`);
    }

    static cacheContacts(username: string, contacts: any[]): void {
        if (!this.contactCaches.has(username)) {
            this.contactCaches.set(username, new Map());
        }
        const cache = this.contactCaches.get(username)!;
        for (const contact of contacts) {
            cache.set(contact.id, contact);
        }
        console.log(`[BotManager] Contact cache updated for ${username}: ${cache.size} contacts`);
    }

    // ── Cache read ───────────────────────────────────────────────────────────

    static getCachedRoom(username: string, roomId: string): any | null {
        return this.roomCaches.get(username)?.get(roomId) ?? null;
    }

    static getCachedContact(username: string, contactId: string): any | null {
        return this.contactCaches.get(username)?.get(contactId) ?? null;
    }

    // ── Cache invalidation ───────────────────────────────────────────────────

    static clearCache(username: string): void {
        const roomCount = this.roomCaches.get(username)?.size ?? 0;
        const contactCount = this.contactCaches.get(username)?.size ?? 0;
        this.roomCaches.delete(username);
        this.contactCaches.delete(username);
        console.log(`[BotManager] Cache cleared for ${username} (was: ${roomCount} rooms, ${contactCount} contacts)`);
    }

    // ── Existing accessors ───────────────────────────────────────────────────

    static getQrCode(username: string): string | null {
        return this.qrCodes.get(username) || null;
    }

    static getLoginTime(username: string): string | null {
        return this.loginTimes.get(username) || null;
    }

    static getBot(username: string): Wechaty | any {
        if (this.instances.has(username)) {
            return this.instances.get(username)!;
        }

        // Use MockBot for 'test' user
        if (username === 'test') {
            console.log(`[BotManager] Initializing MockBot for ${username}`);
            const mockBot = new MockBot(username);
            this.instances.set(username, mockBot);
            // Simulate login time immediately
            this.loginTimes.set(username, new Date().toISOString());
            return mockBot;
        }

        const userDir = UserManager.getUserDir(username);
        // Wechaty name determines the memory-card location.
        // If name is 'users/admin/bot', it creates 'users/admin/bot.memory-card.json'
        // We need to be careful with paths. Wechaty appends .memory-card.json
        const botName = path.join('users', username, 'bot');

        console.log(`Initializing bot for ${username} at ${botName}`);

        const bot = WechatyBuilder.build({
            name: botName,
            puppet: 'wechaty-puppet-wechat',
            puppetOptions: {
                uos: true
            }
        });

        // Setup basic listeners
        bot.on('scan', async (qrcode, status) => {
             console.log(`[${username}] Scan QR Code to login: ${status}\n${qrcode}`);
             try {
                 const qrcodeImageUrl = await QRCode.toDataURL(qrcode);
                 console.log(`[${username}] QR Image generated successfully`);
                 BotManager.qrCodes.set(username, qrcodeImageUrl);
             } catch (e) {
                 console.error(`[${username}] Failed to generate QR code image:`, e);
             }
        });

        bot.on('login', user => {
            console.log(`[${username}] User ${user} logged in`);
            BotManager.qrCodes.delete(username);
            BotManager.loginTimes.set(username, new Date().toISOString());

            // Pre-warm room/contact caches every time the bot (re-)logs in,
            // including auto-restarts triggered by watchdog logout events.
            // Fire-and-forget — must never throw into the event loop.
            Promise.all([
                bot.Room.findAll().then((rooms: any[]) => {
                    BotManager.cacheRooms(username, rooms);
                    console.log(`[${username}] Pre-warmed ${rooms.length} rooms after bot login`);
                }),
                bot.Contact.findAll().then((contacts: any[]) => {
                    const friends = contacts.filter((c: any) => c.friend());
                    BotManager.cacheContacts(username, friends);
                    console.log(`[${username}] Pre-warmed ${friends.length} contacts after bot login`);
                })
            ]).catch(e => console.error(`[${username}] Cache pre-warm failed after bot login:`, e));
        });
        bot.on('logout', async user => {
            console.log(`[${username}] User ${user} logged out`);
            BotManager.loginTimes.delete(username);
            BotManager.qrCodes.delete(username);
            // Session is dead — cached room/contact objects are invalid
            BotManager.clearCache(username);

            // Auto-restart so the scan QR flow begins again.
            // Guard against concurrent restarts (e.g. rapid logout events).
            if (BotManager.restartingUsers.has(username)) return;
            BotManager.restartingUsers.add(username);

            console.log(`[${username}] Session expired — scheduling auto-restart in 3s`);
            setTimeout(async () => {
                try {
                    await BotManager.stopBot(username);
                    BotManager.getBot(username);
                    console.log(`[${username}] Auto-restart complete, waiting for QR scan`);
                } catch (e) {
                    console.error(`[${username}] Auto-restart failed:`, e);
                } finally {
                    BotManager.restartingUsers.delete(username);
                }
            }, 3000);
        });
        bot.on('message', msg => console.log(`[${username}] Message: ${msg}`));
        // Suppress GError: NOPUPPET which can happen during startup check
        bot.on('error', e => {
            if (e.message.includes('NOPUPPET')) return;
            console.error(`[${username}] Error:`, e);
        });

        // Start the bot
        bot.start()
            .then(() => console.log(`[${username}] Bot started`))
            .catch(e => console.error(`[${username}] Failed to start bot`, e));

        this.instances.set(username, bot);
        return bot;
    }

    static async stopBot(username: string) {
        if (this.instances.has(username)) {
            const bot = this.instances.get(username)!;
            await bot.stop();
            this.instances.delete(username);
        }
        // Clear cache regardless — the new session will repopulate it
        this.clearCache(username);
    }
}
