/**
 * The client portal's rules, with no database in them: when a payment is due, what is paid,
 * whether the advance is in, how far behind the work is, and what a delay moves.
 */
import { startOfDay, timeUsed, weightedProgress } from "../dashboard/dashboard.calc.js";

const DAY = 86_400_000;
/** Days the client has to pay once the admin asks for a payment that has no date of its own */
export const PAYMENT_TERMS_DAYS = 7;
const round2 = (v: number) => Math.round(v * 100) / 100;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(startOfDay(d).getTime() + days * DAY);

/* -------------------------------- instalments -------------------------------- */

export type InstalmentKind = "ADVANCE" | "INSTALMENT";
export type ProofStatus = "PENDING" | "APPROVED" | "REJECTED";
export type InstalmentStatus = "Paid" | "Checking payment" | "Part paid" | "Overdue" | "Due" | "Upcoming";

export interface InstalmentInput {
  id: string;
  kind: InstalmentKind;
  amount: number; // before tax
  taxPercent: number;
  dueDate: Date | null;
  dueAtProgress: number | null;
  requestedAt: Date | null;
  createdAt: Date;
  proofs: { amount: number; status: ProofStatus }[];
}

export interface InstalmentState {
  total: number; // with tax
  tax: number;
  paid: number; // approved payments only
  checking: number; // sent by the client, not checked yet
  remaining: number;
  status: InstalmentStatus;
  isDue: boolean;
  dueOn: string | null; // the date it must be paid by, when there is one
  daysOverdue: number;
  why: string; // why it is due, in words: "Due on 12 Nov", "Work reached 40%", "Requested on 2 Nov"
}

export const totalWithTax = (amount: number, taxPercent: number) => round2(amount * (1 + taxPercent / 100));

const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * When is it due? Whichever comes first:
 *  - its date
 *  - the work reaching its %
 *  - the admin asking for it (then it must be paid within the payment terms)
 * The advance is asked for as soon as it is created (the service sets requestedAt).
 */
export function instalmentState(i: InstalmentInput, progress: number, today: Date): InstalmentState {
  const total = totalWithTax(i.amount, i.taxPercent);
  const paid = round2(i.proofs.filter((p) => p.status === "APPROVED").reduce((s, p) => s + p.amount, 0));
  const checking = round2(i.proofs.filter((p) => p.status === "PENDING").reduce((s, p) => s + p.amount, 0));
  const remaining = round2(Math.max(0, total - paid));
  const t = startOfDay(today).getTime();

  const byDate = i.dueDate !== null && startOfDay(i.dueDate).getTime() <= t;
  const byWork = i.dueAtProgress !== null && progress >= i.dueAtProgress;
  const byRequest = i.requestedAt !== null;
  const isDue = byDate || byWork || byRequest;

  // The pay-by date: its own date, or the request plus the payment terms, whichever is earlier
  const candidates = [i.dueDate ? startOfDay(i.dueDate) : null, i.requestedAt ? addDays(i.requestedAt, PAYMENT_TERMS_DAYS) : null].filter((d): d is Date => d !== null);
  const payBy = candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : null;
  const daysOverdue = payBy && remaining > 0.5 ? Math.max(0, Math.round((t - payBy.getTime()) / DAY)) : 0;

  let status: InstalmentStatus;
  if (remaining <= 0.5) status = "Paid";
  else if (checking > 0 && paid + checking >= total - 0.5) status = "Checking payment";
  else if (daysOverdue > 0) status = "Overdue";
  else if (paid > 0) status = "Part paid";
  else if (isDue) status = "Due";
  else status = "Upcoming";

  const why = byRequest
    ? `Requested on ${fmt(i.requestedAt!)}`
    : byWork
      ? `Work reached ${i.dueAtProgress}%`
      : i.dueDate
        ? `Due on ${fmt(i.dueDate)}`
        : i.dueAtProgress !== null
          ? `When the work reaches ${i.dueAtProgress}%`
          : "When requested";

  return { total, tax: round2(total - i.amount), paid, checking, remaining, status, isDue, dueOn: payBy ? dayKey(payBy) : null, daysOverdue, why };
}

export interface PaymentSummary {
  contract: number; // everything on the schedule, with tax
  paid: number;
  checking: number;
  dueNow: number; // due and not yet paid (payments being checked included)
  overdue: number;
  upcoming: number; // not due yet
  overdueCount: number;
}

export function paymentSummary(states: InstalmentState[]): PaymentSummary {
  const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));
  return {
    contract: sum(states.map((s) => s.total)),
    paid: sum(states.map((s) => s.paid)),
    checking: sum(states.map((s) => s.checking)),
    dueNow: sum(states.filter((s) => s.isDue).map((s) => s.remaining)),
    overdue: sum(states.filter((s) => s.daysOverdue > 0).map((s) => s.remaining)),
    upcoming: sum(states.filter((s) => !s.isDue).map((s) => s.remaining)),
    overdueCount: states.filter((s) => s.daysOverdue > 0).length,
  };
}

/* ---------------------------------- advance ---------------------------------- */

export type AdvanceStatus = "No advance" | "Waiting for advance" | "Advance paid" | "Started without advance";

/** Work should wait for the advance, unless the admin chose to start anyway */
export function advanceStatus(states: { kind: InstalmentKind; status: InstalmentStatus }[], override: boolean): AdvanceStatus {
  const advances = states.filter((s) => s.kind === "ADVANCE");
  if (advances.length === 0) return "No advance";
  if (advances.every((s) => s.status === "Paid")) return "Advance paid";
  return override ? "Started without advance" : "Waiting for advance";
}

/* ---------------------------------- schedule ---------------------------------- */

