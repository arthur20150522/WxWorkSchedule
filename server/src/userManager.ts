import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import { UserConfig } from './types.js';

const USER_CONFIG_PATH = path.resolve(process.cwd(), '.user');

// Ensure config exists
if (!fs.existsSync(USER_CONFIG_PATH)) {
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

    private static saveUsers(users: UserConfig) {
        fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(users, null, 2));
    }

    static async verifyUser(username: string, password: string): Promise<boolean> {
        const users = this.getUsers();
        const storedPassword = users[username];

        if (!storedPassword) return false;

        // Check if it looks like a bcrypt hash (starts with $2a$, $2b$, $2y$)
        const isHash = storedPassword.startsWith('$2');

        if (isHash) {
            return await bcrypt.compare(password, storedPassword);
        }

        // Fallback to plain text check (and migrate if match)
        if (storedPassword === password) {
            // It was a match! Migrate to hash
            try {
                const hashedPassword = await bcrypt.hash(password, 10);
                users[username] = hashedPassword;
                this.saveUsers(users);
                console.log(`Migrated password for user ${username} to hash.`);
            } catch (e) {
                console.error('Failed to migrate password', e);
            }
            return true;
        }

        return false;
    }

    static getUserDir(username: string): string {
        const dir = path.resolve(process.cwd(), 'users', username);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }
}
