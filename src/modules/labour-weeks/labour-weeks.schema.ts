import { z } from "zod";

const ymd = z.iso.date();
const name = z.string().trim().min(1, "Enter the contractor or team head.").max(120);

/** Contract work: quantity × rate (₹ per sqft, per running ft, per piece…) */
export const measureSchema = z.object({
    body: z.object({
        trade: z.string().trim().max(40).default(""),
        contractorName: name,
        date: ymd,
        work: z.string().trim().min(1, "Say what work was measured, e.g. Floor tiles, 2nd floor.").max(160),
        quantity: z.coerce.number().finite().positive("Enter the area or quantity measured.").max(10_000_000),
        unit: z.string().trim().min(1).max(20).default("sqft"),
        rate: z.coerce.number().finite().positive("Enter the rate.").max(1_000_000),
        note: z.string().trim().max(500).default(""),
    }),
});
export type MeasureInput = z.infer<typeof measureSchema>["body"];

/** Settle (or reopen) one contractor's pay week */
export const settleSchema = z.object({
    body: z.object({
        start: ymd, // any day of the week; the Monday is worked out
        trade: z.string().trim().max(40).default(""),
        contractorName: name,
    }),
});
export type SettleInput = z.infer<typeof settleSchema>["body"];

export const weekQuery = z.object({ start: ymd.optional() });
export const monthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month as YYYY-MM") });
export const searchQuery = z.object({ q: z.string().trim().min(2, "Type at least 2 letters.").max(80) });