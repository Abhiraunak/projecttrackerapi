import type { RequestHandler } from "express";
import type { Permission } from "../lib/permissions.js";
import { requireAdmin, requireCan } from "../lib/projectAccess.js";

/** Route guard: the signed-in person must hold this permission. Put it after requireAuth. */
export const allow =
  (permission: Permission): RequestHandler =>
  async (req, _res, next) => {
    try {
      await requireCan(req.user!.sub, permission);
      next();
    } catch (error) {
      next(error);
    }
  };

/** Route guard: admins only. Put it after requireAuth. */
export const adminOnly: RequestHandler = async (req, _res, next) => {
  try {
    await requireAdmin(req.user!.sub);
    next();
  } catch (error) {
    next(error);
  }
};
