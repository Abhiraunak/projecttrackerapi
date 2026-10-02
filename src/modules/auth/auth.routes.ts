import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { registerSchema, loginSchema } from './auth.schema.js';
import * as c from './auth.controller.js';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

const router = Router();
router.post('/register', authLimiter, validate(registerSchema), c.register);
router.post('/login', authLimiter, validate(loginSchema), c.login);
router.post('/logout', c.logout);
router.get('/me', requireAuth, c.me);

export default router;