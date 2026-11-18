import { z } from "zod";
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-15");
const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const text = (max) => z.string().trim().max(max).default("");
const time = z.union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:00")]).default("");
const team = z.object({
    contractorName: z.string().trim().min(1, "Enter the team or contractor").max(120),
    mistri: z.number().int().min(0).max(500).default(0),
    labour: z.number().int().min(0).max(500).default(0),
    inTime: time,
    outTime: time,
    present: z.boolean().default(true),
    otHours: z.number().min(0).max(24).default(0),
    workDone: text(2000),
    materialUsed: text(1000),
    remarks: text(500),
});
const arrival = z.object({
    clientKey: id, // made by the phone; a resend updates rather than adds
    purchaseId: id.nullable().default(null), // one of the project's materials, or null for one not listed yet
    name: z.string().trim().min(1, "Name the material").max(120),
    quantity: z.number().positive("Enter how much arrived").max(1e9),
    unit: text(20),
    note: text(300),
    photoKeys: z.array(id).max(8).default([]), // the photos it should have; any other already sent is removed
});
const location = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000).nullable().default(null) });
/** PUT /site-diary/reports: the whole report, sent on submit (again if changed the same day) */
export const reportSchema = z.object({
    body: z.object({
        projectId: id,
        date: day,
        note: text(2000),
        teams: z.array(team).max(30).default([]),
        arrivals: z.array(arrival).max(30).default([]),
        location: location.nullable().default(null),
    }),
});
// A multipart form sends every value as text: empty text means "not given"
const optionalNumber = (min, max) => z.preprocess((v) => (v === "" || v === undefined || v === null ? undefined : v), z.coerce.number().min(min).max(max).optional());
/** POST /site-diary/arrivals/:arrivalId/photos: one photo (multipart, the file in "file") */
export const photoSchema = z.object({
    body: z
        .object({
        clientKey: id,
        takenAt: z.string().datetime({ offset: true }),
        lat: optionalNumber(-90, 90),
        lng: optionalNumber(-180, 180),
        accuracy: optionalNumber(0, 100_000),
    })
        .refine((b) => (b.lat === undefined) === (b.lng === undefined), "Send both latitude and longitude, or neither"),
});
export const mineQuery = z.object({ projectId: id, date: day });
export const listQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "Use a month like 2026-11") });
export const siteSchema = z.object({
    body: z.object({
        location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radiusM: z.number().int().min(25).max(5000).default(200) }).nullable(),
    }),
});
export const toAttendanceSchema = z.object({
    body: z.object({
        mistriRate: z.number().min(0).max(1e6),
        labourRate: z.number().min(0).max(1e6),
        otRate: z.number().min(0).max(1e5).default(0), // per hour, per person
    }),
});
export const rateSchema = z.object({
    body: z.object({
        rate: z.number().positive("Enter the rate").max(1e9),
        purchaseId: id.nullable().default(null), // which material it is, when it wasn't picked on site
    }),
});
//# sourceMappingURL=site-diary.schema.js.map