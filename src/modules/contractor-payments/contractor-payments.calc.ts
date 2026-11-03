/*
 * Labour money for one project, without the database, so it is easy to test:
 *  - each contractor's ledger: what attendance says they earned, what was paid, what is still owed;
 *  - the cost by trade, for the donut on the labour page.
 */

const key = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const round = (n: number) => Math.round(n * 100) / 100;

/** "  suresh   yadav " typed today becomes "Suresh Yadav" if that name is already used on the project */
export function canonicalName(raw: string, known: string[]): string {
  const clean = raw.trim().replace(/\s+/g, " ");
  return known.find((k) => key(k) === key(clean)) ?? clean;
}

export interface MoneyRow {
  trade: string;
  contractorName: string;
  total: number;
}

export interface ContractorLedger {
  trade: string; // "" when not set
  contractorName: string;
  earned: number; // from attendance
  paid: number; // from payments
  balance: number; // earned - paid; below 0 means paid in advance
  lastPaid: string | null;
}

/**
 * One line per contractor and trade. Names and trades match whatever the case or spacing, so "suresh yadav" paid
 * lands on "Suresh Yadav" from attendance. Sorted by trade (not-set last), then most still owed first.
 */
export function contractorLedger(earned: MoneyRow[], paid: MoneyRow[], lastPaid: (MoneyRow & { date: string })[] = []): ContractorLedger[] {
  const lines = new Map<string, ContractorLedger>();
  const line = (r: MoneyRow) => {
    const k = `${key(r.trade)}|${key(r.contractorName)}`;
    let l = lines.get(k);
    if (!l) {
      l = { trade: r.trade.trim(), contractorName: r.contractorName.trim(), earned: 0, paid: 0, balance: 0, lastPaid: null };
      lines.set(k, l);
    }
    return l;
  };
  for (const r of earned) line(r).earned += r.total;
  for (const r of paid) line(r).paid += r.total;
  for (const r of lastPaid) {
    const l = line(r);
    if (!l.lastPaid || r.date > l.lastPaid) l.lastPaid = r.date;
  }
  return [...lines.values()]
    .map((l) => ({ ...l, earned: round(l.earned), paid: round(l.paid), balance: round(l.earned - l.paid) }))
    .sort((a, b) => (a.trade === "") !== (b.trade === "") ? (a.trade === "" ? 1 : -1) : a.trade.localeCompare(b.trade) || b.balance - a.balance || a.contractorName.localeCompare(b.contractorName));
}

export interface TradeCost {
  trade: string; // "" when not set
  cost: number;
  contractors: number;
}

/** Cost by trade from attendance, biggest first, not-set last; trades with nothing spent are left out */
export function tradeCosts(rows: MoneyRow[]): TradeCost[] {
  const byTrade = new Map<string, { trade: string; cost: number; names: Set<string> }>();
  for (const r of rows) {
    const k = key(r.trade);
    let t = byTrade.get(k);
    if (!t) {
      t = { trade: r.trade.trim(), cost: 0, names: new Set() };
      byTrade.set(k, t);
    }
    t.cost += r.total;
    if (r.contractorName.trim()) t.names.add(key(r.contractorName));
  }
  return [...byTrade.values()]
    .filter((t) => t.cost > 0)
    .map((t) => ({ trade: t.trade, cost: round(t.cost), contractors: t.names.size }))
    .sort((a, b) => (a.trade === "") !== (b.trade === "") ? (a.trade === "" ? 1 : -1) : b.cost - a.cost);
}