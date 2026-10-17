/** What to load with a movement: the material, the work item and who recorded it */
export const movementInclude = {
    material: { select: { id: true, name: true, unit: true } },
    task: { select: { id: true, work: true } },
    createdBy: { select: { email: true } },
};
/** Database row -> the JSON the frontend expects */
export const movementDto = (row) => ({
    id: row.id,
    material: row.material,
    type: row.type,
    quantity: row.quantity.toNumber(),
    task: row.task ? { id: row.task.id, name: row.task.work } : null,
    requirementId: row.requirementId,
    note: row.note,
    createdAt: row.createdAt,
    createdBy: row.createdBy.email,
});
/* Database rows -> the plain numbers the stock rules work with */
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
    taskId: row.taskId,
});
export const toFigures = (r) => ({
    materialId: r.materialId,
    taskId: r.taskId,
    requiredQty: r.requiredQty.toNumber(),
    wastagePercent: r.wastagePercent.toNumber(),
    orderedQty: r.orderedQty.toNumber(),
    receivedQty: r.receivedQty.toNumber(),
});
//# sourceMappingURL=inventory.mapper.js.map