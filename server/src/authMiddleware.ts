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
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
        if (err) return res.sendStatus(403);
        req.user = user.username;
        next();
    });
};

export const generateToken = (username: string) => {
    return jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
};
