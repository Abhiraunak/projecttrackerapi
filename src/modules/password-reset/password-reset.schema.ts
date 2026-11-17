import { z } from "zod";

/*
 * Every input is checked here before any code runs: exact shapes, lengths and characters. The database is reached
 * only through Prisma, which sends values as parameters (never pasted into SQL), so no input can change a query.
 */

const email = z.string().trim().toLowerCase().max(254).email("Enter a valid email.");
const code = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.");
const ticket = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "This reset link has expired. Start again.");

/** At least 8 characters, a letter and a number; spaces allowed; long passphrases welcome */
export const newPassword = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(128, "Use at most 128 characters.")
  .regex(/[A-Za-z]/, "Add at least one letter.")
  .regex(/\d/, "Add at least one number.");

export const forgotSchema = z.object({ body: z.object({ email }).strict() });
export const verifySchema = z.object({ body: z.object({ email, code }).strict() });
export const resetSchema = z.object({ body: z.object({ ticket, password: newPassword }).strict() });
export const changeSchema = z.object({ body: z.object({ currentPassword: z.string().min(1).max(256), newPassword }).strict() });

export type ForgotInput = z.infer<typeof forgotSchema>["body"];
export type VerifyInput = z.infer<typeof verifySchema>["body"];
export type ResetInput = z.infer<typeof resetSchema>["body"];
export type ChangeInput = z.infer<typeof changeSchema>["body"];