/**
 * The admin dashboard's numbers, with no database in it (easy to test). The service loads rows and hands them here.
 *
 *  - periods:      the chosen window (week / month / quarter), the one before it, and the trend's buckets
 *  - spendTrend:   materials and labour spent in each bucket
 *  - projectRow:   one ongoing project's progress, time used, budget used and status
 *  - portfolio:    work done vs time used, and labour paid vs due for work done, across projects
 */

export type Period = "week" | "month" | "quarter";
export const PERIODS: Period[] = ["week", "month", "quarter"];

const DAY = 86_400_000;
const PERIOD_DAYS: Record<Period, number> = { week: 7, month: 30, quarter: 90 };
const TREND_BUCKETS: Record<Period, number> = { week: 12, month: 12, quarter: 8 };

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Midnight UTC of the day `now` falls on */
export const startOfDay = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export interface Window {
  from: Date; // inclusive
  to: Date; // exclusive
}

/** The chosen window ends at the end of today; the previous one is the same length just before it */
export function periodWindows(period: Period, now: Date): { current: Window; previous: Window } {
  const end = new Date(startOfDay(now).getTime() + DAY);
  const length = PERIOD_DAYS[period] * DAY;
  const current = { from: new Date(end.getTime() - length), to: end };
  return { current, previous: { from: new Date(current.from.getTime() - length), to: current.from } };
}

/** The trend's buckets, oldest first: 12 weeks, 12 months of 30 days, or 8 quarters of 90 days, ending today */
export function trendBuckets(period: Period, now: Date): Window[] {
  const end = new Date(startOfDay(now).getTime() + DAY);
  const length = PERIOD_DAYS[period] * DAY;
  const count = TREND_BUCKETS[period];
  return Array.from({ length: count }, (_, i) => {
    const to = new Date(end.getTime() - (count - 1 - i) * length);
    return { from: new Date(to.getTime() - length), to };
  });
}

const inWindow = (at: Date, w: Window) => at >= w.from && at < w.to;

export interface DatedAmount {
  at: Date;
  amount: number;
}

/** Adds up amounts that fall inside a window */
export const sumIn = (rows: DatedAmount[], w: Window) => round2(rows.reduce((s, r) => s + (inWindow(r.at, w) ? r.amount : 0), 0));

export interface TrendPoint {
  from: string; // YYYY-MM-DD, the bucket's first day
  materials: number;
  labour: number;
}

/** Materials received and labour paid (attendance) in each bucket */
export function spendTrend(buckets: Window[], materials: DatedAmount[], labour: DatedAmount[]): TrendPoint[] {
  return buckets.map((b) => ({ from: b.from.toISOString().slice(0, 10), materials: sumIn(materials, b), labour: sumIn(labour, b) }));
}

/** Change from the previous window, as a whole percent; null when there was nothing before to compare with */
export const percentChange = (current: number, previous: number): number | null =>
  previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;

/* --------------------------------- projects --------------------------------- */

export interface TaskFacts {
  work: string;
  stipulated: number;
  paid: number;
  progress: number; // 0..100
  startDate: Date;
  endDate: Date;
}

/** Progress weighted by each work item's agreed amount; a plain average when nothing has an amount yet */
export function weightedProgress(tasks: Pick<TaskFacts, "stipulated" | "progress">[]): number {
  const total = tasks.reduce((s, t) => s + t.stipulated, 0);
  if (total > 0) return tasks.reduce((s, t) => s + t.stipulated * clamp(t.progress, 0, 100), 0) / total;
  return tasks.length ? tasks.reduce((s, t) => s + clamp(t.progress, 0, 100), 0) / tasks.length : 0;
}

