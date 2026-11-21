import { z } from "zod";
/* The simple Material estimate: a named list of materials (unit, quantity, rate) for one project. */
const line = z.object({
    // a saved line keeps its id (and its link to Materials); a new one comes with an id made by the browser
    id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Bad line id.").optional(),
    name: z.string().trim().max(200).default(""),
    unit: z.string().trim().max(30).default(""),
    quantity: z.number().finite().min(0).max(1_000_000_000).default(0),
    rate: z.number().finite().min(0).max(100_000_000).default(0),
});
export const createEstimateSchema = z.object({
    body: z.object({ name: z.string().trim().min(1, "Give the estimate a name.").max(120).default("New estimate") }),
});
/** The whole estimate as it is on screen: its name and every line, in order (saved as you type) */
export const saveEstimateSchema = z.object({
    body: z.object({
        name: z.string().trim().min(1, "Give the estimate a name.").max(120),
        lines: z.array(line).max(1000),
    }),
});
//# sourceMappingURL=materialEstimates.schema.js.map