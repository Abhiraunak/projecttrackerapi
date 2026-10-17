import { Material, Vendor } from "../../generated/prisma/client.js";


export const materialDto = (m: Material) => ({
  id: m.id,
  name: m.name,
  unit: m.unit,
  category: m.category,
  minStock: m.minStock.toNumber(),
});

export const vendorDto = (v: Vendor) => ({
  id: v.id,
  name: v.name,
  contactPerson: v.contactPerson,
  phone: v.phone,
  email: v.email,
});
