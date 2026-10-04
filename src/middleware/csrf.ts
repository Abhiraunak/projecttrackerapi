import type { RequestHandler } from "express";
import { HttpError } from "../lib/error.js";


const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * A page on another site can submit a form or <img> request with your cookies, but it cannot add a custom header
 * without CORS permission (and your CORS whitelist doesn't allow it). So requiring one blocks forged requests.
 * The frontend sends `X-Requested-With: fetch` on every call.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) =>
  SAFE_METHODS.has(req.method) || req.get("x-requested-with") === "fetch"
    ? next()
    : next(new HttpError(403, "Missing CSRF header"));