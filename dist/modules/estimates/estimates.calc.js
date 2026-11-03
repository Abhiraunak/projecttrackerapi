/*
 * How much of a material a project needs, worked out the way an estimate sheet does it. No database here, and the
 * same file is used on the screen (lib/inventory/estimateCalc.ts), so the total shown is the total saved.
 *
 *   quantity: typed as it is (bricks, sand, cement…)
 *   steel:    each row is nos × bars × cut length (m), weighed at dia² ÷ 162 kg a metre
 *             (bars typed, or worked out from a span and the spacing: span ÷ spacing, rounded up)
 *   volume:   each row is nos × L × B × D (m), in cubic metres
 * Then wastage on top: 96.67 m³ with 5% wastage is 101.50 m³.
 */
export const ESTIMATE_METHODS = ["quantity", "steel", "volume"];
export const STEEL_DIAS = [6, 8, 10, 12, 16, 20, 25, 32]; // mm
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
const count = (n) => (n === null || n === undefined ? 1 : n);
/** Steel weight a metre: 10 mm is 0.617 kg/m, 16 mm 1.58 kg/m */
export const kgPerMetre = (dia) => (dia * dia) / 162;
/** Bars in one member: as typed, or span ÷ spacing rounded up (2.2 m at 0.125 m is 18 bars) */
export function barsFor(row) {
    if (row.bars !== null && row.bars !== undefined)
        return row.bars;
    if (row.span && row.spacing)
        return Math.ceil(row.span / row.spacing - 1e-9);
    return 0;
}
export function steelLine(row) {
    const bars = barsFor(row);
    const length = count(row.nos) * bars * row.cutLength;
    return { bars, length: round(length, 3), weight: round(length * kgPerMetre(row.dia), 3) };
}
export const volumeLine = (row) => ({ volume: round(count(row.nos) * row.l * row.b * row.d, 4) });
/* --------------------------------- units --------------------------------- */
const unitKey = (u) => u.trim().toLowerCase().replace(/[\s.]/g, "").replace("³", "3");
const KG = { kg: 1, kgs: 1, kilogram: 1, kilograms: 1, t: 1 / 1000, mt: 1 / 1000, ton: 1 / 1000, tons: 1 / 1000, tonne: 1 / 1000, tonnes: 1 / 1000, qtl: 1 / 100, quintal: 1 / 100 };
const CUM = { m3: 1, cum: 1, cumtr: 1, cubicmetre: 1, cubicmeter: 1, cft: 35.3147, ft3: 35.3147, cuft: 35.3147, cubicfeet: 35.3147 };
/** Steel comes out in kg and concrete in m³: the factor to the material's own unit, or null when it doesn't fit */
export function unitFactor(method, unit) {
    if (method === "quantity")
        return 1;
    const table = method === "steel" ? KG : CUM;
    return table[unitKey(unit)] ?? null;
}
/**
 * The quantity to save, in the material's unit with wastage included.
 * `base` is before wastage, in kg (steel), m³ (volume) or the material's unit (quantity).
 */
export function estimate(input, unit) {
    const wastage = input.wastagePercent ?? 0;
    if (!(wastage >= 0 && wastage <= 100))
        return { ok: false, message: "Wastage must be between 0 and 100%." };
    const factor = unitFactor(input.method, unit);
    if (factor === null) {
        const wants = input.method === "steel" ? "kg or tonnes" : "m³ or cft";
        return { ok: false, message: `This material is counted in ${unit}. Steel and concrete rows work out ${wants}; enter the quantity instead.` };
    }
    let base = 0;
    let baseUnit = unit;
    if (input.method === "quantity") {
        base = input.quantity ?? 0;
    }
    else if (input.method === "steel") {
        const rows = input.steel ?? [];
        if (rows.length === 0)
            return { ok: false, message: "Add at least one row." };
        const noBars = rows.findIndex((r) => barsFor(r) <= 0);
        if (noBars >= 0)
            return { ok: false, message: `Row ${noBars + 1}: enter the number of bars, or the span and spacing.` };
        base = rows.reduce((s, r) => s + steelLine(r).weight, 0);
        baseUnit = "kg";
    }
    else {
        const rows = input.volume ?? [];
        if (rows.length === 0)
            return { ok: false, message: "Add at least one row." };
        base = rows.reduce((s, r) => s + volumeLine(r).volume, 0);
        baseUnit = "m³";
    }
    if (!(base > 0))
        return { ok: false, message: "The quantity comes out as 0. Enter the figures." };
    const withWastage = base * (1 + wastage / 100);
    return { ok: true, base: round(base, 3), baseUnit, withWastage: round(withWastage, 3), quantity: round(withWastage * factor, 3) };
}
//# sourceMappingURL=estimates.calc.js.map