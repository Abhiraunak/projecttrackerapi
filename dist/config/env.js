import { z } from 'zod';
const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(32, 'use a long random secret'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'), // comma-separated
    ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(90),
    COOKIE_SAMESITE: z.enum(["lax", "strict", "none"]).default("lax"),
});
export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
//# sourceMappingURL=env.js.map