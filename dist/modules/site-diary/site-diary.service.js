import { prisma } from "../../lib/prisma.js";
import { HttpError } from "../../lib/error.js";
import { requireCan, requirePermission } from "../../lib/projectAccess.js";
import { deleteDrawingFile, drawingUrls, uploadDrawingFile } from "../../lib/cloudinary.js";
import { detectFileType } from "../../lib/fileType.js";
import { toDate, toDay } from "../../lib/dates.js";
import { MAX_IMAGE_BYTES } from "../../middleware/uploadImage.js";
import { logger } from "../../config/logger.js";
import { recordAudit } from "../audit/audit.service.js";
import { assertWeeksOpen } from "../labour-weeks/labour-weeks.service.js";
import { amountOf, canWriteDay, placeAgainstSite, placeBadge, teamAttendance } from "./site-diary.calc.js";
/*
 * Two kinds of people use this:
 *  - the site engineer ("diary.write"): fills today's report on their phone. They are never sent the site's
 *    location, nor how far they were from it, so there is nothing to work the site out from.
 *  - the manager ("diary.review"): reads the reports with where each was made, sets the site's location, adds a
 *    team's day to Labour attendance, and adds the rate of material that arrived.
 */
const MAX_PHOTOS = 8;
const num = (v) => (v === null || v === undefined ? 0 : typeof v === "number" ? v : v.toNumber());
const tooLate = () => new HttpError(409, "That day's report is locked. Reports can be sent or changed on the day, or the day after.");
const photoUrls = (p) => {
    const u = drawingUrls({ publicId: p.publicId, version: p.version, format: p.format, kind: "image" });
    return { thumbnailUrl: u.thumbnailUrl, imageUrl: u.imageUrl, openUrl: u.openUrl };
};
/* ------------------------------------------------ engineer ------------------------------------------------ */
/** The projects to pick from: ongoing ones, by name. No site locations. */
export async function engineerProjects(userId) {
    await requireCan(userId, "diary.write");
    const rows = await prisma.project.findMany({ where: { status: "ONGOING" }, select: { id: true, title: true, firmName: true }, orderBy: { updatedAt: "desc" } });
    return rows;
}
/** What to tap rather than type on one project: its teams (contractors) and its materials */
export async function engineerSetup(userId, projectId) {
    await requirePermission(userId, projectId, "diary.write");
    const [attendanceNames, teamNames, reportNames, materials] = await Promise.all([
        prisma.attendance.findMany({ where: { projectId }, select: { contractorName: true }, distinct: ["contractorName"], orderBy: { date: "desc" }, take: 40 }),
        prisma.labourTeamMember.findMany({ where: { projectId, active: true }, select: { contractorName: true }, distinct: ["contractorName"] }),
        prisma.siteReportTeam.findMany({ where: { report: { projectId } }, select: { contractorName: true }, distinct: ["contractorName"], take: 40 }),
        prisma.materialPurchase.findMany({ where: { projectId }, select: { id: true, name: true, unit: true, section: true }, orderBy: [{ section: "asc" }, { name: "asc" }] }),
    ]);
    const seen = new Map();
    for (const r of [...reportNames, ...attendanceNames, ...teamNames]) {
        const name = r.contractorName.trim().replace(/\s+/g, " ");
        if (name && !seen.has(name.toLowerCase()))
            seen.set(name.toLowerCase(), name);
    }
    return { teams: [...seen.values()], materials };
}
const reportInclude = {
    teams: { orderBy: { position: "asc" } },
    arrivals: { orderBy: { position: "asc" }, include: { photos: { orderBy: { takenAt: "asc" } }, delivery: { select: { id: true, rate: true, amount: true, ratePending: true } } } },
    engineer: { select: { name: true, email: true } },
    project: { select: { title: true, siteLat: true, siteLng: true, siteRadiusM: true } },
};
const teamDto = (t) => ({
    id: t.id,
    contractorName: t.contractorName,
    mistri: t.mistri,
    labour: t.labour,
    inTime: t.inTime,
    outTime: t.outTime,
    present: t.present,
    otHours: num(t.otHours),
    workDone: t.workDone,
    materialUsed: t.materialUsed,
    remarks: t.remarks,
    inAttendance: t.attendanceId !== null,
});
/** What the engineer gets back: their own report, without any distance or site */
function engineerDto(r) {
    return {
        id: r.id,
        projectId: r.projectId,
        date: toDay(r.date),
        note: r.note,
        submittedAt: r.submittedAt.toISOString(),
        hasLocation: r.lat !== null,
        teamsLocked: r.teams.some((t) => t.attendanceId !== null),
        teams: r.teams.map(teamDto),
        arrivals: r.arrivals.map((a) => ({
            id: a.id,
            clientKey: a.clientKey,
            purchaseId: a.purchaseId,
            name: a.name,
            quantity: num(a.quantity),
            unit: a.unit,
            note: a.note,
            locked: !!a.delivery && !a.delivery.ratePending, // priced by the manager: no more changes
            photos: a.photos.map((p) => ({ clientKey: p.clientKey, takenAt: p.takenAt.toISOString(), ...photoUrls(p) })),
        })),
        canChange: canWriteDay(toDay(r.date), new Date()),
    };
}
/** The engineer's report for a day, to carry on with it on another phone (null when there is none yet) */
export async function myReport(userId, projectId, day) {
    await requirePermission(userId, projectId, "diary.write");
    const r = await prisma.siteReport.findUnique({ where: { projectId_date_engineerId: { projectId, date: toDate(day), engineerId: userId } }, include: reportInclude });
    return r ? engineerDto(r) : null;
}
/**
 * Saves the report as sent: new, or the same day's report sent again with changes. Material that arrived and is in
 * the project's list becomes a delivery in Materials with its rate pending. A team already added to attendance, or
 * material already priced by the manager, stays as it is.
 */
