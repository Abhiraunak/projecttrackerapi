import { z } from "zod";
const id = z.string().min(1).max(64);
const perUnit = z.number().finite().min(0).max(1_000_000);
const wastage = z.number().finite().min(0).max(100);
const line = z.object({ materialId: id, perUnit, wastagePercent: wastage.default(0) });
const lines = z.array(line).max(30).refine((l) => new Set(l.map((x) => x.materialId)).size === l.length, "A material is listed twice");
/** An item's materials: a list of lines, or "labour only" (no materials) */
export const itemMaterialsSchema = z.object({
    body: z.object({
        noMaterials: z.boolean().default(false),
        recipeName: z.string().trim().max(120).default(""),
        lines,
    }),
});
export const recipeSchema = z.object({
    body: z.object({
        name: z.string().trim().min(1).max(120),
        unit: z.string().trim().min(1).max(20),
        /** Each group is a list of words that must all appear; one group is enough */
        match: z.array(z.array(z.string().trim().min(1).max(40)).min(1).max(6)).min(1).max(10),
        lines: lines.min(1),
    }),
});
/** Import from BOQ: one BOQ and the priced parts (their ids inside the BOQ) that were ticked */
export const importSchema = z.object({
    body: z.object({
        boqId: id,
        partKeys: z.array(id).min(1, "Tick at least one item").max(5000),
    }),
});
//# sourceMappingURL=plan.schema.js.map