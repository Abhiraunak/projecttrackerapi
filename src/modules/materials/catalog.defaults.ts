/** The materials every new account starts with. They can add their own. */
export const STARTER_MATERIALS = [
  { name: "Cement (OPC 53)", unit: "bag", category: "Binding", minStock: 100 },
  { name: "TMT steel 12 mm", unit: "kg", category: "Steel", minStock: 500 },
  { name: "River sand", unit: "m3", category: "Aggregates", minStock: 10 },
  { name: "Aggregate 20 mm", unit: "m3", category: "Aggregates", minStock: 10 },
  { name: "Red bricks", unit: "nos", category: "Masonry", minStock: 2000 },
  { name: "Vitrified tiles", unit: "m2", category: "Finishes", minStock: 50 },
  { name: "Wall paint", unit: "ltr", category: "Finishes", minStock: 20 },
  { name: "Electrical conduit", unit: "m", category: "Electrical", minStock: 100 },
  { name: "PVC pipe 4 inch", unit: "m", category: "Plumbing", minStock: 30 },
  { name: "Plywood 18 mm", unit: "sheet", category: "Carpentry", minStock: 10 },
] as const;
