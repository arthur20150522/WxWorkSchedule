import { Wechaty, WechatyBuilder } from 'wechaty';
import { UserManager } from './userManager.js';
import path from 'path';
import QRCode from 'qrcode';

export class BotManager {
    private static instances: Map<string, Wechaty> = new Map();
    private static qrCodes: Map<string, string> = new Map();
    private static loginTimes: Map<string, string> = new Map();

    static getQrCode(username: string): string | null {
        return this.qrCodes.get(username) || null;
    }

    static getLoginTime(username: string): string | null {
        return this.loginTimes.get(username) || null;
    }

    static getBot(username: string): Wechaty {
        if (this.instances.has(username)) {
            return this.instances.get(username)!;
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
        });
        bot.on('logout', user => {
            console.log(`[${username}] User ${user} logged out`);
            BotManager.loginTimes.delete(username);
            // Optionally clean up or mark as logged out
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
    }
}
