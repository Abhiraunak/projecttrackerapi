import { toDay } from "../../lib/dates.js";
import { materialDto, vendorDto } from "../materials/catalog.mapper.js";
/** What to load with a requirement: its work item, material and vendor */
export const requirementInclude = {
    task: { select: { id: true, work: true } },
    material: true,
    vendor: true,
};
/** Database row -> the JSON the frontend expects */
export const requirementDto = (r) => ({
    id: r.id,
    task: { id: r.task.id, name: r.task.work },
    material: materialDto(r.material),
    requiredQty: r.requiredQty.toNumber(),
    wastagePercent: r.wastagePercent.toNumber(),
    vendor: r.vendor ? vendorDto(r.vendor) : null,
    orderedQty: r.orderedQty.toNumber(),
    receivedQty: r.receivedQty.toNumber(),
    expectedDelivery: r.expectedDelivery ? toDay(r.expectedDelivery) : null,
    requested: r.requested,
});
//# sourceMappingURL=requirements.mapper.js.map