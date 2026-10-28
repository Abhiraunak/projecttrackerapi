/**
 * What can happen to a material request, and who may do it. No database: the screens use the same rules
 * (a copy lives in the frontend's lib/inventory/requests.ts) to show only the buttons that will work.
 *
 *   PENDING ──approve──▶ APPROVED ──issue──▶ ISSUED
 *      │                    │ └────order──▶ ORDERED
 *      └─reject / cancel────┴─reject / cancel──▶ REJECTED / CANCELLED
 */

export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "ISSUED" | "ORDERED";
export type RequestAction = "approve" | "reject" | "cancel" | "issue" | "order";

/** The statuses each action may start from */
export const FROM: Record<RequestAction, RequestStatus[]> = {
  approve: ["PENDING"],
  reject: ["PENDING", "APPROVED"],
  cancel: ["PENDING", "APPROVED"],
  issue: ["APPROVED"],
  order: ["APPROVED"],
};

export const TO: Record<RequestAction, RequestStatus> = {
  approve: "APPROVED",
  reject: "REJECTED",
  cancel: "CANCELLED",
  issue: "ISSUED",
  order: "ORDERED",
};

/** The permission each action needs (cancelling your own request needs none) */
export const NEEDS: Record<RequestAction, string> = {
  approve: "requests.approve",
  reject: "requests.approve",
  cancel: "requests.approve",
  issue: "stock.issue",
  order: "requirements.order",
};

export const canStart = (status: RequestStatus, action: RequestAction) => FROM[action].includes(status);

/** The actions this person can take on this request now */
export function actionsFor(status: RequestStatus, who: { isRequester: boolean; can: (permission: string) => boolean }): RequestAction[] {
  return (Object.keys(FROM) as RequestAction[]).filter(
    (action) => canStart(status, action) && (who.can(NEEDS[action]) || (action === "cancel" && who.isRequester))
  );
}

export const isOpen = (status: RequestStatus) => status === "PENDING" || status === "APPROVED";
