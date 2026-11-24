import { z } from "zod";

/* The simple Labour section: attendance by work with hours and OT, payments by person and dates, subcontract work,
   and rate comparison against subcontractor quotes. Everything here can be changed at any time. */

const ymd = z.iso.date();
const name = z.string().trim().min(1, "Enter the name.").max(120);
const money = z.number().finite().min(0).max(100_000_000);
const hours = z.number().finite().min(0).max(24);

export const dayQuery = z.object({
  date: ymd,
  contractor: name,
  taskId: z.string().max(64).optional(), // left out or "": General (no work)
});

export const rangeQuery = z.object({
  from: ymd,
  to: ymd,
  taskId: z.string().max(64).optional(),
  contractor: z.string().trim().max(120).optional(),
});

export const statementQuery = z.object({ person: name, from: ymd, to: ymd });

/** One day of one contractor's crew on one work: replaces whatever was there */
export const saveDaySchema = z.object({
  body: z.object({
    date: ymd,
    contractorName: name,
    taskId: z.string().min(1).max(64).nullable(),
    workers: z
      .array(
        z.object({
          name: z.string().trim().min(1, "Every worker needs a name.").max(80),
          hours: hours.default(0),
          otHours: hours.default(0),
          rate: money.default(0), // ₹ per hour
          otRate: money.default(0), // ₹ per OT hour
          fixed: money.nullable().default(null), // an old day kept as an amount (no hours): its amount
        }),
      )
      .max(300),
    /** "from this day on": these workers' rates also apply to their later days with this contractor and work */
    forward: z.boolean().default(false),
  }),
});
export type SaveDay = z.infer<typeof saveDaySchema>["body"];

/** Copy one saved day's crew to other days (days that already have an entry are skipped, never changed) */
export const copyDaySchema = z.object({
  body: z.object({
    date: ymd, // the day to copy from
    contractorName: name,
    taskId: z.string().min(1).max(64).nullable(),
    dates: z.array(ymd).min(1, "Pick at least one day.").max(62, "Pick up to 62 days at a time."),
  }),
});
export type CopyDay = z.infer<typeof copyDaySchema>["body"];

export const workSchema = z.object({ body: z.object({ title: z.string().trim().min(1, "Enter the work, e.g. Flooring.").max(120) }) });

export const paymentSchema = z.object({
  body: z.object({
    contractorName: name,
    date: ymd,
    amount: z.number().finite().positive("Enter an amount above zero.").max(1_000_000_000),
    remark: z.string().trim().max(500).default(""),
  }),
});

/** "Paid for a period": a name, the days it covers and the amount paid */
export const periodPaymentSchema = z.object({
  body: z
    .object({
      name,
      from: ymd,
      to: ymd,
      amount: z.number().finite().positive("Enter the amount paid.").max(1_000_000_000),
    })
    .refine((b) => b.from <= b.to, { message: "From must be on or before To.", path: ["to"] }),
});
export type PeriodPaymentInput = z.infer<typeof periodPaymentSchema>["body"];

/** Subcontract work given: quantity = the whole quantity given; done = how much is finished so far (optional) */
export const measureSchema = z.object({
  body: z.object({
    contractorName: name,
    date: ymd,
    work: z.string().trim().min(1, "Say what work it was, e.g. Flooring, 1st floor.").max(160),
    quantity: z.number().finite().positive("Enter the quantity given.").max(10_000_000),
    done: z.number().finite().min(0).max(10_000_000).optional(),
    unit: z.string().trim().min(1).max(20).default("sqft"),
    rate: z.number().finite().min(0).max(1_000_000),
    note: z.string().trim().max(500).default(""),
  }),
});
export type MeasureInput = z.infer<typeof measureSchema>["body"];

/** One person by name (archive, restore, their days and payments) */
export const personSchema = z.object({ body: z.object({ name }) });
export const personQuery = z.object({ name });

/** "Done till date" on one subcontract work: the total finished so far, not just that day's part */
export const progressSchema = z.object({
  body: z.object({ date: ymd, done: z.number().finite().min(0, "Enter how much is done.").max(10_000_000) }),
});

/** A payment to a subcontractor: for one work, or an advance (no work) */
export const subPaymentSchema = z.object({
  body: z.object({
    name,
    date: ymd,
    amount: z.number().finite().positive("Enter the amount paid.").max(1_000_000_000),
    measureId: z.string().min(1).max(64).nullable().default(null),
    remark: z.string().trim().max(500).default(""),
  }),
});
export type SubPaymentInput = z.infer<typeof subPaymentSchema>["body"];

/** Delete for good, from Archived: only rows already archived are removed */
const ids = z.array(z.string().min(1).max(64)).max(500).default([]);
export const archivedDeleteSchema = z.object({
  body: z.object({
    people: z.array(name).max(200).default([]),
    subcontractors: z.array(name).max(200).default([]),
    payments: ids,
    works: ids,
  }),
});
export type ArchivedDelete = z.infer<typeof archivedDeleteSchema>["body"];

/** Rate comparison, per work: how much was done and the contractor's rate per unit */
export const workRateSchema = z.object({
  body: z.object({
    quantity: z.number().finite().min(0).max(100_000_000),
    contractorRate: z.number().finite().min(0).max(10_000_000),
  }),
});

export const quantitySchema = z.object({ body: z.object({ quantity: z.number().finite().min(0).max(100_000_000) }) });

export const quoteSchema = z.object({
  body: z.object({
    name,
    rate: money,
    unit: z.string().trim().min(1).max(20).default("sqft"),
  }),
});