export async function saveReport(userId, body) {
    const { project } = await requirePermission(userId, body.projectId, "diary.write");
    if (!canWriteDay(body.date, new Date()))
        throw tooLate();
    const purchaseIds = [...new Set(body.arrivals.map((a) => a.purchaseId).filter((v) => !!v))];
    if (purchaseIds.length) {
        const found = await prisma.materialPurchase.count({ where: { id: { in: purchaseIds }, projectId: project.id } });
        if (found !== purchaseIds.length)
            throw new HttpError(400, "One of the materials isn't on this project. Pick it again.");
    }
    const keys = body.arrivals.map((a) => a.clientKey);
    if (new Set(keys).size !== keys.length)
        throw new HttpError(400, "The same material entry was sent twice. Open the report again.");
    const site = await prisma.project.findUnique({ where: { id: project.id }, select: { title: true, siteLat: true, siteLng: true, siteRadiusM: true } });
    const fix = body.location ? { lat: body.location.lat, lng: body.location.lng, accuracy: body.location.accuracy } : null;
    const place = placeAgainstSite(fix, { lat: site.siteLat, lng: site.siteLng, radiusM: site.siteRadiusM });
    const date = toDate(body.date);
    const filesToDelete = [];
    const saved = await prisma.$transaction(async (tx) => {
        const existing = await tx.siteReport.findUnique({
            where: { projectId_date_engineerId: { projectId: project.id, date, engineerId: userId } },
            include: { teams: true, arrivals: { include: { photos: true, delivery: true } } },
        });
        const head = { note: body.note, lat: fix?.lat ?? null, lng: fix?.lng ?? null, accuracyM: fix?.accuracy ?? null, ...place, submittedAt: new Date() };
        const report = existing
            ? await tx.siteReport.update({ where: { id: existing.id }, data: head })
            : await tx.siteReport.create({ data: { projectId: project.id, date, engineerId: userId, ...head } });
        // Teams: replaced, unless the manager has already added one of them to attendance
        if (!existing?.teams.some((t) => t.attendanceId !== null)) {
            await tx.siteReportTeam.deleteMany({ where: { reportId: report.id } });
            if (body.teams.length)
                await tx.siteReportTeam.createMany({
                    data: body.teams.map((t, i) => ({ reportId: report.id, ...t, otHours: t.otHours, position: i })),
                });
        }
        // Material arrived: matched by the phone's key, so sending again changes rather than adds
        const before = new Map((existing?.arrivals ?? []).map((a) => [a.clientKey, a]));
        for (const [i, a] of body.arrivals.entries()) {
            const old = before.get(a.clientKey);
            before.delete(a.clientKey);
            if (old?.delivery && !old.delivery.ratePending)
                continue; // priced: locked
            const row = old
                ? await tx.siteReportArrival.update({
                    where: { id: old.id },
                    data: { purchaseId: a.purchaseId, name: a.name, quantity: a.quantity, unit: a.unit, note: a.note, position: i },
                })
                : await tx.siteReportArrival.create({
                    data: { reportId: report.id, clientKey: a.clientKey, purchaseId: a.purchaseId, name: a.name, quantity: a.quantity, unit: a.unit, note: a.note, position: i },
                });
            // Its delivery in Materials (rate pending): made, moved, or taken away
            if (a.purchaseId) {
                if (old?.delivery) {
                    await tx.materialDelivery.update({ where: { id: old.delivery.id }, data: { purchaseId: a.purchaseId, quantity: a.quantity, date } });
                }
                else {
                    const d = await tx.materialDelivery.create({
                        data: { purchaseId: a.purchaseId, projectId: project.id, date, quantity: a.quantity, rate: 0, amount: 0, ratePending: true, addedById: userId },
                    });
                    await tx.siteReportArrival.update({ where: { id: row.id }, data: { deliveryId: d.id } });
                }
            }
            else if (old?.delivery) {
                await tx.materialDelivery.delete({ where: { id: old.delivery.id } });
            }
            // Photos taken out on the phone are removed here too
            const keep = new Set(a.photoKeys);
            const gone = (old?.photos ?? []).filter((p) => !keep.has(p.clientKey));
            if (gone.length) {
                await tx.siteReportPhoto.deleteMany({ where: { id: { in: gone.map((p) => p.id) } } });
                filesToDelete.push(...gone.map((p) => p.publicId));
            }
        }
        // Entries no longer on the report (unless priced)
        for (const old of before.values()) {
            if (old.delivery && !old.delivery.ratePending)
                continue;
            if (old.delivery)
                await tx.materialDelivery.delete({ where: { id: old.delivery.id } });
            filesToDelete.push(...old.photos.map((p) => p.publicId));
            await tx.siteReportArrival.delete({ where: { id: old.id } });
        }
        // await recordAudit(tx, {
        //     projectId: project.id,
        //     actorId: userId,
        //     action: existing ? "diary.updated" : "diary.submitted",
        //     entityType: "site_report",
        //     entityId: report.id,
        //     summary: `${existing ? "Changed" : "Sent"} the site diary for ${body.date}: ${body.teams.length} ${body.teams.length === 1 ? "team" : "teams"}, ${body.arrivals.length} material arrived`,
        // });
        return tx.siteReport.findUniqueOrThrow({ where: { id: report.id }, include: reportInclude });
    });
    for (const publicId of filesToDelete)
        void deleteDrawingFile(publicId, "image");
    return engineerDto(saved);
}
/** One photo of material that arrived, taken in the app's camera. Sending the same photo again does nothing. */
export async function addPhoto(userId, arrivalId, body, file) {
    const arrival = await prisma.siteReportArrival.findUnique({
        where: { id: arrivalId },
        include: { report: { include: { project: { select: { siteLat: true, siteLng: true, siteRadiusM: true } } } }, photos: { select: { clientKey: true } }, delivery: true },
    });
    // Someone else's report, or none: the same answer, so ids can't be probed
    if (!arrival || arrival.report.engineerId !== userId)
        throw new HttpError(404, "That entry wasn't found. Send the report again.");
    await requirePermission(userId, arrival.report.projectId, "diary.write");
    if (!canWriteDay(toDay(arrival.report.date), new Date()))
        throw tooLate();
    if (arrival.delivery && !arrival.delivery.ratePending)
        throw new HttpError(409, "The manager has already priced this delivery, so it can't change.");
    const already = await prisma.siteReportPhoto.findUnique({ where: { arrivalId_clientKey: { arrivalId, clientKey: body.clientKey } } });
    if (already)
        return { clientKey: already.clientKey, takenAt: already.takenAt.toISOString(), ...photoUrls(already) };
    if (arrival.photos.length >= MAX_PHOTOS)
        throw new HttpError(400, `Up to ${MAX_PHOTOS} photos for one entry.`);
    const detected = detectFileType(file.buffer);
    if (!detected || detected.kind !== "image")
        throw new HttpError(415, "The photo must be a picture (JPG, PNG or WebP).");
    if (file.size > MAX_IMAGE_BYTES)
        throw new HttpError(413, "The photo is larger than 10 MB.");
    const fix = body.lat !== undefined && body.lng !== undefined ? { lat: body.lat, lng: body.lng, accuracy: body.accuracy ?? null } : null;
    const { siteLat, siteLng, siteRadiusM } = arrival.report.project;
    const place = placeAgainstSite(fix, { lat: siteLat, lng: siteLng, radiusM: siteRadiusM });
    // The phone's clock decides takenAt, but never later than now
    const takenAt = new Date(Math.min(new Date(body.takenAt).getTime(), Date.now()));
    const stored = await uploadDrawingFile(file.buffer, detected);
    try {
        const p = await prisma.siteReportPhoto.create({
            data: {
                arrivalId,
                clientKey: body.clientKey,
                publicId: stored.publicId,
                version: stored.version,
                format: stored.format,
                takenAt,
                lat: fix?.lat ?? null,
                lng: fix?.lng ?? null,
                accuracyM: fix?.accuracy ?? null,
                ...place,
            },
        });
        return { clientKey: p.clientKey, takenAt: p.takenAt.toISOString(), ...photoUrls(p) };
    }
    catch (err) {
        await deleteDrawingFile(stored.publicId, "image"); // the row didn't save: don't leave the file behind
        const dup = await prisma.siteReportPhoto.findUnique({ where: { arrivalId_clientKey: { arrivalId, clientKey: body.clientKey } } });
        if (dup)
            return { clientKey: dup.clientKey, takenAt: dup.takenAt.toISOString(), ...photoUrls(dup) }; // sent twice at once
        logger.error({ err }, "site diary photo not saved");
        throw err;
    }
}
/* ------------------------------------------------ manager ------------------------------------------------ */
const siteIsSet = (p) => p.siteLat !== null && p.siteLng !== null;
/** A month of reports for the list: who, which day, how much, and where it was made */
export async function listReports(userId, projectId, month) {
    await requirePermission(userId, projectId, "diary.review");
    const [y, m] = month.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 1));
    const [project, rows] = await Promise.all([
        prisma.project.findUnique({ where: { id: projectId }, select: { siteLat: true, siteLng: true } }),
        prisma.siteReport.findMany({
            where: { projectId, date: { gte: from, lt: to } },
            orderBy: [{ date: "desc" }, { submittedAt: "desc" }],
            include: reportInclude,
        }),
    ]);
    const siteSet = !!project && siteIsSet(project);
    return {
        siteSet,
        reports: rows.map((r) => managerDto(r, siteSet)),
    };
}
function managerDto(r, siteSet) {
    return {
        id: r.id,
        date: toDay(r.date),
        engineer: r.engineer.name || r.engineer.email,
        submittedAt: r.submittedAt.toISOString(),
        note: r.note,
        place: placeBadge({ lat: r.lat, distanceM: r.distanceM, outsideSite: r.outsideSite }, siteSet),
        location: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng, accuracyM: r.accuracyM } : null,
        teams: r.teams.map(teamDto),
        arrivals: r.arrivals.map((a) => ({
            id: a.id,
            purchaseId: a.purchaseId,
            name: a.name,
            quantity: num(a.quantity),
            unit: a.unit,
            note: a.note,
            delivery: a.delivery ? { id: a.delivery.id, rate: num(a.delivery.rate), amount: num(a.delivery.amount), ratePending: a.delivery.ratePending } : null,
            photos: a.photos.map((p) => ({
                id: p.id,
                takenAt: p.takenAt.toISOString(),
                place: placeBadge({ lat: p.lat, distanceM: p.distanceM, outsideSite: p.outsideSite }, siteSet),
                ...photoUrls(p),
            })),
        })),
        people: r.teams.filter((t) => t.present).reduce((s, t) => s + t.mistri + t.labour, 0),
        toAttendance: r.teams.filter((t) => t.present && t.attendanceId === null).length,
        ratesPending: r.arrivals.filter((a) => !a.delivery || a.delivery.ratePending).length,
    };
}
export async function getReport(userId, reportId) {
    const r = await prisma.siteReport.findUnique({ where: { id: reportId }, include: reportInclude });
    if (!r)
        throw new HttpError(404, "Report not found");
    await requirePermission(userId, r.projectId, "diary.review");
    return managerDto(r, siteIsSet(r.project));
}
/** The site's location for the manager's settings (never for the engineer) */
export async function getSite(userId, projectId) {
    await requirePermission(userId, projectId, "diary.review");
    const p = await prisma.project.findUnique({ where: { id: projectId }, select: { siteLat: true, siteLng: true, siteRadiusM: true } });
    return p && siteIsSet(p) ? { lat: p.siteLat, lng: p.siteLng, radiusM: p.siteRadiusM } : null;
}
/** Sets (or clears, with null) the site's location and how far from it still counts as on site */
export async function setSite(userId, projectId, body) {
    const { project } = await requirePermission(userId, projectId, "diary.review");
    await prisma.$transaction(async (tx) => {
        await tx.project.update({
            where: { id: project.id },
            data: body.location ? { siteLat: body.location.lat, siteLng: body.location.lng, siteRadiusM: body.location.radiusM } : { siteLat: null, siteLng: null },
        });
        await recordAudit(tx, {
            projectId: project.id,
            actorId: userId,
            action: "diary.site_set",
            entityType: "project",
            summary: body.location ? `Set the site location (within ${body.location.radiusM} m counts as on site)` : "Cleared the site location",
        });
    });
    return getSite(userId, projectId);
}
/**
 * A team's day from the diary into Labour attendance, at the rates the manager gives: one line per person, overtime
 * as extras. Refused for an absent team, one already added, or a settled pay week.
 */
