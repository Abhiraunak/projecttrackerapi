import { z } from "zod";
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-05");
const money = z.coerce.number().positive().max(1e10).transform((v) => Math.round(v * 100) / 100);
const MODES = ["UPI", "BANK_TRANSFER", "CHEQUE", "CASH", "OTHER"];
/** A payment, from the client's upload form (multipart: every value arrives as text) or the admin's form */
const paymentFields = {
    amount: money,
    paidOn: day.refine((d) => new Date(`${d}T00:00:00Z`).getTime() <= Date.now() + 86_400_000, "The payment date can't be in the future"),
    mode: z.enum(MODES),
    reference: z.string().trim().max(80).default(""),
    note: z.string().trim().max(300).default(""),
};
export const proofSchema = z.object({ body: z.object(paymentFields) });
export const recordPaymentSchema = z.object({ body: z.object(paymentFields) });
export const decideSchema = z.object({ body: z.object({ note: z.string().trim().max(300).default("") }) });
export const addClientSchema = z.object({
    body: z.object({
        email: z.string().trim().toLowerCase().email().max(254),
        name: z.string().trim().max(80).default(""),
    }),
});
const instalmentFields = z.object({
    label: z.string().trim().min(1).max(80),
    kind: z.enum(["ADVANCE", "INSTALMENT"]).default("INSTALMENT"),
    amount: money,
    taxPercent: z.coerce.number().min(0).max(50).default(0),
    dueDate: day.nullable().default(null),
    dueAtProgress: z.coerce.number().int().min(1).max(100).nullable().default(null),
    note: z.string().trim().max(300).default(""),
});
export const createInstalmentSchema = z.object({ body: instalmentFields });
export const updateInstalmentSchema = z.object({
    body: instalmentFields.partial().refine((b) => Object.keys(b).length > 0, "Nothing to update"),
});
export const delaySchema = z.object({
    body: z.object({
        reason: z.enum(["MONSOON", "FESTIVAL", "NATURAL", "OTHER"]),
        title: z.string().trim().min(1).max(100),
        note: z.string().trim().max(300).default(""),
        fromDate: day,
        days: z.coerce.number().int().min(1).max(120).default(7), // a week unless the admin picks another
    }),
});
export const advanceSchema = z.object({ body: z.object({ override: z.boolean() }) });
//# sourceMappingURL=client.schema.js.map