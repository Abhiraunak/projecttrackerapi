/**
 * The Progress page's figures, with no database in them, so they are unit-tested.
 * Money comes from the same sums as the hub and the cost tracker (labour paid on work items, materials received),
 * so every screen shows the same rupee.
 */
import { overallProgress, type HubTask } from "./hub.calc.js";

export interface ProgressTask extends HubTask {
  id: string;
  work: string;
}

export type Pace = "done" | "ahead" | "on_track" | "behind" | "not_started" | "late";

/** Within this many points of where the calendar says it should be counts as on track */
const TOLERANCE = 5;
const DAY = 86_400_000;
const ms = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);
const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/** How far through its dates a piece of work should be today: 0 before the start, 100 on or after the end */
export function expectedPercent(start: string, end: string, today: string): number {
  const total = daysBetween(start, end) + 1; // both days count: a one-day item is half way at no point
  const done = daysBetween(start, today) + 1;
  if (done <= 0) return 0;
  if (done >= total) return 100;
  return Math.round((done / total) * 100);
}

/** Done, ahead, on track, behind, not started yet, or past its end with work left */
export function paceOf(progress: number, expected: number, endPassed: boolean): Pace {
  if (progress >= 100) return "done";
  if (endPassed) return "late";
  if (expected === 0) return progress > 0 ? "ahead" : "not_started";
  if (progress >= expected + TOLERANCE) return "ahead";
  if (progress <= expected - TOLERANCE) return "behind";
  return "on_track";
}

export function timelineRows(tasks: ProgressTask[], today: string) {
  return tasks.map((t) => {
    const expected = expectedPercent(t.startDate, t.endDate, today);
    return {
      id: t.id,
      work: t.work,
      start: t.startDate,
      end: t.endDate,
      progress: clamp(t.progress),
      expected,
      pace: paceOf(t.progress, expected, ms(today) > ms(t.endDate)),
      agreed: t.stipulated,
      paid: t.paid,
    };
  });
}

/** The project's time: first start to last end, how much of it has gone, and whether the work keeps up */
export function timeFigures(tasks: ProgressTask[], today: string) {
  const workPct = overallProgress(tasks);
  if (tasks.length === 0) return { start: null, end: null, totalDays: 0, daysUsed: 0, daysLeft: null, timePct: 0, workPct, pace: "not_started" as Pace, gap: 0 };
  const start = tasks.map((t) => t.startDate).sort()[0]!;
  const end = tasks.map((t) => t.endDate).sort().at(-1)!;
  const totalDays = daysBetween(start, end) + 1;
  const daysUsed = clamp(daysBetween(start, today) + 1, 0, totalDays);
  const timePct = expectedPercent(start, end, today);
  return {
    start,
    end,
    totalDays,
    daysUsed,
    daysLeft: daysBetween(today, end),
    timePct,
    workPct,
    pace: paceOf(workPct, timePct, ms(today) > ms(end)),
    gap: workPct - timePct, // + ahead of the calendar, − behind it, in points
  };
}

/** Labour and materials against the budget, plus what the materials will likely cost in the end */
export function costFigures(projectCost: number | null, tasks: ProgressTask[], materials: { spent: number; expected: number }) {
  const agreed = tasks.reduce((s, t) => s + t.stipulated, 0);
  const labourUsed = tasks.reduce((s, t) => s + t.paid, 0);
  const budget = projectCost ?? agreed;
  const used = labourUsed + materials.spent;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    budget: r(budget),
    budgetIsSet: projectCost !== null,
    labourUsed: r(labourUsed),
    materialUsed: r(materials.spent),
    used: r(used),
    left: r(budget - used),
    usedPct: budget > 0 ? Math.round((used / budget) * 100) : 0,
    // Likely final cost: labour as agreed (or more if already paid past it) + materials' expected cost
    likelyFinal: r(Math.max(agreed, labourUsed) + Math.max(materials.expected, materials.spent)),
  };
}
