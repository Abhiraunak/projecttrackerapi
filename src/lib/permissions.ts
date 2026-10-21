/**
 * What a person may do. Company-wide: a permission applies to every project.
 * An admin has every permission. Everyone else has exactly the ones an admin ticked for them,
 * and a brand-new account has none (it only sees the welcome page).
 */

export const PERMISSIONS = [
  "project.view",
  "project.manage", // create and edit projects, their work items and money figures
  "project.delete",
  "tasks.progress", // update how much of a work item is done
  "audit.view",
  "materials.view",
  "catalog.manage", // add materials and vendors
  "requirements.create",
  "requirements.order",
  "requirements.delete",
  "stock.receive",
  "stock.issue",
  "stock.reserve",
  "stock.adjust",
  "attendance.view",
  "attendance.write",
  "drawings.use",
  "boq.use",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type MovementKind = "RECEIVED" | "ISSUED" | "RESERVED" | "RELEASED" | "ADJUSTMENT_IN" | "ADJUSTMENT_OUT";

export const isPermission = (value: string): value is Permission => (PERMISSIONS as readonly string[]).includes(value);

export interface RightsHolder {
  role: "USER" | "ADMIN";
  permissions: string[];
}

/** An admin has everything; anyone else has what was ticked (unknown or retired names are ignored) */
export const effectivePermissions = (user: RightsHolder): Permission[] =>
  user.role === "ADMIN" ? [...PERMISSIONS] : PERMISSIONS.filter((p) => user.permissions.includes(p));

/** Each kind of stock entry needs its own right: receiving is not the same as using */
export const MOVEMENT_PERMISSION: Record<MovementKind, Permission> = {
  RECEIVED: "stock.receive",
  ISSUED: "stock.issue",
  RESERVED: "stock.reserve",
  RELEASED: "stock.reserve",
  ADJUSTMENT_IN: "stock.adjust",
  ADJUSTMENT_OUT: "stock.adjust",
};
