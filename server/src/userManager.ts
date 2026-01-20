import fs from 'fs';
import path from 'path';
import { UserConfig } from './types.js';

const USER_CONFIG_PATH = path.resolve(process.cwd(), '.user');

// Ensure config exists
if (!fs.existsSync(USER_CONFIG_PATH)) {
    // fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify({ admin: 'admin123' }, null, 2));
    // User requested to remove default account creation
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify({}, null, 2));
}

export class UserManager {
    static getUsers(): UserConfig {
        try {
            const data = fs.readFileSync(USER_CONFIG_PATH, 'utf-8');
            return JSON.parse(data);
        } catch (e) {
            console.error('Failed to read .user config', e);
            return {};
        }
    }

    static verifyUser(username: string, password: string): boolean {
        const users = this.getUsers();
        return users[username] === password;
    }

    static getUserDir(username: string): string {
        const dir = path.resolve(process.cwd(), 'users', username);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }
}
