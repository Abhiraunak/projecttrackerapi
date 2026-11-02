/**
 * Staff attendance rules, with no database in them: what the next punch should be, hours worked in a day,
 * the company's day boundaries, plus codes and distance from site.
 */
/* ------------------------------- the company's day ------------------------------- */
/** The company's time zone: days start at its midnight, not the server's */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";
/** "2026-10-29" for this instant, in the given time zone */
export function dayKeyIn(at, tz = APP_TIMEZONE) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
/** Minutes the zone is ahead of UTC at this instant (330 for India) */
function offsetMinutes(at, tz) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(at)
        .map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}
/** The instants a local day runs between: [from, to) */
export function dayRange(day, tz = APP_TIMEZONE) {
    const [y, m, d] = day.split("-").map(Number);
    const midnight = (yy, mm, dd) => {
        const guess = Date.UTC(yy, mm - 1, dd);
        return new Date(guess - offsetMinutes(new Date(guess), tz) * 60_000);
    };
    return { from: midnight(y, m, d), to: midnight(y, m, d + 1) };
}
/* ---------------------------------- the sequence ---------------------------------- */
/** In, then out, then in again (a lunch break is fine): the next punch is the opposite of the last one today */
export const nextPunch = (lastToday) => (lastToday === "IN" ? "OUT" : "IN");
/** A message when this punch is out of order, else null */
export function checkSequence(type, lastToday, fmtTime) {
    if (type === "IN" && lastToday?.type === "IN")
        return `You're already punched in since ${fmtTime(lastToday.at)}. Punch out first.`;
    if (type === "OUT" && lastToday?.type !== "IN")
        return "You haven't punched in today yet.";
    return null;
}
/** Pairs each in with the next out. `punches` oldest first, one person, one day. */
export function daySummary(punches, now, isToday) {
    let worked = 0;
    let openSince = null;
    for (const p of punches) {
        if (p.type === "IN" && !openSince)
            openSince = p.at;
        else if (p.type === "OUT" && openSince) {
            worked += p.at.getTime() - openSince.getTime();
            openSince = null;
        }
    }
    if (openSince && isToday)
        worked += Math.max(0, now.getTime() - openSince.getTime());
    const ins = punches.filter((p) => p.type === "IN");
    const outs = punches.filter((p) => p.type === "OUT");
    return {
        firstIn: ins[0]?.at.toISOString() ?? null,
        lastOut: outs.at(-1)?.at.toISOString() ?? null,
        workedMinutes: Math.round(worked / 60_000),
        open: openSince !== null,
        missedOut: openSince !== null && !isToday,
        outside: punches.filter((p) => p.outsideSite).length,
        noLocation: punches.filter((p) => p.lat === null).length,
    };
}
/* ---------------------------------- location ---------------------------------- */
/** Metres between two points on the earth (haversine) */
export function distanceMetres(lat1, lng1, lat2, lng2) {
    const R = 6_371_000;
    const rad = (d) => (d * Math.PI) / 180;
    const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
/**
 * Away from the site? The phone's own accuracy is given the benefit of the doubt (up to 100 m),
 * so a poor GPS fix on site isn't flagged.
 */
export const isOutside = (distance, radius, accuracy) => distance - Math.min(accuracy ?? 0, 100) > radius;
const ALPHABET = "23456789CFGHJMPQRVWX";
/**
 * The Open Location Code ("plus code") for a point, 10 digits: about a 14 m square, e.g. 7MMCJ53H+R4.
 * Google Maps understands it, so it doubles as an address where streets have no numbers.
 */
export function plusCode(lat, lng) {
    let la = Math.min(90, Math.max(-90, lat)) + 90;
    let lo = ((((lng + 180) % 360) + 360) % 360);
    if (la >= 180)
        la = 180 - 0.000125 / 2; // the north pole folds into the last row
    let code = "";
    let res = 20;
    for (let i = 0; i < 5; i++) {
        const dLa = Math.floor(la / res);
        const dLo = Math.floor(lo / res);
        la -= dLa * res;
        lo -= dLo * res;
        code += ALPHABET.charAt(dLa) + ALPHABET.charAt(dLo);
        res /= 20;
        if (i === 3)
            code += "+";
    }
    return code;
}
//# sourceMappingURL=punch.calc.js.map