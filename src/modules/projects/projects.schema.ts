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
// The firm or client name shown on the project tile; empty clears it
const firmName = z.string().trim().max(120).transform((v) => v || null).nullable();
const projectCost = amount.nullable().default(null); // what the whole project should cost; null = not set
const tasks = z.array(taskInput).min(1).max(200);

export const createProjectSchema = z.object({ body: z.object({ title, projectCost, tasks }) });
export const updateProjectSchema = z.object({ body: z.object({ title, projectCost, status: statusEnum.optional(), tasks }) });

// A project date: "2026-11-01"; one sent with a time ("2026-11-01T00:00:00.000Z") keeps only its day; "" clears it
const projectDay = z
  .string()
  .trim()
  .transform((v) => v.slice(0, 10))
  .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Pick the date again.")
  .transform((v) => v || null);

export const patchProjectSchema = z.object({
  body: z
    // No default here: leaving projectCost out must keep the saved cost, not clear it
    .object({
      title: title.optional(),
      firmName: firmName.optional(),
      // The project number (admins only): letters, numbers, - / and spaces; empty goes back to the automatic PT-00N
      number: z
        .string()
        .trim()
        .max(30, "Keep the project number under 30 letters.")
        .regex(/^[A-Za-z0-9\-/ ]*$/, "Use only letters, numbers, - and /.")
        .nullable()
        .optional(),
      projectCost: z.coerce.number().pipe(amount).nullable().optional(), // a number sent as text ("5000000") is fine too
      status: statusEnum.optional(),
      // The project's own dates; null clears them (then the work items' dates are used)
      startDate: projectDay.nullable().optional(),
      endDate: projectDay.nullable().optional(),
    })
    .refine((b) => Object.keys(b).length > 0, "Nothing to update")
    .refine((b) => !b.startDate || !b.endDate || b.endDate >= b.startDate, { message: "The finish date can't be before the start date.", path: ["endDate"] }),
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