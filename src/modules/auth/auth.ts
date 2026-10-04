import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { HttpError } from "../../lib/error.js";
import { env } from "../../config/env.js";
import { AuthUser } from "../../types/express.js";

// Verifies the short-lived access token only. Renewing it is the job of POST /auth/refresh.
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token: string | undefined = req.cookies?.access_token ?? req.headers.authorization?.split(" ")[1];
  if (!token) return next(new HttpError(401, "Unauthorized"));

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ["HS256"] });
    if (typeof payload === "string" || !payload.sub) throw new Error("bad payload");
    req.user = { sub: payload.sub, role: payload["role"] } as AuthUser;
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token"));
  }
};

export const requireRole =
  (...roles: AuthUser["role"][]): RequestHandler =>
  (req, _res, next) =>
    req.user && roles.includes(req.user.role) ? next() : next(new HttpError(403, "Forbidden"));