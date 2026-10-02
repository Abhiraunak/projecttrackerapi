import { z } from "zod";

const amount = z.number().finite().min(0).max(1_000_000_000_000);
const measure = z.number().finite().min(0).max(1_000_000_000);

export const statusEnum = z.enum(["ONGOING", "COMPLETED", "ARCHIVED"]);

export const taskInput = z
  .object({
    id: z.string().max(64).optional(), // existing tasks keep their id; new ones may send anything
    work: z.string().trim().min(1).max(120),
    area: measure,
    contractorRate: measure,
    inHouseRate: measure,
    stipulated: amount,
    paid: amount,
    progress: z.number().int().min(0).max(100),
    startDate: z.iso.date(), // "YYYY-MM-DD"
    endDate: z.iso.date(),
  })
  .refine((t) => t.endDate >= t.startDate, {
    message: "End date must be on or after the start date",
    path: ["endDate"],
  });

const title = z.string().trim().min(1).max(120);
const tasks = z.array(taskInput).min(1).max(200);

export const createProjectSchema = z.object({ body: z.object({ title, tasks }) });
export const updateProjectSchema = z.object({ body: z.object({ title, status: statusEnum.optional(), tasks }) });

export const patchProjectSchema = z.object({
  body: z
    .object({ title: title.optional(), status: statusEnum.optional() })
    .refine((b) => Object.keys(b).length > 0, "Nothing to update"),
});

export const patchTaskSchema = z.object({
  body: z
    .object({ progress: z.number().int().min(0).max(100).optional(), paid: amount.optional() })
    .refine((b) => Object.keys(b).length > 0, "Nothing to update"),
});

export type TaskBody = z.infer<typeof taskInput>;
export type CreateBody = z.infer<typeof createProjectSchema>["body"];
export type UpdateBody = z.infer<typeof updateProjectSchema>["body"];
export type PatchProjectBody = z.infer<typeof patchProjectSchema>["body"];
export type PatchTaskBody = z.infer<typeof patchTaskSchema>["body"];