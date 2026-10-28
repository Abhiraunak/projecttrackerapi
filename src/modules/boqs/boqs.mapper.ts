import { Prisma } from "../../generated/prisma/client.js";
import { boqTotals, itemCount, type BoqDocument } from "./boq.calc.js";

export const boqInclude = { updatedBy: { select: { email: true } }, project: { select: { id: true, title: true } } } as const;
export type BoqRow = Prisma.BoqGetPayload<{ include: typeof boqInclude }>;

/** The copies of document facts kept in their own columns, for search and the dashboard. Always derived, never typed. */
export function derivedColumns(document: BoqDocument) {
  return {
    title: document.title,
    subtitle: document.subtitle,
    boqNumber: document.boqNumber,
    grandTotal: Math.round(boqTotals(document).grandTotal * 100) / 100,
    itemCount: itemCount(document),
  };
}

export const boqDto = (row: BoqRow) => ({
  id: row.id,
  status: row.status,
  version: row.version,
  document: row.document,
  grandTotal: row.grandTotal.toNumber(),
  project: row.project,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  updatedBy: row.updatedBy?.email ?? null,
});

export const boqSummaryDto = (row: BoqRow) => ({
  id: row.id,
  title: row.title,
  subtitle: row.subtitle,
  boqNumber: row.boqNumber,
  status: row.status,
  grandTotal: row.grandTotal.toNumber(),
  itemCount: row.itemCount,
  project: row.project,
  updatedAt: row.updatedAt,
  updatedBy: row.updatedBy?.email ?? null,
});
