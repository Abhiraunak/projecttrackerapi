import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'use a long random secret'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'), // comma-separated
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';