export async function teamToAttendance(userId, teamId, body) {
    const team = await prisma.siteReportTeam.findUnique({ where: { id: teamId }, include: { report: { select: { id: true, projectId: true, date: true } } } });
    if (!team)
        throw new HttpError(404, "Team not found");
    await requirePermission(userId, team.report.projectId, "diary.review");
    await requirePermission(userId, team.report.projectId, "attendance.write");
    if (team.attendanceId)
        throw new HttpError(409, "This team's day is already in attendance.");
    if (!team.present)
        throw new HttpError(400, "The team was marked absent that day.");
    if (team.mistri + team.labour === 0)
        throw new HttpError(400, "The team has nobody on it that day.");
    const day = toDay(team.report.date);
    await assertWeeksOpen(team.report.projectId, "", team.contractorName, [day]);
    const { workers, extras, total } = teamAttendance({ mistri: team.mistri, labour: team.labour, otHours: num(team.otHours) }, body);
    const notes = [`From the site diary${team.inTime && team.outTime ? ` (${team.inTime}–${team.outTime})` : ""}`, team.workDone].filter(Boolean).join(": ").slice(0, 500);
    return prisma.$transaction(async (tx) => {
        // Claimed first, so two clicks can't add it twice
        const claimed = await tx.siteReportTeam.updateMany({ where: { id: team.id, attendanceId: null }, data: { attendanceId: "pending" } });
        if (claimed.count === 0)
            throw new HttpError(409, "This team's day is already in attendance.");
        const created = await tx.attendance.create({
            data: {
                ownerId: userId,
                projectId: team.report.projectId,
                contractorName: team.contractorName,
                trade: "",
                date: team.report.date,
                extras,
                notes,
                payMode: "amount",
                totalAmount: total,
                workers: { create: workers.map((w, i) => ({ label: w.label, amount: w.amount, position: i })) },
            },
        });
        await tx.siteReportTeam.update({ where: { id: team.id }, data: { attendanceId: created.id } });
        await recordAudit(tx, {
            projectId: team.report.projectId,
            actorId: userId,
            action: "diary.to_attendance",
            entityType: "attendance",
            entityId: created.id,
            summary: `Added ${team.contractorName}'s day (${day}) from the site diary to attendance: ₹${total.toLocaleString("en-IN")}`,
        });
        return { attendanceId: created.id, total };
    });
}
/**
 * The rate of material that arrived: its delivery in Materials gets quantity × rate and counts as spending. An entry
 * that wasn't in the list yet is linked to one of the project's materials here, which makes its delivery.
 */
