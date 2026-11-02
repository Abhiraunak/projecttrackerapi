import { z } from "zod";
import { CATEGORY_KEYS } from "./equipment.calc.js";
const qty = z.number().finite().positive().max(10_000_000);
const optionalText = (max) => z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const place = z.string().min(1).max(64).nullable(); // a project id, or null for the yard
const details = {
    name: z.string().trim().min(1).max(120),
    category: z.enum(CATEGORY_KEYS).default("other"),
    unit: z.string().trim().min(1).max(20).default("nos"),
    code: optionalText(60),
    ownership: z.enum(["owned", "hired"]).default("owned"),
    hireRate: z.number().finite().min(0).max(100_000_000).nullish().transform((v) => v ?? null),
    hirePer: z.enum(["day", "month"]).default("day"),
    supplier: optionalText(120),
    serviceDue: z.iso.date().nullish().transform((v) => v ?? null),
    notes: z.string().trim().max(1000).default(""),
};
/** New item: its details, and how many arrive where (the yard, or straight at a site) */
export const createEquipmentSchema = z.object({
    body: z.object({
        ...details,
        quantity: qty,
        to: place.default(null),
        date: z.iso.date(),
    }),
});
// No defaults here: a field left out of an update keeps its saved value instead of resetting to the default
// (and no .nullish(): it would turn a missing field into null and clear it)
const text = (max) => z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));
const changes = {
    name: details.name,
    category: z.enum(CATEGORY_KEYS),
    unit: z.string().trim().min(1).max(20),
    code: text(60),
    ownership: z.enum(["owned", "hired"]),
    hireRate: z.number().finite().min(0).max(100_000_000).nullable(),
    hirePer: z.enum(["day", "month"]),
    supplier: text(120),
    serviceDue: z.iso.date().nullable(),
    notes: z.string().trim().max(1000),
    retired: z.boolean(),
};
export const updateEquipmentSchema = z.object({
    body: z
        .object(changes)
        .partial()
        .refine((v) => Object.keys(v).length > 0, "Nothing to change."),
});
export const moveSchema = z.object({
    body: z.object({
        kind: z.enum(["add", "move", "write_off"]),
        from: place.default(null),
        to: place.default(null),
        quantity: qty,
        date: z.iso.date(),
        condition: z.enum(["good", "repair", "damaged"]).default("good"),
        note: z.string().trim().max(300).default(""),
    }),
});
//# sourceMappingURL=equipment.schema.js.map