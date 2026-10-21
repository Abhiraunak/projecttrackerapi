/**
 * The server's copy of the BOQ calculations: the frontend's lib/boq/types.ts and lib/boq/calc.ts joined into one
 * file. Keep the two in step, so the total the server saves is the total people see on screen.
 */

export type BoqStatus = "DRAFT" | "FINAL";

export interface MeasureLine {
  id: string;
  kind: "measure";
  label: string; // CF6, PB-7, "For Flooring", or empty
  no: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  /** A typed quantity. Only used when No, Length, Width and Height are all empty. */
  qty: number | null;
}

export interface TextLine {
  id: string;
  kind: "text";
  text: string; // "For Foundation- Conservatory- Left Wing and Right Wing"
}

export type Line = MeasureLine | TextLine;

/** One priced block: its measurements add up to one quantity, with one unit, rate and amount */
export interface Part {
  id: string;
  code: string; // "(a)", "5.3.1.2", or empty
  description: string; // "10mm (TMT coil Fe 500)...", or empty
  unit: string; // cum, sqm, MT
  rate: number | null;
  lines: Line[];
}

export interface Item {
  id: string;
  kind: "item";
  code: string; // SOR No, e.g. 5.1.1
  description: string;
  parts: Part[];
}

export interface Label {
  id: string;
  kind: "label";
  text: string; // P.C.C., R.C.C.
}

export type Entry = Item | Label;

export interface Section {
  id: string;
  code: string; // 5.1
  title: string; // EARTHWORK
  entries: Entry[];
}

/** One works sheet (one row in the summary, one tab in the Excel export) */
export interface WorksSheet {
  id: string;
  name: string; // how it is named in the summary: "CIVIL WORKS- CONSERVATORY - Main Wing..."
  title: string; // the heading on its own page: "PART-H-1 : CIVIL WORKS - SOR- CONSERVATORY..."
  sections: Section[];
}

/** A percentage in the summary. Deductions come off TOTAL-A; additions are worked out on TOTAL-B. */
export interface Adjustment {
  id: string;
  label: string;
  percent: number;
  effect: "deduct" | "add";
}

export interface Company {
  name: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
}

export interface Signatures {
  leftLabel: string; // Commissioned by:
  leftName: string;
  rightLabel: string; // Submitted by:
  rightName: string;
}

export interface BoqDocument {
  company: Company;
  /** A small image as a data: URL (resized in the browser), or null */
  logo: string | null;
  title: string; // THE NATURE PARK, BARIDH, RANCHI (JHARKHAND)
  subtitle: string; // PART H-1 -CONSERVATORY- LEFT AND RIGHT WING
  rateBasis: string; // Rates as per SOR Jharkhand: 2022/ DSR: 2023
  boqNumber: string;
  date: string; // YYYY-MM-DD, or empty
  sheets: WorksSheet[];
  adjustments: Adjustment[];
  signatures: Signatures;
}

/** A saved BOQ, as the server returns it */
export interface BoqRecord {
  id: string;
  status: BoqStatus;
  version: number; // goes up on every save; a save with an old version is refused (someone else saved meanwhile)
  document: BoqDocument;
  grandTotal: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null; // email
}

/** One row of the BOQ dashboard */
export interface BoqSummary {
  id: string;
  title: string;
  subtitle: string;
  boqNumber: string;
  status: BoqStatus;
  grandTotal: number;
  itemCount: number;
  updatedAt: string;
  updatedBy: string | null;
}

const isMeasure = (line: Line): line is MeasureLine => line.kind === "measure";

/** The dimensions that were filled in (No., Length, Width, Height) */
export const filledDims = (line: MeasureLine): number[] =>
  [line.no, line.length, line.width, line.height].filter((value): value is number => value !== null);

/** No. x Length x Width x Height, using only the ones filled in. With none filled in, the typed quantity. */
export function lineQty(line: MeasureLine): number {
  const dims = filledDims(line);
  if (dims.length === 0) return line.qty ?? 0;
  return dims.reduce((product, value) => product * value, 1);
}

/** Is the quantity typed by hand (no dimensions) rather than worked out? */
export const isManualQty = (line: MeasureLine) => filledDims(line).length === 0;

export const partQty = (part: Part): number => part.lines.filter(isMeasure).reduce((sum, line) => sum + lineQty(line), 0);

export const partAmount = (part: Part): number => partQty(part) * (part.rate ?? 0);

export const itemAmount = (item: Item): number => item.parts.reduce((sum, part) => sum + partAmount(part), 0);

/** When an item has several parts in the same unit, their combined quantity (like the "total steel" row) */
export function itemCombinedQty(item: Item): { qty: number; unit: string } | null {
  if (item.parts.length < 2) return null;
  const unit = item.parts[0]!.unit;
  if (!unit || item.parts.some((part) => part.unit !== unit)) return null;
  return { qty: item.parts.reduce((sum, part) => sum + partQty(part), 0), unit };
}

export const sheetTotal = (sheet: WorksSheet): number =>
  sheet.sections.reduce(
    (sum, section) => sum + section.entries.reduce((s, entry) => s + (entry.kind === "item" ? itemAmount(entry) : 0), 0),
    0
  );

/** S.No for each item, counted 1, 2, 3... through the sheet */
export function serialNumbers(sheet: WorksSheet): Map<string, number> {
  const numbers = new Map<string, number>();
  let next = 1;
  for (const section of sheet.sections) {
    for (const entry of section.entries) if (entry.kind === "item") numbers.set(entry.id, next++);
  }
  return numbers;
}

export interface AdjustmentLine {
  adjustment: Adjustment;
  amount: number;
}

export interface BoqTotals {
  sheets: { sheet: WorksSheet; total: number }[];
  totalA: number; // all works sheets together
  deductions: AdjustmentLine[];
  totalB: number; // after deductions
  additions: AdjustmentLine[];
  grandTotal: number; // TOTAL including GST, labour cess, contingency...
  sayLakhs: number; // the grand total in lakhs, to 2 decimals ("Say 25.57 Lacs")
}

/** The SUMMARY sheet: TOTAL-A, then deductions (off TOTAL-A), TOTAL-B, then additions (on TOTAL-B) */
export function boqTotals(doc: BoqDocument): BoqTotals {
  const sheets = doc.sheets.map((sheet) => ({ sheet, total: sheetTotal(sheet) }));
  const totalA = sheets.reduce((sum, s) => sum + s.total, 0);

  const deductions = doc.adjustments
    .filter((a) => a.effect === "deduct")
    .map((adjustment) => ({ adjustment, amount: (totalA * adjustment.percent) / 100 }));
  const totalB = totalA - deductions.reduce((sum, d) => sum + d.amount, 0);

  const additions = doc.adjustments
    .filter((a) => a.effect === "add")
    .map((adjustment) => ({ adjustment, amount: (totalB * adjustment.percent) / 100 }));
  const grandTotal = totalB + additions.reduce((sum, a) => sum + a.amount, 0);

  return { sheets, totalA, deductions, totalB, additions, grandTotal, sayLakhs: Math.round((grandTotal / 100_000) * 100) / 100 };
}

/** How many priced items the BOQ has (for the dashboard) */
export const itemCount = (doc: BoqDocument): number =>
  doc.sheets.reduce((sum, sheet) => sum + sheet.sections.reduce((s, section) => s + section.entries.filter((e) => e.kind === "item").length, 0), 0);
