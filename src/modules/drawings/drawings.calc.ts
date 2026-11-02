/**
 * Drawing numbers (A-1.00, S-2.10, E-01…), with no database in them, so they are unit-tested.
 */

/**
 * One way of writing each number, so "a-1.00", "A - 1.00" and " A-1.00 " are the same drawing.
 * Returns null when it isn't a usable number.
 */
export function normalizeNumber(raw: string): string | null {
  const n = raw
    .trim()
    .toUpperCase()
    .replace(/\s*([-/.])\s*/g, "$1") // no spaces around separators
    .replace(/\s+/g, " ");
  return /^[A-Z0-9][A-Z0-9 ./-]{0,23}$/.test(n) ? n : null;
}

/** The series a number belongs to, for grouping the grid: "A-1.00" → "A", "STR-02" → "STR", "101" → "" */
export function seriesOf(number: string): string {
  const m = /^([A-Z]+)(?=[-./ ]|\d)/.exec(number);
  return m ? m[1]! : "";
}

/**
 * Natural order: A-1.00 < A-1.01 < A-1.10 < A-2.00 < A-10.00 < S-1.00.
 * Number parts compare as numbers (so 10 comes after 2), the rest as text.
 */
export function compareNumbers(a: string, b: string): number {
  const pa = a.match(/\d+|[^\d]+/g) ?? [];
  const pb = b.match(/\d+|[^\d]+/g) ?? [];
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i]!;
    const y = pb[i]!;
    const nx = /^\d/.test(x);
    const ny = /^\d/.test(y);
    const d = nx && ny ? Number(x) - Number(y) || x.length - y.length : x.localeCompare(y);
    if (d !== 0) return d;
  }
  return pa.length - pb.length;
}

/** R0 for the first issue, then R1, R2… */
export const revisionLabel = (revision: number) => `R${revision}`;
