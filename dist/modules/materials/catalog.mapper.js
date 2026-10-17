export const materialDto = (m) => ({
    id: m.id,
    name: m.name,
    unit: m.unit,
    category: m.category,
    minStock: m.minStock.toNumber(),
});
export const vendorDto = (v) => ({
    id: v.id,
    name: v.name,
    contactPerson: v.contactPerson,
    phone: v.phone,
    email: v.email,
});
//# sourceMappingURL=catalog.mapper.js.map