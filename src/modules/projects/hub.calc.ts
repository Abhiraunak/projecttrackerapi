/**
 * The project hub's figures, with no database in them, so they are unit-tested.
 * They use the same sums as the project cards and the labour page, so every screen shows the same numbers.
 */

export interface HubTask {
  stipulated: number; // agreed amount for the work item
  paid: number;
  progress: number; // 0-100
  startDate: string; // YYYY-MM-DD
  endDate: string;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const sum = <T>(rows: T[], pick: (r: T) => number) => rows.reduce((s, r) => s + pick(r), 0);

/** How far along the whole project is: each item weighted by its agreed amount (plain average when nothing is agreed) */
export function overallProgress(tasks: HubTask[]): number {
  if (tasks.length === 0) return 0;
  const agreed = sum(tasks, (t) => t.stipulated);
  const p = agreed > 0 ? sum(tasks, (t) => t.stipulated * t.progress) / agreed : sum(tasks, (t) => t.progress) / tasks.length;
  return Math.round(p);
}

/** Labour money: what was agreed, what the work done so far is worth, what was paid, and what is owed for it */
export function labourFigures(tasks: HubTask[]) {
  const agreed = round2(sum(tasks, (t) => t.stipulated));
  const paid = round2(sum(tasks, (t) => t.paid));
  const earned = round2(sum(tasks, (t) => (t.stipulated * t.progress) / 100));
  const gap = round2(earned - paid);
  return { agreed, paid, earned, due: Math.max(0, gap), paidAhead: Math.max(0, -gap) };
}

/** The project's money: the budget is the project cost when set, otherwise the work items' total */
export function moneyFigures(projectCost: number | null, agreed: number, labourPaid: number, materialSpent: number) {
  const budget = projectCost ?? agreed;
  const spent = round2(labourPaid + materialSpent);
  return {
    budget,
    budgetIsSet: projectCost !== null,
    labourPaid,
    materialSpent,
    spent,
    left: round2(budget - spent),
    usedPct: budget > 0 ? Math.round((spent / budget) * 100) : 0,
  };
}

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** First start and last end of the work items, days left to the end, and whether the end has passed with work left */
export function scheduleFigures(tasks: HubTask[], today: string) {
  if (tasks.length === 0) return { start: null, end: null, daysLeft: null, late: false };
  const start = tasks.map((t) => t.startDate).sort()[0]!;
  const end = tasks.map((t) => t.endDate).sort().at(-1)!;
  const daysLeft = daysBetween(today, end);
  return { start, end, daysLeft, late: daysLeft < 0 && overallProgress(tasks) < 100 };
}
