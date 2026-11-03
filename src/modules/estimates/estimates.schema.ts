import { z } from "zod";
import { ESTIMATE_METHODS } from "./estimates.calc.js";

const metres = z.number().finite().min(0).max(10_000);
const nos = z.number().finite().min(0).max(100_000).nullish();

const steelRow = z.object({
  name: z.string().trim().max(60).default(""),
  nos,
  dia: z.number().finite().positive().max(100),
  bars: z.number().finite().min(0).max(100_000).nullish(),
  span: metres.nullish(),
  spacing: z.number().finite().positive().max(100).nullish(),
  cutLength: metres,
});

const volumeRow = z.object({
  name: z.string().trim().max(60).default(""),
  nos,
  l: metres,
  b: metres,
  d: metres,
});

/**
 * A material the project needs. Only the material is required, plus a quantity (or rows to work it out from);
 * what it is for, wastage and notes are optional. A new material can be named here and is added to the list.
 */
export const estimateSchema = z.object({
  body: z
    .object({
      materialId: z.string().min(1).max(64).optional(),
      newMaterial: z
        .object({ name: z.string().trim().min(1).max(80), unit: z.string().trim().min(1).max(20), category: z.string().trim().max(40).default("General") })
        .optional(),
      title: z.string().trim().max(120).default(""),
      method: z.enum(ESTIMATE_METHODS).default("quantity"),
      quantity: z.number().finite().min(0).max(1_000_000_000).nullish(),
      steel: z.array(steelRow).max(300).optional(),
      volume: z.array(volumeRow).max(300).optional(),
      wastagePercent: z.number().finite().min(0).max(100).default(0),
      notes: z.string().trim().max(500).default(""),
    })
    .refine((b) => !!b.materialId !== !!b.newMaterial, "Choose a material, or name a new one."),
});

export type EstimateBody = z.infer<typeof estimateSchema>["body"];