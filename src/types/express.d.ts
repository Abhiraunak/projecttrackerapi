export type AuthUser = { sub: string; role: 'USER' | 'ADMIN' };

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}