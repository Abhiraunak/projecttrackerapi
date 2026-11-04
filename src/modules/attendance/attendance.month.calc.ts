/*
 * One contractor's month, like a monthly labour sheet: every labourer down the side, days 1–31 across, then their
 * hours, amount, overtime and total; and the account for the month (what was owed before, earned, paid, still owed).
 * No database here, so it is easy to test.
 */

import { round2, STANDARD_HOURS } from "./attendance.hourly.js";

export interface MonthEntry {
  date: string; // YYYY-MM-DD
  extras: number;
  totalAmount: number;
  workers: { label: string; amount: number; memberId: string | null; hours: number | null; otHours: number | null; hourlyRate: number | null }[];
}

export interface SheetCell {
  hours: number | null; // null: paid by amount
  ot: number | null;
  amount: number;
}

export interface SheetRow {
  key: string;
  name: string;
  hourly: boolean;
  dayRate: number | null; // the latest rate used in the month, for 8 hours
  hourlyRate: number | null;
  days: Record<number, SheetCell>; // day of the month (1–31) -> that day
  hours: number;
  otHours: number;
  amount: number; // for the normal hours (or everything typed, when paid by amount)
  otAmount: number;
  total: number;
}

export interface MonthSheet {
  daysInMonth: number;
  rows: SheetRow[];
  extras: Record<number, number>; // extras by day
  extrasTotal: number;
  dayTotals: Record<number, number>;
  totals: { hours: number; otHours: number; amount: number; otAmount: number; total: number };
}

export const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
};

/**
 * A row per labourer: the team member when paid hourly, else the label. Rows are in the order people first appear
 * (those there from the 1st first, then who joined later), as on a paper sheet.
 */
export function monthSheet(month: string, entries: MonthEntry[]): MonthSheet {
  const daysInMonth = daysIn(month);
  const rows = new Map<string, SheetRow & { exactAmount: number; exactOt: number }>();
  const extras: Record<number, number> = {};
  const dayTotals: Record<number, number> = {};
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const e of sorted) {
    const day = Number(e.date.slice(8, 10));
    if (e.extras) extras[day] = round2((extras[day] ?? 0) + e.extras);
    dayTotals[day] = round2((dayTotals[day] ?? 0) + e.totalAmount);
    for (const w of e.workers) {
      const hourly = w.hours !== null || w.otHours !== null;
      const key = w.memberId ? `m:${w.memberId}` : `${hourly ? "h" : "a"}:${w.label.trim().replace(/\s+/g, " ").toLowerCase()}`;
      let row = rows.get(key);
      if (!row) {
        row = { key, name: w.label, hourly, dayRate: null, hourlyRate: null, days: {}, hours: 0, otHours: 0, amount: 0, otAmount: 0, total: 0, exactAmount: 0, exactOt: 0 };
        rows.set(key, row);
      }
      row.name = w.label; // the latest spelling
      const cell = row.days[day] ?? { hours: hourly ? 0 : null, ot: hourly ? 0 : null, amount: 0 };
      cell.amount = round2(cell.amount + w.amount);
      row.total += w.amount;
      if (hourly) {
        const h = w.hours ?? 0;
        const ot = w.otHours ?? 0;
        const rate = w.hourlyRate ?? 0;
        cell.hours = (cell.hours ?? 0) + h;
        cell.ot = (cell.ot ?? 0) + ot;
        row.hours += h;
        row.otHours += ot;
        row.exactAmount += h * rate;
        row.exactOt += ot * rate;
        row.hourlyRate = rate;
        row.dayRate = round2(rate * STANDARD_HOURS);
      } else {
        row.exactAmount += w.amount;
      }
      row.days[day] = cell;
    }
  }

  const list = [...rows.values()].map(({ exactAmount, exactOt, ...r }) => ({
    ...r,
    hours: round2(r.hours),
    otHours: round2(r.otHours),
    amount: round2(exactAmount),
    otAmount: round2(exactOt),
    total: round2(r.total),
  }));
  const sum = (pick: (r: SheetRow) => number) => round2(list.reduce((s, r) => s + pick(r), 0));
  const extrasTotal = round2(Object.values(extras).reduce((s, v) => s + v, 0));
  return {
    daysInMonth,
    rows: list,
    extras,
    extrasTotal,
    dayTotals,
    totals: { hours: sum((r) => r.hours), otHours: sum((r) => r.otHours), amount: sum((r) => r.amount), otAmount: sum((r) => r.otAmount), total: round2(sum((r) => r.total) + extrasTotal) },
  };
}

export interface Statement {
  opening: number; // owed from before this month (earned − paid); below 0: paid in advance
  earned: number; // this month's attendance
  payments: { id: string; date: string; amount: number; remark: string }[];
  paid: number;
  closing: number; // carried to next month
}

/** Owed from before + earned this month − paid this month = carried to next month */
export function statement(earnedBefore: number, paidBefore: number, earned: number, payments: Statement["payments"]): Statement {
  const opening = round2(earnedBefore - paidBefore);
  const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
  return { opening, earned: round2(earned), payments, paid, closing: round2(opening + earned - paid) };
}