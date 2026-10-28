import { z } from "zod";

/** Limits keep one BOQ from becoming unreasonably large to store or calculate */
const LIMITS = { sheets: 20, sections: 100, entries: 300, parts: 50, lines: 500, totalLines: 10_000 } as const;

const id = z.string().min(1).max(64);
const str = (max: number) => z.string().max(max);
const amount = z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000).nullable();

const measureLine = z.object({
  id,
  kind: z.literal("measure"),
  label: str(300),
  no: amount,
  length: amount,
  width: amount,
  height: amount,
  qty: amount,
});
const textLine = z.object({ id, kind: z.literal("text"), text: str(2000) });
const line = z.discriminatedUnion("kind", [measureLine, textLine]);

const part = z.object({ id, code: str(40), description: str(4000), unit: str(20), rate: amount, lines: z.array(line).max(LIMITS.lines) });
const item = z.object({ id, kind: z.literal("item"), code: str(40), description: str(4000), parts: z.array(part).min(1).max(LIMITS.parts) });
const label = z.object({ id, kind: z.literal("label"), text: str(300) });
const entry = z.discriminatedUnion("kind", [item, label]);
const section = z.object({ id, code: str(40), title: str(300), entries: z.array(entry).max(LIMITS.entries) });
const sheet = z.object({ id, name: str(200), title: str(300), sections: z.array(section).max(LIMITS.sections) });
const adjustment = z.object({ id, label: str(200), percent: z.number().finite().min(-100).max(100), effect: z.enum(["deduct", "add"]) });

/** A logo is a small embedded PNG, JPG or WebP image. Never SVG: an SVG file can carry scripts. */
const logo = z
  .string()
  .max(400_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/, "The logo must be a PNG, JPG or WebP image")
  .nullable();

export const documentSchema = z
  .object({
    company: z.object({ name: str(200), address: str(500), phone: str(40), email: str(200), gstin: str(30) }),
    logo,
    showCompanyHeader: z.boolean().optional(),
    title: str(300),
    subtitle: str(300),
    rateBasis: str(300),
    boqNumber: str(60),
    date: z.union([z.literal(""), z.iso.date()]),
    sheets: z.array(sheet).min(1).max(LIMITS.sheets),
    adjustments: z.array(adjustment).max(20),
    signatures: z.object({ leftLabel: str(100), leftName: str(200), rightLabel: str(100), rightName: str(200) }),
  })
  .refine(
    (doc) =>
      doc.sheets.reduce(
        (n, sh) => n + sh.sections.reduce((m, s) => m + s.entries.reduce((k, e) => k + (e.kind === "item" ? e.parts.reduce((j, p) => j + p.lines.length, 0) : 0), 0), 0),
        0
      ) <= LIMITS.totalLines,
    { message: `A BOQ can have at most ${LIMITS.totalLines} rows` }
  );

const projectId = z.string().min(1).max(64).nullable();

export const createBoqSchema = z.object({ body: z.object({ document: documentSchema, projectId: projectId.default(null) }) });

/** Which project the BOQ belongs to (null: none). Its items reach the project's materials on the next sync. */
export const setProjectSchema = z.object({ body: z.object({ projectId }) });

export const saveBoqSchema = z.object({
  body: z.object({ document: documentSchema, version: z.number().int().min(1), status: z.enum(["DRAFT", "FINAL"]) }),
});

/** req.query is read-only in Express 5, so the controller parses it directly */
export const listQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["DRAFT", "FINAL"]).optional(),
  projectId: z.string().min(1).max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export type BoqDocumentInput = z.infer<typeof documentSchema>;
export type SaveBody = z.infer<typeof saveBoqSchema>["body"];
export type ListQuery = z.infer<typeof listQuerySchema>;
