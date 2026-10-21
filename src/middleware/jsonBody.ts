import express, { type RequestHandler } from "express";

/**
 * Reads JSON request bodies, with a size limit that depends on the route:
 * a BOQ is a whole document (rows, plus a small embedded logo) so it may be up to 2 MB; everything else 100 KB.
 * Use it in place of app.use(express.json({ limit: '100kb' })).
 */
const small = express.json({ limit: "100kb" });
const large = express.json({ limit: "2mb" });
const LARGE_BODY_ROUTES = [/^\/api\/v1\/boqs(\/|$)/];

export const jsonBody: RequestHandler = (req, res, next) =>
  (LARGE_BODY_ROUTES.some((route) => route.test(req.path)) ? large : small)(req, res, next);
