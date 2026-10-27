/**
 * One CSV cell: quoted when needed, and with a leading apostrophe when it would otherwise start a
 * spreadsheet formula (=, +, -, @, tab, CR), since names and notes come from users.
 */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text with a UTF-8 BOM, so spreadsheet apps read non-ASCII text correctly. */
export const toCsv = (rows: unknown[][]) => `﻿${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}\r\n`;
