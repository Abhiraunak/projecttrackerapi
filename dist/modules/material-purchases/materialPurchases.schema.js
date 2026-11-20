import { z } from "zod";
/** Sent as a form (the bill is a file), so the numbers arrive as text and are turned into numbers here */
const fields = {
    section: z.string().trim().max(80).default(""), // "Flooring", "Concrete"… (optional)
    name: z.string().trim().min(1, "Enter the material.").max(120),
    unit: z.string().trim().max(30).default(""),
    quantity: z.coerce.number().finite().positive("Enter a quantity above zero.").max(1_000_000_000),
    rate: z.coerce.number().finite().min(0, "The rate can't be negative.").max(100_000_000),
    date: z.iso.date(),
    note: z.string().trim().max(300).default(""),
};
export const addPurchaseSchema = z.object({ body: z.object(fields) });
export const updatePurchaseSchema = z.object({
    body: z.object({
        ...fields,
        // "true" drops the saved bill (a new file replaces it anyway)
        removeBill: z
            .enum(["true", "false"])
            .optional()
            .transform((v) => v === "true"),
    }),
});
/** One delivery: the date, how many arrived and at what rate (sent as a form because of the bill) */
export const addDeliverySchema = z.object({
    body: z.object({
        date: z.iso.date(),
        quantity: z.coerce.number().finite().positive("Enter how many arrived.").max(1_000_000_000),
        rate: z.coerce.number().finite().min(0, "The rate can't be negative.").max(100_000_000),
    }),
});
/** Lines of a Material estimate (BOQ) to bring into Materials: the estimate and the ids of its priced lines */
export const importFromEstimateSchema = z.object({
    body: z.object({
        boqId: z.string().min(1).max(64),
        partIds: z.array(z.string().min(1).max(64)).min(1, "Pick at least one line of the estimate.").max(1000),
    }),
});
//# sourceMappingURL=materialPurchases.schema.js.map