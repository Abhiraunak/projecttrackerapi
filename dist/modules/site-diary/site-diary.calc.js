/**
 * Site diary rules with no database in them: which days a report may still be sent or changed, where the phone was
 * against the site, and the attendance a team's day becomes.
 */
import { dayKeyIn, distanceMetres, isOutside } from "../punches/punch.calc.js";
/** "2026-11-15" → "2026-11-14" */
export const dayBefore = (day) => {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
};
/**
 * A report is for today, or for yesterday (a report filled without signal is sent the next morning). Older days are
 * locked. Days ahead are refused too.
 */
export function canWriteDay(day, now) {
    const today = dayKeyIn(now);
    return day === today || day === dayBefore(today);
}
/** How far from the site, and whether that is outside it. Nothing to say when either location is missing. */
export function placeAgainstSite(fix, site) {
    if (!fix || site.lat === null || site.lng === null)
        return { distanceM: null, outsideSite: false };
    const distanceM = Math.round(distanceMetres(fix.lat, fix.lng, site.lat, site.lng));
    return { distanceM, outsideSite: isOutside(distanceM, site.radiusM, fix.accuracy) };
}
export function placeBadge(r, siteSet) {
    if (r.lat === null)
        return { kind: "none", label: "No location" };
    if (!siteSet || r.distanceM === null)
        return { kind: "unset", label: "Site not set" };
    const far = r.distanceM >= 1000 ? `${Math.round(r.distanceM / 100) / 10} km` : `${r.distanceM} m`;
    return r.outsideSite ? { kind: "off", label: `${far} away` } : { kind: "on", label: `On site · ${far}` };
}
/**
 * A team's day as attendance: one line per person, "Mistri 1" … "Labour 1" …, each at the rate the manager gave,
 * plus overtime as extras (hours × OT rate × people). Rounded to paise.
 */
export function teamAttendance(t, rates) {
    const workers = [
        ...Array.from({ length: t.mistri }, (_, i) => ({ label: `Mistri ${i + 1}`, amount: rates.mistriRate })),
        ...Array.from({ length: t.labour }, (_, i) => ({ label: `Labour ${i + 1}`, amount: rates.labourRate })),
    ];
    const extras = Math.round(t.otHours * rates.otRate * (t.mistri + t.labour) * 100) / 100;
    const total = Math.round((workers.reduce((s, w) => s + w.amount, 0) + extras) * 100) / 100;
    return { workers, extras, total };
}
/** quantity × rate, to paise */
export const amountOf = (quantity, rate) => Math.round(quantity * rate * 100) / 100;
//# sourceMappingURL=site-diary.calc.js.map