export interface TaskInput {
  id: string;
  work: string;
  stipulated: number;
  progress: number;
  startDate: Date;
  endDate: Date;
}

export interface ScheduleSummary {
  done: number; // work done, weighted by each item's value
  time: number; // share of the planned time used
  start: string | null;
  finish: string | null; // the current planned finish (delays included)
  daysLeft: number | null;
  daysBehind: number; // how far the work trails the calendar, in days (0 when on time or ahead)
}

export function scheduleSummary(tasks: TaskInput[], today: Date): ScheduleSummary {
  if (tasks.length === 0) return { done: 0, time: 0, start: null, finish: null, daysLeft: null, daysBehind: 0 };
  const done = weightedProgress(tasks);
  const time = timeUsed(tasks, today);
  const start = Math.min(...tasks.map((t) => startOfDay(t.startDate).getTime()));
  const finish = Math.max(...tasks.map((t) => startOfDay(t.endDate).getTime()));
  const length = Math.max(1, (finish - start) / DAY);
  const daysBehind = done >= 100 ? 0 : Math.max(0, Math.round(((time - done) / 100) * length));
  return {
    done,
    time,
    start: dayKey(new Date(start)),
    finish: dayKey(new Date(finish)),
    daysLeft: Math.round((finish - startOfDay(today).getTime()) / DAY),
    daysBehind,
  };
}

/* ----------------------------------- delays ----------------------------------- */

export interface DatedTask {
  id: string;
  progress: number;
  startDate: Date;
  endDate: Date;
}

export interface DatedInstalment {
  id: string;
  dueDate: Date | null;
  paidUp: boolean;
}

/**
 * What a delay of `days` from `from` moves:
 *  - unfinished work still running on or after that day: its end moves; its start too, if it hadn't started yet
 *  - unpaid payments dated on or after that day: their date moves
 * Finished work, payments already made, and anything before the delay stay as they are.
 */
export function planDelay(tasks: DatedTask[], instalments: DatedInstalment[], from: Date, days: number) {
  const f = startOfDay(from).getTime();
  const shift = (d: Date) => addDays(d, days);
  const taskMoves = tasks
    .filter((t) => t.progress < 100 && startOfDay(t.endDate).getTime() >= f)
    .map((t) => ({ id: t.id, startDate: startOfDay(t.startDate).getTime() >= f ? shift(t.startDate) : startOfDay(t.startDate), endDate: shift(t.endDate) }));
  const paymentMoves = instalments
    .filter((i) => !i.paidUp && i.dueDate !== null && startOfDay(i.dueDate).getTime() >= f)
    .map((i) => ({ id: i.id, dueDate: shift(i.dueDate!) }));
  return { taskMoves, paymentMoves };
}

/** The usual lengths offered for a delay; a week unless the admin picks another */
export const DELAY_PRESETS = [3, 7, 14, 21] as const;
export const DEFAULT_DELAY_DAYS = 7;

/** Invoice numbers read INV-0001, INV-0002… within each project */
export const invoiceNo = (n: number) => `INV-${String(n).padStart(4, "0")}`;

/* --------------------------------- reminders --------------------------------- */

export interface ReminderInstalment {
  id: string;
  invoiceNo: string;
  label: string;
  kind: InstalmentKind;
  status: InstalmentStatus;
  isDue: boolean;
  dueOn: string | null;
  daysOverdue: number;
  remaining: number;
  why: string;
}

export interface Reminder {
  to: "client" | "admins";
  key: string; // the same key is only ever sent once to a person
  title: string;
  body: string;
}

const inrText = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * The reminders a project's payments call for today. Overdue: on the first day, then once a week (the key carries
 * the week). Due: once, when it falls due on its own. Coming up: once, 1 to 3 days before its pay-by date.
 * Paid ones, and ones whose payment is being checked, are left alone.
 */
export function paymentReminders(projectTitle: string, instalments: ReminderInstalment[], today: Date): Reminder[] {
  const out: Reminder[] = [];
  const t = startOfDay(today).getTime();
  for (const i of instalments) {
    if (i.status === "Paid" || i.status === "Checking payment") continue;
    const left = inrText(i.remaining);
    if (i.daysOverdue > 0) {
      const week = Math.floor((i.daysOverdue - 1) / 7);
      out.push({ to: "client", key: `overdue:${i.id}:${week}`, title: "Payment overdue", body: `${i.invoiceNo} · ${i.label}: ${left} for ${projectTitle} was due on ${shortDay(i.dueOn!)}.` });
      out.push({ to: "admins", key: `overdue:${i.id}:${week}`, title: "Client payment overdue", body: `${projectTitle} · ${i.invoiceNo} ${i.label}: ${left}, ${i.daysOverdue} ${i.daysOverdue === 1 ? "day" : "days"} late.` });
    } else if (i.isDue) {
      out.push({ to: "client", key: `due:${i.id}`, title: i.kind === "ADVANCE" ? "Advance requested" : "Payment due", body: `${i.invoiceNo} · ${i.label}: ${left} for ${projectTitle}. ${i.why}.` });
    } else if (i.dueOn) {
      const daysTo = Math.round((startOfDay(new Date(`${i.dueOn}T00:00:00Z`)).getTime() - t) / DAY);
      if (daysTo >= 1 && daysTo <= 3) {
        out.push({ to: "client", key: `soon:${i.id}:${i.dueOn}`, title: `Payment due in ${daysTo} ${daysTo === 1 ? "day" : "days"}`, body: `${i.invoiceNo} · ${i.label}: ${left} for ${projectTitle}, by ${shortDay(i.dueOn)}.` });
      }
    }
  }
  return out;
}
