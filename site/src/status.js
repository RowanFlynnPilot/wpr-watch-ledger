// Reader-facing names for the ledger's status values. "unknown" is an agency documented using
// plate readers whose Flock participation is unverified; "never" is one that says it never
// bought or installed Flock cameras, though it can still appear in others' sharing lists.
const LABELS = { unknown: "unverified", never: "no cameras" };

export const statusLabel = (value) => LABELS[value] || value;
