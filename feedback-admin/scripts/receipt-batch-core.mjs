/** Pure guards for the resumable Poster receipt batch runner. */
export function parseBatchArgs(args) {
  const values = new Map();
  for (const arg of args) {
    if (arg === "--publish" || arg === "--all-month") {
      const key = arg.slice(2);
      if (values.has(key)) throw new Error("receipt_batch_arguments_invalid");
      values.set(key, true);
      continue;
    }
    const match = /^--(month|max-days)=(.+)$/.exec(arg);
    if (!match || values.has(match[1])) throw new Error("receipt_batch_arguments_invalid");
    values.set(match[1], match[2]);
  }
  const month = values.get("month"), allMonth = values.get("all-month") === true;
  if (allMonth && values.has("max-days")) throw new Error("receipt_batch_arguments_invalid");
  const maxDays = allMonth ? 31 : Number(values.get("max-days") ?? "3");
  if (!/^2026-(0[1-9]|1[0-2])$/.test(month ?? "") ||
      month < "2026-01" || !Number.isInteger(maxDays) || maxDays < 1 ||
      (!allMonth && maxDays > 3)) {
    throw new Error("receipt_batch_arguments_invalid");
  }
  return { month, maxDays, publish: values.get("publish") === true };
}

export function closedDaysDescending(month, todayKyiv) {
  const [year, number] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const result = [];
  for (let day = last; day >= 1; day--) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (date < todayKyiv) result.push(date);
  }
  return result;
}

export function assertAudit(value, day, runId = null, expected = null) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.day !== day) {
    throw new Error("receipt_batch_audit_invalid");
  }
  if (value.status === "missing" && !runId) return "missing";
  if (value.status !== "verified" || typeof value.run_id !== "string" ||
      (runId && value.run_id !== runId)) throw new Error("receipt_batch_audit_failed");
  for (const key of ["receipts", "declared_receipts", "lines", "declared_lines", "clients",
    "source_pages", "source_items", "stores_with_receipts", "invalid_payloads",
    "page_mismatches", "identity_mismatches", "client_link_errors",
    "duplicate_identities", "line_count_mismatches"]) {
    if (!Number.isSafeInteger(Number(value[key])) || Number(value[key]) < 0) {
      throw new Error("receipt_batch_audit_invalid");
    }
  }
  if (Number(value.receipts) !== Number(value.declared_receipts) ||
      Number(value.lines) !== Number(value.declared_lines) ||
      Number(value.source_items) !== Number(value.receipts) ||
      ["invalid_payloads", "page_mismatches", "identity_mismatches",
        "client_link_errors", "duplicate_identities", "line_count_mismatches"]
        .some(key => Number(value[key]) !== 0)) throw new Error("receipt_batch_audit_failed");
  if (expected && (Number(value.receipts) !== expected.receiptCount ||
      Number(value.lines) !== expected.productLineCount ||
      Number(value.clients) !== expected.clientSnapshots ||
      Number(value.source_pages) !== expected.sourcePages)) {
    throw new Error("receipt_batch_audit_failed");
  }
  return "verified";
}
