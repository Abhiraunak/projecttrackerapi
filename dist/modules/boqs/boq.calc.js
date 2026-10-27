/**
 * The server's copy of the BOQ calculations: the frontend's lib/boq/types.ts and lib/boq/calc.ts joined into one
 * file. Keep the two in step, so the total the server saves is the total people see on screen.
 */
const isMeasure = (line) => line.kind === "measure";
/** The dimensions that were filled in (No., Length, Width, Height) */
export const filledDims = (line) => [line.no, line.length, line.width, line.height].filter((value) => value !== null);
/** No. x Length x Width x Height, using only the ones filled in. With none filled in, the typed quantity. */
export function lineQty(line) {
    const dims = filledDims(line);
    if (dims.length === 0)
        return line.qty ?? 0;
    return dims.reduce((product, value) => product * value, 1);
}
/** Is the quantity typed by hand (no dimensions) rather than worked out? */
export const isManualQty = (line) => filledDims(line).length === 0;
export const partQty = (part) => part.lines.filter(isMeasure).reduce((sum, line) => sum + lineQty(line), 0);
export const partAmount = (part) => partQty(part) * (part.rate ?? 0);
export const itemAmount = (item) => item.parts.reduce((sum, part) => sum + partAmount(part), 0);
/** When an item has several parts in the same unit, their combined quantity (like the "total steel" row) */
export function itemCombinedQty(item) {
    if (item.parts.length < 2)
        return null;
    const unit = item.parts[0].unit;
    if (!unit || item.parts.some((part) => part.unit !== unit))
        return null;
    return { qty: item.parts.reduce((sum, part) => sum + partQty(part), 0), unit };
}
export const sheetTotal = (sheet) => sheet.sections.reduce((sum, section) => sum + section.entries.reduce((s, entry) => s + (entry.kind === "item" ? itemAmount(entry) : 0), 0), 0);
/** S.No for each item, counted 1, 2, 3... through the sheet */
export function serialNumbers(sheet) {
    const numbers = new Map();
    let next = 1;
    for (const section of sheet.sections) {
        for (const entry of section.entries)
            if (entry.kind === "item")
                numbers.set(entry.id, next++);
    }
    return numbers;
}
/** The SUMMARY sheet: TOTAL-A, then deductions (off TOTAL-A), TOTAL-B, then additions (on TOTAL-B) */
export function boqTotals(doc) {
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
export const itemCount = (doc) => doc.sheets.reduce((sum, sheet) => sum + sheet.sections.reduce((s, section) => s + section.entries.filter((e) => e.kind === "item").length, 0), 0);
//# sourceMappingURL=boq.calc.js.map