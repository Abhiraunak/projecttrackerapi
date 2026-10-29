/**
 * Turning BOQs into a material plan, with no database in it (easy to test):
 *  - boqOutline:    a BOQ's sheets, sections and items with their priced parts (for Import from BOQ)
 *  - boqParts:      every priced part of a BOQ, with its quantity, as a "BOQ item"
 *  - pickParts:     what importing the ticked parts of a BOQ adds or brings back
 *  - planSync:      what a sync from the BOQs would add, change or remove in the project's items
 *  - suggestRecipe: the starter or company recipe that best fits an item (PCC 1:2:4, 12mm TMT ...)
 *  - requiredQty:   how much of a material an item needs
 */
import { partQty, type BoqDocument } from "../boqs/boq.calc.js";

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const shorten = (s: string, max: number) => {
  const t = squash(s);
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

/* ------------------------------- BOQ parts -------------------------------- */

export interface BoqPartRow {
  boqId: string;
  partKey: string; // the part's id inside the BOQ document: stays the same across edits
  sheetName: string;
  code: string; // "5.5.5 (a)"
  title: string; // short, for lists
  matchText: string; // the words recipes are matched against
  contextText: string; // the item's description and its other parts' words: a second chance for matching
  unit: string;
  quantity: number;
  position: number; // order within the project's plan
}

export interface OutlineItem {
  code: string;
  description: string;
  parts: BoqPartRow[]; // its priced parts (most items have one)
}
export interface OutlineSection {
  code: string;
  title: string;
  items: OutlineItem[];
}
export interface OutlineSheet {
  name: string;
  sections: OutlineSection[];
}

/**
 * The BOQ as sheets, sections and items, each item with its priced parts: what "Import from BOQ" lets people tick.
 * Only completely blank parts are skipped (no quantity, unit or description); then items with no parts and sections
 * with no items.
 */
export function boqOutline(boqId: string, doc: BoqDocument, startPosition = 0): OutlineSheet[] {
  let position = startPosition;
  const sheets: OutlineSheet[] = [];
  for (const sheet of doc.sheets) {
    const sheetName = squash(sheet.name || sheet.title);
    const sections: OutlineSection[] = [];
    for (const section of sheet.sections) {
      const items: OutlineItem[] = [];
      for (const entry of section.entries) {
        if (entry.kind !== "item") continue;
        // Parts of one item often share a mix named only once (the first part says "1:2:4", the others say nothing)
        const context = squash([entry.description, ...entry.parts.map((p) => p.description)].join(" "));
        const parts: BoqPartRow[] = [];
        for (const part of entry.parts) {
          const quantity = round3(partQty(part));
          const own = squash(part.description);
          // Skip only a completely blank part. A part still waiting for its quantity or unit is kept, so it can be
          // imported now and picks up its quantity on the next sync.
          if (quantity === 0 && !part.unit.trim() && !own && !squash(entry.description)) continue;
          parts.push({
            boqId,
            partKey: part.id,
            sheetName,
            code: squash([entry.code, part.code].filter(Boolean).join(" ")),
            title: own ? `${shorten(entry.description, 70)} · ${shorten(own, 60)}` : shorten(entry.description, 130) || "Untitled item",
            matchText: own || squash(entry.description),
            contextText: context,
            unit: squash(part.unit),
            quantity,
            position: position++,
          });
        }
        if (parts.length) items.push({ code: squash(entry.code), description: shorten(entry.description, 200), parts });
      }
      if (items.length) sections.push({ code: squash(section.code), title: squash(section.title), items });
    }
    if (sections.length) sheets.push({ name: sheetName, sections });
  }
  return sheets;
}

/** Every priced part of the BOQ, in reading order */
export const boqParts = (boqId: string, doc: BoqDocument, startPosition = 0): BoqPartRow[] =>
  boqOutline(boqId, doc, startPosition).flatMap((sheet) => sheet.sections.flatMap((section) => section.items.flatMap((item) => item.parts)));

/* --------------------------------- sync ----------------------------------- */

export interface ExistingItem {
  id: string;
  boqId: string | null; // null once its BOQ was deleted: then it can only be "removed"
  partKey: string;
  code: string;
  title: string;
  unit: string;
  quantity: number;
  active: boolean;
}

export type ChangedField = "quantity" | "unit" | "code" | "title" | "restored";

export interface SyncPlan {
  added: BoqPartRow[];
  changed: { item: ExistingItem; part: BoqPartRow; fields: ChangedField[] }[];
  removed: ExistingItem[]; // no longer in any of the project's BOQs: kept, but marked removed
  unchanged: number;
}

const keyOf = (x: { boqId: string | null; partKey: string }) => `${x.boqId ?? "none"}:${x.partKey}`;

/** Compares the project's BOQ items with what its BOQs say now. Positions alone never count as a change. */
export function planSync(existing: ExistingItem[], parts: BoqPartRow[]): SyncPlan {
  const byKey = new Map(existing.map((item) => [keyOf(item), item]));
  const plan: SyncPlan = { added: [], changed: [], removed: [], unchanged: 0 };
  const seen = new Set<string>();

  for (const part of parts) {
    const key = keyOf(part);
    seen.add(key);
    const item = byKey.get(key);
    if (!item) {
      plan.added.push(part);
      continue;
    }
    const fields: ChangedField[] = [];
    if (!item.active) fields.push("restored");
    if (round3(item.quantity) !== part.quantity) fields.push("quantity");
    if (item.unit !== part.unit) fields.push("unit");
    if (item.code !== part.code) fields.push("code");
    if (item.title !== part.title) fields.push("title");
    if (fields.length) plan.changed.push({ item, part, fields });
    else plan.unchanged++;
  }
  for (const item of existing) {
    if (item.active && !seen.has(keyOf(item))) plan.removed.push(item);
  }
  return plan;
}

/**
 * A sync only updates what is already in the plan: changed quantities, and items that left the BOQ. New BOQ items
 * are not added by a sync; they come in through "Import from BOQ", where people tick the ones they want.
 */
export const hasSyncWork = (plan: SyncPlan) => plan.changed.length + plan.removed.length > 0;

/* -------------------------------- import ---------------------------------- */

export interface ImportPick {
  create: BoqPartRow[]; // not in the plan yet
  restore: { item: ExistingItem; part: BoqPartRow }[]; // in the plan but marked removed: brought back
  already: number; // ticked but already in the plan
  unknown: number; // not (or no longer) a priced part of this BOQ
}

/** What importing the ticked parts of one BOQ does, given the project's plan */
export function pickParts(parts: BoqPartRow[], existing: ExistingItem[], boqId: string, partKeys: string[]): ImportPick {
  const wanted = new Set(partKeys);
  const byKey = new Map(existing.filter((i) => i.boqId === boqId).map((i) => [i.partKey, i]));
  const pick: ImportPick = { create: [], restore: [], already: 0, unknown: 0 };
  const found = new Set<string>();
  for (const part of parts) {
    if (part.boqId !== boqId || !wanted.has(part.partKey)) continue;
    found.add(part.partKey);
    const item = byKey.get(part.partKey);
    if (!item) pick.create.push(part);
    else if (!item.active) pick.restore.push({ item, part });
    else pick.already++;
  }
  pick.unknown = wanted.size - found.size;
  return pick;
}

/* -------------------------------- recipes --------------------------------- */

export interface RecipeLine {
  materialId: string;
  perUnit: number; // material per 1 unit of the BOQ item
  wastagePercent: number;
}

export interface Recipe {
  id: string;
  name: string;
  unit: string; // the BOQ unit it applies to
  /** Any one of these groups must match; within a group, every word or phrase must appear */
  match: string[][];
  lines: RecipeLine[];
}

/** cum, cu.m, m3 and m³ are the same unit; so are sqm, sq.m and m2; mt, t and tonne */
const UNIT_ALIASES: Record<string, string> = {
  cum: "m3", "cu.m": "m3", "cu m": "m3", cumt: "m3", "m³": "m3", m3: "m3",
  sqm: "m2", "sq.m": "m2", "sq m": "m2", "m²": "m2", m2: "m2",
  mt: "t", t: "t", tonne: "t", ton: "t", tonnes: "t", ton_: "t",
  kg: "kg", kgs: "kg",
  rm: "m", rmt: "m", m: "m",
  nos: "nos", no: "nos", "no.": "nos", each: "nos",
};
export const normalUnit = (unit: string) => {
  const u = unit.toLowerCase().replace(/\s+/g, " ").trim();
  return UNIT_ALIASES[u] ?? u;
};

/** Lower case, single spaces, and "10 mm" written "10mm", so phrases match however the BOQ was typed */
export const normalText = (s: string) =>
  ` ${s.toLowerCase().replace(/(\d)\s+mm\b/g, "$1mm").replace(/[^a-z0-9.:/]+/g, " ").replace(/\s+/g, " ").trim()} `;

/** Every word or phrase of the group appears as a whole word in the text */
const groupMatches = (text: string, group: string[]) => group.every((word) => text.includes(` ${normalText(word).trim()} `));

function bestIn(text: string, unit: string, recipes: Recipe[]): Recipe | null {
  let best: Recipe | null = null;
  let bestScore = 0;
  for (const recipe of recipes) {
    if (normalUnit(recipe.unit) !== unit) continue;
    for (const group of recipe.match) {
      if (group.length > bestScore && groupMatches(text, group)) {
        best = recipe;
        bestScore = group.length;
      }
    }
  }
  return best;
}

/**
 * The recipe that best fits a BOQ item: same unit, and the most specific matching group wins.
 * The part's own words are tried first (a "10mm TMT" part under an item listing every bar size),
 * then the item's description.
 */
export function suggestRecipe(part: Pick<BoqPartRow, "matchText" | "contextText" | "unit">, recipes: Recipe[]): Recipe | null {
  const unit = normalUnit(part.unit);
  return bestIn(normalText(part.matchText), unit, recipes) ?? bestIn(normalText(part.contextText), unit, recipes);
}

/* ------------------------------ requirement ------------------------------- */

/** Item quantity × material per unit, plus wastage */
export const requiredQty = (itemQuantity: number, line: Pick<RecipeLine, "perUnit" | "wastagePercent">) =>
  round3(itemQuantity * line.perUnit * (1 + line.wastagePercent / 100));
