import type { RequestHandler } from "express";
import { HttpError } from "./error.js";

/**
 * Feature switches. A new feature ships switched off, so its code can go live before anyone sees it,
 * and can be switched off again in minutes if something is wrong.
 *
 *   FEATURES=projectHub,progress      only these are on
 *   FEATURES=all                      everything is on
 *   (not set)                         everything new is off
 *
 * The web app has the same list in NEXT_PUBLIC_FEATURES. Changing the setting on Render restarts the API;
 * no code is rebuilt.
 */
export const FEATURE_NAMES = ["projectHub", "progress", "materialSheet", "drawingsByProject", "equipment"] as const;
export type Feature = (typeof FEATURE_NAMES)[number];

const isFeature = (v: string): v is Feature => (FEATURE_NAMES as readonly string[]).includes(v);

export function parseFeatures(raw: string | undefined): Set<Feature> {
  const names = (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (names.includes("all")) return new Set(FEATURE_NAMES);
  return new Set(names.filter(isFeature));
}

const ON = parseFeatures(process.env.FEATURES);

export const isOn = (feature: Feature) => ON.has(feature);

/** A switched-off feature's routes answer 404, as if they didn't exist */
export const requireFeature =
  (feature: Feature): RequestHandler =>
  (_req, _res, next) =>
    isOn(feature) ? next() : next(new HttpError(404, "Not found"));
