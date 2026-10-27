const normal = (value) => (value === undefined ? null : value);
/** 5 and "5" are the same quantity; null and undefined are both "nothing" */
const same = (a, b) => {
    const x = normal(a);
    const y = normal(b);
    if (typeof x === "number" || typeof y === "number")
        return x !== null && y !== null && Number(x) === Number(y);
    return x === y;
};
/** Which of `fields` differ between two versions of a record, as { field: { from, to } } */
export function diffFields(before, after, fields) {
    const changes = {};
    for (const field of fields) {
        if (!same(before[field], after[field]))
            changes[field] = { from: normal(before[field]), to: normal(after[field]) };
    }
    return changes;
}
export const hasChanges = (changes) => Object.keys(changes).length > 0;
//# sourceMappingURL=audit.diff.js.map