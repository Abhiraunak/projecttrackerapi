import { z } from "zod";
/** Sent as a form (the receipt is a file), so the amount arrives as text and is turned into a number here */
export const addMaterialPaymentSchema = z.object({
    body: z.object({
        vendorName: z.string().trim().min(1, "Enter the vendor's name.").max(120),
        materialId: z.string().max(64).optional().transform((v) => v || undefined), // what it was for (optional)
        date: z.iso.date(),
        amount: z.coerce.number().finite().positive("Enter an amount above zero.").max(1_000_000_000),
        remark: z.string().trim().max(500).default(""),
    }),
});
//# sourceMappingURL=materialPayments.js.map