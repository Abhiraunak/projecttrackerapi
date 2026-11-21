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

export interface RateTask {
  area: number; // sqft
  contractorRate: number; // ₹ per sqft
  inHouseRate: number;
}

/** A work item can be compared once it has an area and both rates */
export const comparable = (t: RateTask) => t.area > 0 && t.contractorRate > 0 && t.inHouseRate > 0;

/**
 * Contractor vs in-house, the same sum as the Project page: area × rate for each way of doing the work.
 * `saving` is what doing it in-house saves (negative: the contractor is cheaper).
 */
export function rateFigures(tasks: RateTask[]) {
  const rows = tasks.filter(comparable);
  const contractor = round2(sum(rows, (t) => t.area * t.contractorRate));
  const inHouse = round2(sum(rows, (t) => t.area * t.inHouseRate));
  return { compared: rows.length, missing: tasks.length - rows.length, contractor, inHouse, saving: round2(contractor - inHouse) };
}

/** The project's money. `labourPaid` now carries labour + general spending (attendance, contract work, expenses) and `materialSpent` the deliveries, both from spendByProject; the budget is the project cost when set, otherwise the work items' total */
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
/**
 * The project's dates: its own start and finish when set on Edit project, otherwise the earliest work item start
 * and the latest work item finish.
 */
export function scheduleFigures(tasks: HubTask[], today: string, own: { start: string | null; end: string | null } = { start: null, end: null }) {
  const start = own.start ?? (tasks.length ? tasks.map((t) => t.startDate).sort()[0]! : null);
  const end = own.end ?? (tasks.length ? tasks.map((t) => t.endDate).sort().at(-1)! : null);
  if (!start && !end) return { start: null, end: null, daysLeft: null, late: false };
  if (!end) return { start, end: null, daysLeft: null, late: false };
  const daysLeft = daysBetween(today, end);
  return { start, end, daysLeft, late: daysLeft < 0 && overallProgress(tasks) < 100 };
}