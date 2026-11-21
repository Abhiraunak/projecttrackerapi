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

export type AddPurchase = z.infer<typeof addPurchaseSchema>["body"];
export type UpdatePurchase = z.infer<typeof updatePurchaseSchema>["body"];



/** A number from a form that may be left empty: "" (or nothing) means not given */
const optionalNumber = (max: number, negative: string) =>
  z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.coerce.number().finite().min(0, negative).max(max).optional());

/**
 * One delivery: the date, how many arrived, and what it cost: the rate, the amount, both or neither (the bill isn't in
 * yet: saved as "not set", counting nothing until it is edited). Sent as a form because of the bill.
 */
const deliveryFields = {
  date: z.iso.date(),
  quantity: z.coerce.number().finite().positive("Enter how many arrived.").max(1_000_000_000),
  rate: optionalNumber(100_000_000, "The rate can't be negative."),
  amount: optionalNumber(10_000_000_000, "The amount can't be negative."),
};
export const addDeliverySchema = z.object({ body: z.object(deliveryFields) });
export const updateDeliverySchema = z.object({ body: z.object(deliveryFields) });
/** Archive (it stops counting) or restore a delivery */
export const archiveDeliverySchema = z.object({ body: z.object({ archived: z.boolean() }) });

export type AddDelivery = z.infer<typeof addDeliverySchema>["body"];

/** Lines of a Material estimate (BOQ) to bring into Materials: the estimate and the ids of its priced lines */
export const importFromEstimateSchema = z.object({
  body: z.object({
    boqId: z.string().min(1).max(64),
    partIds: z.array(z.string().min(1).max(64)).min(1, "Pick at least one line of the estimate.").max(1000),
  }),
});
export type ImportFromEstimate = z.infer<typeof importFromEstimateSchema>["body"];