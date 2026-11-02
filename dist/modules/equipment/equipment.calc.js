/**
 * Phase 6: where equipment is, worked out from its moves. Pure functions: no database, so they are tested on their own.
 *
 * A move is one of:
 *   add        bought or hired in: the quantity appears at `to` (the yard, or straight at a site)
 *   move       from one place to another: the yard ⇄ a site, or site to site
 *   write_off  gone for good from `from`: lost, scrapped, or handed back to the hirer
 * A place is a project id, or null for the yard (the company's store).
 */
export const YARD = ""; // the yard's key in maps (project ids are never empty)
export const placeKey = (p) => p ?? YARD;
const round = (n) => Math.round(n * 100) / 100;
const dayNo = (ymd) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86_400_000);
export const inOrder = (moves) => [...moves].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq ?? 0) - (b.seq ?? 0)));
/** What one move does to each place: +qty arriving, −qty leaving */
function effects(m) {
    if (m.kind === "add")
        return [[placeKey(m.to), m.qty]];
    if (m.kind === "write_off")
        return [[placeKey(m.from), -m.qty]];
    return [
        [placeKey(m.from), -m.qty],
        [placeKey(m.to), m.qty],
    ];
}
/** How many are at each place now (or at the end of `upTo`). Places with none are left out. */
export function stockByPlace(moves, upTo) {
    const at = new Map();
    for (const m of inOrder(moves)) {
        if (upTo && m.date > upTo)
            break;
        for (const [place, d] of effects(m))
            at.set(place, round((at.get(place) ?? 0) + d));
    }
    for (const [place, q] of at)
        if (q <= 0)
            at.delete(place);
    return at;
}
export const totalOf = (at) => round([...at.values()].reduce((s, q) => s + q, 0));
/**
 * The first point in the history where more left a place than was there. Checked with a new move added,
 * so a back-dated move can't make the past impossible (sending 10 plates on Monday that only arrived on Friday).
 */
export function firstShortfall(moves) {
    const at = new Map();
    for (const m of inOrder(moves)) {
        for (const [place, d] of effects(m)) {
            const before = at.get(place) ?? 0;
            const after = round(before + d);
            if (after < 0)
                return { date: m.date, place, available: before, wanted: m.qty };
            at.set(place, after);
        }
    }
    return null;
}
/** What's wrong with a new move, in plain words (place names come from `name`), or null if it's fine */
export function checkMove(moves, m, today, name, unit) {
    if (!(m.qty > 0))
        return "Enter a quantity above zero.";
    if (m.date > today)
        return "The date can't be in the future.";
    if (m.kind === "move" && placeKey(m.from) === placeKey(m.to))
        return "Pick a different place to move it to.";
    const short = firstShortfall([...moves, { ...m, seq: Number.MAX_SAFE_INTEGER }]);
    if (!short)
        return null;
    const left = `${trimQty(short.available)} ${unit}`;
    return short.date === m.date && short.wanted === m.qty
        ? `Only ${left} at ${name(short.place)} on ${short.date}.`
        : `That would leave ${name(short.place)} short on ${short.date}: a later move takes more than would be there.`;
}
export const trimQty = (q) => String(round(q));
/**
 * The day the current stay at a place began: the last time the place went from none to some.
 * Null when there's none there now.
 */
export function onSiteSince(moves, place) {
    const key = placeKey(place);
    let qty = 0;
    let since = null;
    for (const m of inOrder(moves)) {
        for (const [p, d] of effects(m)) {
            if (p !== key)
                continue;
            const before = qty;
            qty = round(qty + d);
            if (before <= 0 && qty > 0)
                since = m.date;
            if (qty <= 0)
                since = null;
        }
    }
    return qty > 0 ? since : null;
}
/** The condition the latest arrival at a place was noted in */
export function lastCondition(moves, place) {
    const key = placeKey(place);
    const arrivals = inOrder(moves).filter((m) => m.kind !== "write_off" && placeKey(m.to) === key);
    const latest = arrivals[arrivals.length - 1]; // undefined when nothing has arrived there
    return latest?.condition ?? null;
}
/**
 * Unit-days at each place, and the hire charges they cost, within an optional date range.
 * A piece counts from the day it arrives up to the day before it leaves; one still there counts up to and including
 * `today`. A month's rate is spread over 30 days, as hire firms usually bill.
 */
export function useByPlace(moves, terms, today, range) {
    const lo = range?.from ? dayNo(range.from) : -Infinity;
    const hi = (range?.to ? Math.min(dayNo(range.to), dayNo(today)) : dayNo(today)) + 1; // exclusive
    const perDay = terms.ownership === "hired" && terms.rate ? (terms.per === "month" ? terms.rate / 30 : terms.rate) : 0;
    const qty = new Map();
    const since = new Map(); // the day the current quantity began
    const use = new Map();
    const count = (place, until) => {
        const q = qty.get(place) ?? 0;
        const from = since.get(place);
        if (q > 0 && from !== undefined) {
            const days = Math.max(0, Math.min(until, hi) - Math.max(from, lo));
            if (days > 0)
                use.set(place, (use.get(place) ?? 0) + q * days);
        }
    };
    for (const m of inOrder(moves)) {
        const d = dayNo(m.date);
        for (const [place, delta] of effects(m)) {
            count(place, d);
            qty.set(place, round((qty.get(place) ?? 0) + delta));
            since.set(place, d);
        }
    }
    for (const place of qty.keys())
        count(place, hi);
    const out = new Map();
    for (const [place, unitDays] of use)
        out.set(place, { unitDays: round(unitDays), charge: round(unitDays * perDay) });
    return out;
}
/* ------------------------------------------- categories ------------------------------------------- */
export const CATEGORIES = [
    { key: "shuttering", label: "Shuttering" },
    { key: "scaffolding", label: "Scaffolding" },
    { key: "machinery", label: "Machinery" },
    { key: "tools", label: "Tools" },
    { key: "other", label: "Other" },
];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
//# sourceMappingURL=equipment.calc.js.map