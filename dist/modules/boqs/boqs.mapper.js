import { boqTotals, itemCount } from "./boq.calc.js";
export const boqInclude = { updatedBy: { select: { email: true } } };
/** The copies of document facts kept in their own columns, for search and the dashboard. Always derived, never typed. */
export function derivedColumns(document) {
    return {
        title: document.title,
        subtitle: document.subtitle,
        boqNumber: document.boqNumber,
        grandTotal: Math.round(boqTotals(document).grandTotal * 100) / 100,
        itemCount: itemCount(document),
    };
}
export const boqDto = (row) => ({
    id: row.id,
    status: row.status,
    version: row.version,
    document: row.document,
    grandTotal: row.grandTotal.toNumber(),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy?.email ?? null,
});
export const boqSummaryDto = (row) => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    boqNumber: row.boqNumber,
    status: row.status,
    grandTotal: row.grandTotal.toNumber(),
    itemCount: row.itemCount,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy?.email ?? null,
});
//# sourceMappingURL=boqs.mapper.js.map