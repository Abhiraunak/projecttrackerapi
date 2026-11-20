/**
 * Phase 6: where equipment is, worked out from its moves. Pure functions: no database, so they are tested on their own.
 *
 * A move is one of:
 *   add        bought or hired in: the quantity appears at `to` (the yard, or straight at a site)
 *   move       from one place to another: the yard ⇄ a site, or site to site
 *   write_off  gone for good from `from`: lost, scrapped, or handed back to the hirer
 * A place is a project id, or null for the yard (the company's store).
 */

export type MoveKind = "add" | "move" | "write_off";
export const YARD = ""; // the yard's key in maps (project ids are never empty)

export interface Move {
  id?: string;
  kind: MoveKind;
  from: string | null;
  to: string | null;
  qty: number;
  date: string; // YYYY-MM-DD
  /** Same-day moves are taken in the order they were entered */
  seq?: number;
  condition?: string;
}

export const placeKey = (p: string | null | undefined) => p ?? YARD;
const round = (n: number) => Math.round(n * 100) / 100;
const dayNo = (ymd: string) => Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86_400_000);

export const inOrder = <M extends Move>(moves: readonly M[]): M[] =>
  [...moves].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq ?? 0) - (b.seq ?? 0)));

/** What one move does to each place: +qty arriving, −qty leaving */
function effects(m: Move): [string, number][] {
  if (m.kind === "add") return [[placeKey(m.to), m.qty]];
  if (m.kind === "write_off") return [[placeKey(m.from), -m.qty]];
  return [
    [placeKey(m.from), -m.qty],
    [placeKey(m.to), m.qty],
  ];
}

/** How many are at each place now (or at the end of `upTo`). Places with none are left out. */
export function stockByPlace(moves: readonly Move[], upTo?: string): Map<string, number> {
  const at = new Map<string, number>();
  for (const m of inOrder(moves)) {
    if (upTo && m.date > upTo) break;
    for (const [place, d] of effects(m)) at.set(place, round((at.get(place) ?? 0) + d));
  }
  for (const [place, q] of at) if (q <= 0) at.delete(place);
  return at;
}

export const totalOf = (at: Map<string, number>) => round([...at.values()].reduce((s, q) => s + q, 0));

export interface Shortfall {
  date: string;
  place: string; // YARD or a project id
  available: number; // how many were there just before
  wanted: number;
}

/**
 * The first point in the history where more left a place than was there. Checked with a new move added,
 * so a back-dated move can't make the past impossible (sending 10 plates on Monday that only arrived on Friday).
 */
export function firstShortfall(moves: readonly Move[]): Shortfall | null {
  const at = new Map<string, number>();
  for (const m of inOrder(moves)) {
    for (const [place, d] of effects(m)) {
      const before = at.get(place) ?? 0;
      const after = round(before + d);
      if (after < 0) return { date: m.date, place, available: before, wanted: m.qty };
      at.set(place, after);
    }
  }
  return null;
}

/** What's wrong with a new move, in plain words (place names come from `name`), or null if it's fine */
export function checkMove(moves: readonly Move[], m: Move, today: string, name: (place: string) => string, unit: string): string | null {
  if (!(m.qty > 0)) return "Enter a quantity above zero.";
  if (m.date > today) return "The date can't be in the future.";
  if (m.kind === "move" && placeKey(m.from) === placeKey(m.to)) return "Pick a different place to move it to.";
  const short = firstShortfall([...moves, { ...m, seq: Number.MAX_SAFE_INTEGER }]);
  if (!short) return null;
  const left = `${trimQty(short.available)} ${unit}`;
  return short.date === m.date && short.wanted === m.qty
    ? `Only ${left} at ${name(short.place)} on ${short.date}.`
    : `That would leave ${name(short.place)} short on ${short.date}: a later move takes more than would be there.`;
}

export const trimQty = (q: number) => String(round(q));

/**
 * The day the current stay at a place began: the last time the place went from none to some.
 * Null when there's none there now.
 */
export function onSiteSince(moves: readonly Move[], place: string | null): string | null {
  const key = placeKey(place);
  let qty = 0;
  let since: string | null = null;
  for (const m of inOrder(moves)) {
    for (const [p, d] of effects(m)) {
      if (p !== key) continue;
      const before = qty;
      qty = round(qty + d);
      if (before <= 0 && qty > 0) since = m.date;
      if (qty <= 0) since = null;
    }
  }
  return qty > 0 ? since : null;
}

