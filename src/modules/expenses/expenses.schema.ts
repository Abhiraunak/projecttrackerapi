import { z } from "zod";

export const EXPENSE_CATEGORIES = ["general", "labour", "material"] as const;

/** Sent as a form (the bill is a file), so the amount arrives as text and is turned into a number here */
export const addExpenseSchema = z.object({
  body: z.object({
    category: z.enum(EXPENSE_CATEGORIES).default("general"),
    date: z.iso.date(),
    amount: z.coerce.number().finite().positive("Enter an amount above zero.").max(1_000_000_000),
    purpose: z.string().trim().min(1, "Say what it was for.").max(200),
    remark: z.string().trim().max(500).default(""),
  }),
});

export type AddExpense = z.infer<typeof addExpenseSchema>["body"];

/** Changing an expense: the same fields; a new file replaces the bill, removeBill=true takes it off */
export const updateExpenseSchema = z.object({
  body: addExpenseSchema.shape.body.extend({
    removeBill: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  }),
});
export type UpdateExpense = z.infer<typeof updateExpenseSchema>["body"];