import type { CookieOptions, Request, Response } from 'express';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma.js';
import { env, isProd } from '../../config/env.js';
import type { Credentials } from './auth.schema.js';

const cookieOpts: CookieOptions = {
  httpOnly: true,            // JS can't read it (XSS protection)
  secure: isProd,            // HTTPS only in production
  sameSite: 'lax',           // 'none' + secure only if frontend is on a different site
  maxAge: 15 * 60 * 1000,
};

const sign = (user: { id: string; role: string }) =>
  jwt.sign({ sub: user.id, role: user.role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });

export async function register(req: Request<unknown, unknown, Credentials>, res: Response) {
  const { email, password } = req.body;
  const passwordHash = await argon2.hash(password);
  const user = await prisma.user.create({
    data: { email, passwordHash },
    select: { id: true, email: true, role: true }, // never return the hash
  });
  res.status(201).json({ user });
}

export async function login(req: Request<unknown, unknown, Credentials>, res: Response) {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user && (await argon2.verify(user.passwordHash, password));
  if (!user || !ok) {
    res.status(401).json({ error: 'Invalid credentials' }); // same message for both cases
    return;
  }

  res.cookie('access_token', sign(user), cookieOpts);
  res.json({ user: { id: user.id, email: user.email, role: user.role } });
}

export function logout(_req: Request, res: Response) {
  res.clearCookie('access_token', { ...cookieOpts, maxAge: undefined });
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.sub },
    select: { id: true, email: true, role: true },
  });
  res.json({ user });
}