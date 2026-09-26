// Reader-facing dates in AP style, the newsroom's house style: "Sept. 7, 2026", "April 30".
// Data stays ISO everywhere else (tables, CSVs, the JSON files); this is display only.
const AP_MONTHS = ["Jan.", "Feb.", "March", "April", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];

export function apDate(iso, { year = true } = {}) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  const [, y, mo, d] = m;
  return `${AP_MONTHS[Number(mo) - 1]} ${Number(d)}${year ? `, ${y}` : ""}`;
}
