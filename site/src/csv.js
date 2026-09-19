// Client-side CSV export. Reporters can pull exactly what the table shows without
// touching GitHub; the full versioned JSON stays the source of record.

const cell = (v) => {
  if (v == null) return "";
  let s = String(v);
  // Names and notes come from outside sources. A text cell that begins like a formula is
  // executed by Excel and Sheets, so it is neutralized; real numbers are left alone.
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows, columns) {
  const head = columns.map((c) => cell(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(c.get(r))).join(","));
  return [head, ...body].join("\r\n") + "\r\n";
}

export function downloadCsv(filename, rows, columns) {
  const blob = new Blob(["﻿" + toCsv(rows, columns)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const stamp = (iso) => (iso || "").slice(0, 10);
