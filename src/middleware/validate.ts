import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

// Schema shape: z.object({ body?, query?, params? })
export const validate =
  (schema: ZodType<{ body?: unknown }>): RequestHandler =>
  (req, _res, next) => {
    const parsed = schema.parse({ body: req.body, query: req.query, params: req.params });
    if (parsed.body !== undefined) req.body = parsed.body; // req.query is read-only in Express 5
    next();
  };