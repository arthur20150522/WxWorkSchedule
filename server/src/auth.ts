import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const USER_CONFIG_PATH = path.resolve(process.cwd(), '.user');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is not defined in environment variables');
}

interface UserConfig {
  [username: string]: string; // plaintext or bcrypt hash
}

function readConfig(): UserConfig {
  try {
    if (!fs.existsSync(USER_CONFIG_PATH)) return {};
    return JSON.parse(fs.readFileSync(USER_CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/** First startup: create default account with random password */
async function initDefaultUser(): Promise<{ user: string; password: string } | null> {
  const config = readConfig();
  if (Object.keys(config).length > 0) return null;

  const username = 'admin';
  const password = Math.random().toString(36).slice(2, 12);
  config[username] = password; // plaintext, migrated on first login
  fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log('==========================================================');
  console.log(`  Default account created:`);
  console.log(`  Username: ${username}`);
  console.log(`  Password: ${password}`);
  console.log(`  (will be encrypted on first login)`);
  console.log('==========================================================');
  return { user: username, password };
}

/** Verify any username+password combo (supports plaintext auto-migration) */
export async function verifyPassword(username: string, password: string): Promise<boolean> {
  await initDefaultUser();

  const config = readConfig();
  const stored = config[username];
  if (!stored) return false;

  const isHash = stored.startsWith('$2');
  if (isHash) {
    return bcrypt.compare(password, stored);
  }

  // Plaintext — match and auto-migrate
  if (stored === password) {
    config[username] = await bcrypt.hash(password, 10);
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(config, null, 2));
    console.log(`[Auth] Password for "${username}" migrated to bcrypt`);
    return true;
  }

  return false;
}

/** Generate a JWT token (7-day expiry) */
export function generateToken(username: string): string {
  return jwt.sign({ username }, JWT_SECRET as jwt.Secret, { expiresIn: '7d' });
}

/** Verify a JWT token — returns username or null */
export function verifyToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET as jwt.Secret) as unknown as { username: string };
    return decoded.username;
  } catch {
    return null;
  }
}
