import { z } from "zod";
const amount = z.number().finite().min(0).max(1_000_000_000);
const hours = z.number().finite().min(0).max(24);
const worker = z.object({
    id: z.string().max(64).optional(), // ignored: workers are replaced on every save
    label: z.string().trim().min(1).max(40), // L1, L2… when paid by amount; the labourer's name when paid hourly
    amount: amount.default(0), // paid by amount; worked out on the server when paid hourly
    // Paid hourly: rupees for 8 hours, and the hours and overtime worked that day
    dayRate: amount.optional(),
    hours: hours.optional(),
    otHours: hours.optional(),
});
const fields = {
    contractorName: z.string().trim().min(1).max(120),
    trade: z.string().trim().max(40).default(""), // "Civil", "Tiles"…; empty: not set
    date: z.iso.date(), // "YYYY-MM-DD"
    workers: z.array(worker).min(1).max(100),
    extras: amount.default(0),
    notes: z.string().trim().max(500).default(""),
    // "amount": rupees typed for each labourer ("Paid monthly"); "hourly": hours + OT × each labourer's rate
    payMode: z.enum(["amount", "hourly"]).default("amount"),
};
export const createAttendanceSchema = z.object({
    body: z.object({ projectId: z.string().min(1).max(64), ...fields }),
});
/**
 * Several days at once: one entry per day. Days must be different, at most 62. Each labourer may have a different
 * amount on each day (`amounts`, by date); a day it doesn't list uses its `amount`.
 */
const { date: _date, workers: _workers, ...withoutDateAndWorkers } = fields;
const bulkWorker = worker.extend({
    amounts: z.record(z.iso.date(), amount).optional(), // paid by amount: rupees by day
    hoursByDay: z.record(z.iso.date(), hours).optional(), // paid hourly: hours by day
    otByDay: z.record(z.iso.date(), hours).optional(), // paid hourly: overtime by day
});
export const createManyAttendanceSchema = z.object({
    body: z
        .object({
        projectId: z.string().min(1).max(64),
        ...withoutDateAndWorkers,
        workers: z.array(bulkWorker).min(1).max(100),
        dates: z
            .array(z.iso.date())
            .min(1)
            .max(62, "At most 62 days at once")
            .refine((days) => new Set(days).size === days.length, "The same day is listed twice"),
    })
        .superRefine((body, ctx) => {
        const chosen = new Set(body.dates);
        body.workers.forEach((w, i) => {
            for (const field of ["amounts", "hoursByDay", "otByDay"]) {
                for (const day of Object.keys(w[field] ?? {})) {
                    if (!chosen.has(day))
                        ctx.addIssue({ code: "custom", path: ["workers", i, field, day], message: `${day} is not one of the chosen days` });
                }
            }
        });
    }),
});
// A record can't move to another project. Trade left out (an older screen): the entry keeps its trade.
// Trade or pay mode left out (an older screen): the entry keeps its own.
export const updateAttendanceSchema = z.object({
    body: z.object({ ...fields, trade: z.string().trim().max(40).optional(), payMode: z.enum(["amount", "hourly"]).optional() }),
});
/** req.query is read-only in Express 5, so the controller parses it directly */
export const listQuerySchema = z.object({
    projectId: z.string().min(1).max(64).optional(),
    q: z.string().trim().max(100).optional(),
    trade: z.string().max(40).optional(), // one trade only; "-" means entries with no trade set
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(5),
    grouped: z
        .enum(["true", "false"])
        .optional()
        .transform((v) => v === "true"), // days saved together as one item (the saved-records list)
});
/** Every entry of one contractor on a project gets this trade (only those with none, unless `all`) */
export const setTradeSchema = z.object({
    body: z.object({
        projectId: z.string().min(1).max(64),
        contractorName: z.string().trim().min(1).max(120),
        trade: z.string().trim().min(1).max(40),
        all: z.boolean().default(false),
    }),
});
export const tradesQuerySchema = z.object({ projectId: z.string().min(1).max(64) });
//# sourceMappingURL=atttendance.schema.js.map