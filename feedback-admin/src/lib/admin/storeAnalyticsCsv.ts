export type CsvCell = string | number | null | undefined;

/** Prevent spreadsheet formula execution for text originating outside the application. */
export function safeCsvCell(value: CsvCell): string {
  let text = value == null ? "" : String(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(headers: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [headers.map(safeCsvCell).join(";"), ...rows.map((row) => row.map(safeCsvCell).join(";"))];
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
