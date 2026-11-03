/** What to load with a movement: the material, the BOQ item, the order and who recorded it */
export const movementInclude = {
    material: { select: { id: true, name: true, unit: true } },
    boqItem: { select: { id: true, code: true, title: true } },
    order: { select: { id: true, reference: true } },
    createdBy: { select: { email: true } },
};
export const movementDto = (row) => ({
    id: row.id,
    material: row.material,
    type: row.type,
    quantity: row.quantity.toNumber(),
    boqItem: row.boqItem,
    order: row.order,
    note: row.note,
    date: (row.date ?? row.createdAt).toISOString().slice(0, 10), // older entries have no date: the day they were saved
    vendorName: row.vendorName,
    hasBill: !!row.billId,
    createdAt: row.createdAt,
    createdBy: row.createdBy.email,
});
export const toMaterialInfo = (m) => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    category: m.category,
    minStock: m.minStock.toNumber(),
});
export const toEntry = (row) => ({
    materialId: row.materialId,
    type: row.type,
    quantity: row.quantity.toNumber(),
    itemId: row.boqItemId,
});
export const toItemLabel = (i) => ({ id: i.id, code: i.code, title: i.title, active: i.active });
//# sourceMappingURL=inventory.mapper.js.map