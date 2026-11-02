/**
 * Attendance by trade (Civil, Tiles, Fabrication…), with no database in it, so it is unit-tested.
 * Each entry carries a trade; old entries have none ("") until someone sets it.
 */

/** Offered on the form before a project has trades of its own */
export const DEFAULT_TRADES = ["Civil", "Architecture", "Tiles", "Fabrication", "Plumbing", "Electrical", "Painting", "Carpentry"];

/** One spelling per trade: "  civil " typed when "Civil" exists becomes "Civil"; a new one is tidied and kept */
export function canonicalTrade(raw: string, known: string[]): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "";
  const match = known.find((k) => k.toLowerCase() === t.toLowerCase());
  return match ?? t.charAt(0).toUpperCase() + t.slice(1);
}

export interface TradeRow {
  trade: string;
  entries: number;
  total: number;
  lastDate: string | null;
}

export interface TradeSummary {
  trade: string; // "" = not set
  entries: number;
  total: number;
  week: number; // the last 7 days, today included
  month: number; // this calendar month
  lastDate: string | null;
  contractors: string[];
}

/**
 * Puts together the database's per-trade totals: all time, the last 7 days and this month, plus who works in each.
 * Biggest spend this month first; "not set" always last.
 */
export function tradeSummaries(all: TradeRow[], week: { trade: string; total: number }[], month: { trade: string; total: number }[], contractors: { trade: string; contractorName: string }[]): TradeSummary[] {
  const of = (list: { trade: string; total: number }[], t: string) => list.find((x) => x.trade === t)?.total ?? 0;
  return all
    .map((r) => ({
      trade: r.trade,
      entries: r.entries,
      total: r.total,
      week: of(week, r.trade),
      month: of(month, r.trade),
      lastDate: r.lastDate,
      contractors: [...new Set(contractors.filter((c) => c.trade === r.trade).map((c) => c.contractorName))].sort(),
    }))
    .sort((a, b) => (a.trade === "") !== (b.trade === "") ? (a.trade === "" ? 1 : -1) : b.month - a.month || b.total - a.total || a.trade.localeCompare(b.trade));
}

/** The trade a contractor usually works under, from their last entries: so the form can fill it in */
export function usualTrade(rows: { contractorName: string; trade: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) if (r.trade && !(r.contractorName in out)) out[r.contractorName] = r.trade; // rows newest first
  return out;
}