/** The condition the latest arrival at a place was noted in */
export function lastCondition(moves: readonly Move[], place: string | null): string | null {
  const key = placeKey(place);
  const arrivals = inOrder(moves).filter((m) => m.kind !== "write_off" && placeKey(m.to) === key);
  const latest = arrivals[arrivals.length - 1]; // undefined when nothing has arrived there
  return latest?.condition ?? null;
}

export interface HireTerms {
  ownership: "owned" | "hired";
  rate: number | null; // per unit, per day or per month: the rate it was hired at
  per: "day" | "month";
  /** Rate changes: from `from` on, the rate is `rate` (same unit and period). Any order. */
  rates?: { from: string; rate: number }[];
  /** One-off amounts (+ extra, − credit) on a date, charged to a place (a project id) */
  amounts?: { date: string; place: string; amount: number }[];
}

/** The rate in force on a day: the latest change on or before it, else the rate it was hired at */
export function rateOn(terms: HireTerms, ymd: string): number | null {
  let best: { from: string; rate: number } | null = null;
  for (const r of terms.rates ?? []) if (r.from <= ymd && (!best || r.from >= best.from)) best = r;
  return best ? best.rate : terms.rate;
}

export interface PlaceUse {
  /** Unit-days: 10 plates for 3 days is 30 */
  unitDays: number;
  /** Hire charges for those days (hired items only; 0 for owned) */
  charge: number;
}

/**
 * Unit-days at each place, and the hire charges they cost, within an optional date range.
 * A piece counts from the day it arrives up to the day before it leaves; one still there counts up to and including
 * `today`. A month's rate is spread over 30 days, as hire firms usually bill. Each day is charged at the rate in
 * force that day (rate changes), and one-off amounts dated inside the range are added to their place.
 */
export function useByPlace(moves: readonly Move[], terms: HireTerms, today: string, range?: { from?: string; to?: string }): Map<string, PlaceUse> {
  const lo = range?.from ? dayNo(range.from) : -Infinity;
  const hi = (range?.to ? Math.min(dayNo(range.to), dayNo(today)) : dayNo(today)) + 1; // exclusive
  const hired = terms.ownership === "hired";
  const perDay = (rate: number | null) => (hired && rate ? (terms.per === "month" ? rate / 30 : rate) : 0);
  // The rate's steps as day numbers: [day it starts, rate per day], oldest first
  const steps = [...(terms.rates ?? [])]
    .map((r) => ({ day: dayNo(r.from), perDay: perDay(r.rate) }))
    .sort((a, b) => a.day - b.day);
  const basePerDay = perDay(terms.rate);
  /** Rupees for one unit over the days [a, b): split wherever the rate changes */
  const costOver = (a: number, b: number) => {
    let total = 0;
    let at = a;
    let rate = basePerDay;
    for (const s of steps) {
      if (s.day <= at) {
        rate = s.perDay;
        continue;
      }
      if (s.day >= b) break;
      total += (s.day - at) * rate;
      at = s.day;
      rate = s.perDay;
    }
    return total + (b - at) * rate;
  };

  const qty = new Map<string, number>();
  const since = new Map<string, number>(); // the day the current quantity began
  const use = new Map<string, number>();
  const charge = new Map<string, number>();
  const count = (place: string, until: number) => {
    const q = qty.get(place) ?? 0;
    const from = since.get(place);
    if (q > 0 && from !== undefined) {
      const a = Math.max(from, lo);
      const b = Math.min(until, hi);
      if (b > a) {
        use.set(place, (use.get(place) ?? 0) + q * (b - a));
        charge.set(place, (charge.get(place) ?? 0) + q * costOver(a, b));
      }
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
  for (const place of qty.keys()) count(place, hi);

  // One-off amounts (hired items only), dated inside the range
  if (hired)
    for (const x of terms.amounts ?? []) {
      const d = dayNo(x.date);
      if (d >= lo && d < hi) charge.set(x.place, (charge.get(x.place) ?? 0) + x.amount);
    }

  const out = new Map<string, PlaceUse>();
  for (const place of new Set([...use.keys(), ...charge.keys()])) out.set(place, { unitDays: round(use.get(place) ?? 0), charge: round(charge.get(place) ?? 0) });
  return out;
}

/* ------------------------------------------- categories ------------------------------------------- */

export const CATEGORIES = [
  { key: "shuttering", label: "Shuttering" },
  { key: "scaffolding", label: "Scaffolding" },
  { key: "machinery", label: "Machinery" },
  { key: "tools", label: "Tools" },
  { key: "other", label: "Other" },
] as const;
export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key) as [CategoryKey, ...CategoryKey[]];