/**
 * Starter recipes: typical material quantities per unit of common BOQ items, so a new plan isn't empty.
 * They are ordinary planning figures (dry volume 1.54 × wet, cement 1440 kg/m³, 50 kg bags), not a substitute
 * for your SOR's analysis of rates: every recipe can be edited or deleted on the Recipes screen.
 */
export const RECIPE_MATERIALS = [
    { name: "Cement (OPC 53)", unit: "bag", category: "Binding" },
    { name: "River sand", unit: "m3", category: "Aggregates" },
    { name: "Aggregate 20 mm", unit: "m3", category: "Aggregates" },
    { name: "Red bricks", unit: "nos", category: "Masonry" },
    ...[8, 10, 12, 16, 20, 25, 32].map((d) => ({ name: `TMT steel ${d} mm`, unit: "kg", category: "Steel" })),
];
/** Concrete by nominal mix: cement bags, sand m³ and aggregate m³ per m³ of concrete */
const concrete = (name, mix, cement, sand, aggregate, extra = []) => ({
    name,
    unit: "cum",
    match: [[mix], ...extra],
    lines: [
        { material: "Cement (OPC 53)", perUnit: cement, wastagePercent: 2 },
        { material: "River sand", perUnit: sand, wastagePercent: 5 },
        { material: "Aggregate 20 mm", perUnit: aggregate, wastagePercent: 5 },
    ],
});
const steel = (d) => {
    const match = [[`${d}mm`, "tmt"], [`${d}mm`, "steel"], [`${d}mm`, "bar"], [`${d}mm`, "reinforcement"]];
    const material = `TMT steel ${d} mm`;
    return [
        { name: `TMT ${d} mm (per MT)`, unit: "MT", match, lines: [{ material, perUnit: 1000, wastagePercent: 3 }] },
        { name: `TMT ${d} mm (per kg)`, unit: "kg", match, lines: [{ material, perUnit: 1, wastagePercent: 3 }] },
    ];
};
export const STARTER_RECIPES = [
    concrete("Concrete 1:1.5:3 (M20)", "1:1.5:3", 8.06, 0.42, 0.84, [["m20"], ["m 20"]]),
    concrete("Concrete 1:2:4 (M15)", "1:2:4", 6.34, 0.44, 0.88, [["m15"], ["m 15"]]),
    concrete("Concrete 1:3:6 (M10)", "1:3:6", 4.43, 0.46, 0.92),
    concrete("Concrete 1:4:8", "1:4:8", 3.41, 0.47, 0.95),
    {
        name: "Brick masonry 1:6",
        unit: "cum",
        match: [["brick", "1:6"]],
        lines: [
            { material: "Red bricks", perUnit: 500, wastagePercent: 3 },
            { material: "Cement (OPC 53)", perUnit: 1.26, wastagePercent: 2 },
            { material: "River sand", perUnit: 0.27, wastagePercent: 5 },
        ],
    },
    {
        name: "Brick masonry 1:4",
        unit: "cum",
        match: [["brick", "1:4"]],
        lines: [
            { material: "Red bricks", perUnit: 500, wastagePercent: 3 },
            { material: "Cement (OPC 53)", perUnit: 1.73, wastagePercent: 2 },
            { material: "River sand", perUnit: 0.24, wastagePercent: 5 },
        ],
    },
    {
        name: "Cement plaster 12 mm 1:6",
        unit: "sqm",
        match: [["plaster", "12mm", "1:6"]],
        lines: [
            { material: "Cement (OPC 53)", perUnit: 0.063, wastagePercent: 5 },
            { material: "River sand", perUnit: 0.013, wastagePercent: 5 },
        ],
    },
    {
        name: "Cement plaster 12 mm 1:4",
        unit: "sqm",
        match: [["plaster", "12mm", "1:4"]],
        lines: [
            { material: "Cement (OPC 53)", perUnit: 0.088, wastagePercent: 5 },
            { material: "River sand", perUnit: 0.012, wastagePercent: 5 },
        ],
    },
    ...[8, 10, 12, 16, 20, 25, 32].flatMap(steel),
];
//# sourceMappingURL=recipes.defaults.js.map