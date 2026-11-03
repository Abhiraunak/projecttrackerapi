import { z } from "zod";

/** Sent as a form (the receipt is a file), so the amount arrives as text and is turned into a number here */
export const addPaymentSchema = z.object({
  body: z.object({
    trade: z.string().trim().max(40).default(""),
    contractorName: z.string().trim().min(1, "Enter the contractor's name.").max(120),
    date: z.iso.date(),
    amount: z.coerce.number().finite().positive("Enter an amount above zero.").max(1_000_000_000),
    remark: z.string().trim().max(500).default(""),
  }),
});

export type AddPayment = z.infer<typeof addPaymentSchema>["body"];