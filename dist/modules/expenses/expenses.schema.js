import { z } from "zod";
/** Sent as a form (the bill is a file), so the amount arrives as text and is turned into a number here */
export const addExpenseSchema = z.object({
    body: z.object({
        date: z.iso.date(),
        amount: z.coerce.number().finite().positive("Enter an amount above zero.").max(1_000_000_000),
        purpose: z.string().trim().min(1, "Say what it was for.").max(200),
        remark: z.string().trim().max(500).default(""),
    }),
});
//# sourceMappingURL=expenses.schema.js.map