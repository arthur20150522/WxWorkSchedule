import express from 'express';
import jwt from 'jsonwebtoken';
import { UserManager } from './userManager.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not defined in environment variables');
}

export interface AuthRequest extends express.Request {
    user?: string;
}

export const authenticateToken = (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
    // 允许 OPTIONS 请求直接通过 (如果 Nginx 没拦截，这里再次放行)
    if (req.method === 'OPTIONS') {
        return next();
    }

    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        console.warn(`[Auth] No token provided for ${req.method} ${req.url}`);
        return res.sendStatus(401);
    }

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) {
            console.error(`[Auth] Token verification failed for ${req.method} ${req.url}:`, err.message);
            return res.sendStatus(403);
        }
        req.user = user.username;
        next();
    });
};

export const generateToken = (username: string) => {
    return jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
};
