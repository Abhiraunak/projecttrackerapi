import { z } from "zod";

const projectId = z.string().min(1).max(64);
const contractor = z.string().trim().min(1).max(120);

/** req.query is read-only in Express 5, so these are parsed in the handlers */
export const teamQuerySchema = z.object({ projectId, contractor });

export const monthQuerySchema = z.object({
  projectId,
  contractor: contractor.optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month as YYYY-MM"),
});

export const saveTeamSchema = z.object({
  projectId,
  contractorName: contractor,
  members: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        name: z.string().trim().min(1, "Every labourer needs a name.").max(40),
        dayRate: z.number().finite().min(0).max(1_000_000), // for 8 hours
        active: z.boolean().default(true),
      })
    )
    .max(200),
});