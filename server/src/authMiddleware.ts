import express from 'express';
import { verifyToken } from './auth.js';

export interface AuthRequest extends express.Request {
  user?: string;
}

export const authenticateToken = (
  req: AuthRequest,
  res: express.Response,
  next: express.NextFunction
) => {
  if (req.method === 'OPTIONS') return next();

  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  const username = verifyToken(token);
  if (!username) {
    return res.sendStatus(403);
  }

  req.user = username;
  next();
};
