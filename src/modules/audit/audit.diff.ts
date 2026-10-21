export type Changes = Record<string, { from: unknown; to: unknown }>;

const normal = (value: unknown) => (value === undefined ? null : value);

/** 5 and "5" are the same quantity; null and undefined are both "nothing" */
const same = (a: unknown, b: unknown): boolean => {
  const x = normal(a);
  const y = normal(b);
  if (typeof x === "number" || typeof y === "number") return x !== null && y !== null && Number(x) === Number(y);
  return x === y;
};

/** Which of `fields` differ between two versions of a record, as { field: { from, to } } */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, fields: readonly string[]): Changes {
  const changes: Changes = {};
  for (const field of fields) {
    if (!same(before[field], after[field])) changes[field] = { from: normal(before[field]), to: normal(after[field]) };
  }
  return changes;
}

export const hasChanges = (changes: Changes) => Object.keys(changes).length > 0;