export async function priceArrival(userId, arrivalId, rate, purchaseId) {
    const a = await prisma.siteReportArrival.findUnique({ where: { id: arrivalId }, include: { report: { select: { projectId: true, date: true } }, delivery: true } });
    if (!a)
        throw new HttpError(404, "Entry not found");
    await requirePermission(userId, a.report.projectId, "diary.review");
    if (a.delivery && !a.delivery.ratePending)
        throw new HttpError(409, "This delivery already has its rate. Change it in Materials.");
    const linkTo = a.purchaseId ?? purchaseId;
    if (!linkTo)
        throw new HttpError(400, "Pick which material this is first.");
    if (!a.purchaseId) {
        const ok = await prisma.materialPurchase.count({ where: { id: linkTo, projectId: a.report.projectId } });
        if (!ok)
            throw new HttpError(400, "That material isn't on this project.");
    }
    const quantity = num(a.quantity);
    const amount = amountOf(quantity, rate);
    return prisma.$transaction(async (tx) => {
        if (a.delivery) {
            await tx.materialDelivery.update({ where: { id: a.delivery.id }, data: { rate, amount, ratePending: false } });
        }
        else {
            const d = await tx.materialDelivery.create({
                data: { purchaseId: linkTo, projectId: a.report.projectId, date: a.report.date, quantity, rate, amount, ratePending: false, addedById: userId },
            });
            await tx.siteReportArrival.update({ where: { id: a.id }, data: { deliveryId: d.id, purchaseId: linkTo } });
        }
        // await recordAudit(tx, {
        //     projectId: a.report.projectId,
        //     actorId: userId,
        //     action: "diary.priced",
        //     entityType: "material_delivery",
        //     entityId: a.id,
        //     summary: `Priced ${quantity} ${a.unit} ${a.name} from the site diary at ₹${rate.toLocaleString("en-IN")}: ₹${amount.toLocaleString("en-IN")}`,
        // });
        return { amount };
    });
}
//# sourceMappingURL=site-diary.service.js.map