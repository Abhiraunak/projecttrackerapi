import { z } from "zod";

// multipart forms send one value as a string and repeated values as an array: always make it an array
const asArray = (value: unknown) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

export const createDrawingSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(""),
    sharedWith: z.preprocess(asArray, z.array(z.string().min(1).max(64)).max(50)),
  }),
});

export const shareDrawingSchema = z.object({
  body: z.object({ userIds: z.array(z.string().min(1).max(64)).max(50) }),
});

/** req.query is read-only in Express 5, so the controller parses it directly */
export const listQuerySchema = z.object({
  scope: z.enum(["all", "mine", "shared"]).default("all"),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(8),
});

export type CreateBody = z.infer<typeof createDrawingSchema>["body"];
export type ShareBody = z.infer<typeof shareDrawingSchema>["body"];
export type ListQuery = z.infer<typeof listQuerySchema>;


export const uploadProjectDrawingSchema = z.object({
  body: z.object({
    number: z.string().trim().min(1).max(24),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(500).default(""),
  }),
});

export const placeDrawingSchema = z.object({
  body: z.object({ projectId: z.string().min(1).max(64), number: z.string().trim().min(1).max(24) }),
});

export type UploadProjectDrawingBody = z.infer<typeof uploadProjectDrawingSchema>["body"];
export type PlaceDrawingBody = z.infer<typeof placeDrawingSchema>["body"];
