import { z } from 'zod';
const credentials = z.object({
    email: z.email().max(254).toLowerCase(),
    password: z.string().min(8).max(128),
});
export const registerSchema = z.object({ body: credentials });
export const loginSchema = z.object({ body: credentials });
//# sourceMappingURL=auth.schema.js.map