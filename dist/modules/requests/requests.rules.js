/**
 * What can happen to a material request, and who may do it. No database: the screens use the same rules
 * (a copy lives in the frontend's lib/inventory/requests.ts) to show only the buttons that will work.
 *
 *   PENDING ──approve──▶ APPROVED ──issue──▶ ISSUED
 *      │                    │ └────order──▶ ORDERED
 *      └─reject / cancel────┴─reject / cancel──▶ REJECTED / CANCELLED
 */
/** The statuses each action may start from */
export const FROM = {
    approve: ["PENDING"],
    reject: ["PENDING", "APPROVED"],
    cancel: ["PENDING", "APPROVED"],
    issue: ["APPROVED"],
    order: ["APPROVED"],
};
export const TO = {
    approve: "APPROVED",
    reject: "REJECTED",
    cancel: "CANCELLED",
    issue: "ISSUED",
    order: "ORDERED",
};
/** The permission each action needs (cancelling your own request needs none) */
export const NEEDS = {
    approve: "requests.approve",
    reject: "requests.approve",
    cancel: "requests.approve",
    issue: "stock.issue",
    order: "requirements.order",
};
export const canStart = (status, action) => FROM[action].includes(status);
/** The actions this person can take on this request now */
export function actionsFor(status, who) {
    return Object.keys(FROM).filter((action) => canStart(status, action) && (who.can(NEEDS[action]) || (action === "cancel" && who.isRequester)));
}
export const isOpen = (status) => status === "PENDING" || status === "APPROVED";
//# sourceMappingURL=requests.rules.js.map