/** How much of the planned time has gone, from the first work item's start to the last one's end (0..100) */
export function timeUsed(tasks: Pick<TaskFacts, "startDate" | "endDate">[], today: Date): number {
  if (tasks.length === 0) return 0;
  const start = Math.min(...tasks.map((t) => t.startDate.getTime()));
  const end = Math.max(...tasks.map((t) => t.endDate.getTime()));
  if (end <= start) return today.getTime() >= end ? 100 : 0;
  return clamp(((startOfDay(today).getTime() - start) / (end - start)) * 100, 0, 100);
}

export type ProjectStatus = "Completed" | "Over budget" | "Running late" | "On track" | "Not started";

export interface ProjectInput {
  id: string;
  title: string;
  projectCost: number | null;
  tasks: TaskFacts[];
  materialSpent: number;
  materialExpected: number;
}

export interface ProjectRow {
  id: string;
  title: string;
  next: string | null; // the first work item not finished yet
  done: number; // %
  time: number; // %
  spent: number; // labour paid + materials received
  budget: number | null; // the project cost
  used: number | null; // % of the project cost spent
  expected: number; // what it is expected to cost in the end
  status: ProjectStatus;
}

/** Late = work done more than 5 points behind the share of time used; over budget = expected above the project cost */
export function projectRow(p: ProjectInput, today: Date): ProjectRow {
  const done = round2(weightedProgress(p.tasks));
  const time = round2(timeUsed(p.tasks, today));
  const labourPaid = p.tasks.reduce((s, t) => s + t.paid, 0);
  const labourCommitted = p.tasks.reduce((s, t) => s + Math.max(t.stipulated, t.paid), 0);
  const spent = round2(labourPaid + p.materialSpent);
  const expected = round2(labourCommitted + Math.max(p.materialExpected, p.materialSpent));
  const budget = p.projectCost && p.projectCost > 0 ? p.projectCost : null;
  const next = [...p.tasks].sort((a, b) => a.startDate.getTime() - b.startDate.getTime()).find((t) => t.progress < 100)?.work ?? null;

  let status: ProjectStatus = "On track";
  if (p.tasks.length > 0 && done >= 100) status = "Completed";
  else if (budget !== null && expected > budget) status = "Over budget";
  else if (done + 5 < time) status = "Running late";
  else if (time === 0 && done === 0) status = "Not started";

  return { id: p.id, title: p.title, next, done, time, spent, budget, used: budget ? round2((spent / budget) * 100) : null, expected, status };
}

/* --------------------------------- portfolio -------------------------------- */

export interface Portfolio {
  done: number; // % of all agreed work, weighted by amount
  time: number; // % of planned time used, weighted the same way
  earned: number; // what the finished work is worth (agreed × progress)
  labourPaid: number;
  labourDue: number; // earned − paid, never below 0
  spent: number;
  budget: number; // project costs added up (projects that have one)
}

export function portfolio(projects: ProjectInput[], rows: ProjectRow[]): Portfolio {
  const tasks = projects.flatMap((p) => p.tasks);
  const earned = tasks.reduce((s, t) => s + (t.stipulated * clamp(t.progress, 0, 100)) / 100, 0);
  const labourPaid = tasks.reduce((s, t) => s + t.paid, 0);
  // Time used, weighted by each project's agreed amount, so a big project counts for more
  const weights = projects.map((p) => p.tasks.reduce((s, t) => s + t.stipulated, 0));
  const weightTotal = weights.reduce((s, w) => s + w, 0);
  const time = weightTotal > 0 ? rows.reduce((s, r, i) => s + r.time * weights[i]!, 0) / weightTotal : rows.length ? rows.reduce((s, r) => s + r.time, 0) / rows.length : 0;
  return {
    done: round2(weightedProgress(tasks)),
    time: round2(time),
    earned: round2(earned),
    labourPaid: round2(labourPaid),
    labourDue: round2(Math.max(0, earned - labourPaid)),
    spent: round2(rows.reduce((s, r) => s + r.spent, 0)),
    budget: round2(rows.reduce((s, r) => s + (r.budget ?? 0), 0)),
  };
}
