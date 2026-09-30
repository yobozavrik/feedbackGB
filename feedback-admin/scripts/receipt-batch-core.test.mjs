import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBatchArgs, closedDaysDescending, assertAudit } from "./receipt-batch-core.mjs";

test("defaults to read-only and at most three days", () => {
  assert.deepEqual(parseBatchArgs(["--month=2026-08"]),
    { month: "2026-08", maxDays: 3, publish: false });
  assert.deepEqual(parseBatchArgs(["--month=2026-08", "--max-days=2", "--publish"]),
    { month: "2026-08", maxDays: 2, publish: true });
});

test("explicit all-month mode remains read-only unless publish is specified", () => {
  assert.deepEqual(parseBatchArgs(["--month=2026-07", "--all-month"]),
    { month: "2026-07", maxDays: 31, publish: false });
  assert.deepEqual(parseBatchArgs(["--month=2026-07", "--all-month", "--publish"]),
    { month: "2026-07", maxDays: 31, publish: true });
});

test("rejects unlimited, duplicate and unrecognized arguments", () => {
  for (const args of [["--month=2026-08", "--max-days=4"],
    ["--month=2026-08", "--max-days=0"], ["--month=2026-08", "--month=2026-09"],
    ["--month=2025-12"], ["--month=2026-08", "--force"],
    ["--month=2026-08", "--all-month", "--max-days=3"],
    ["--month=2026-08", "--all-month", "--all-month"]]) {
    assert.throws(() => parseBatchArgs(args), /receipt_batch_arguments_invalid/);
  }
});

test("closed days descend and exclude current Kyiv day", () => {
  assert.deepEqual(closedDaysDescending("2026-09", "2026-09-04"),
    ["2026-09-03", "2026-09-02", "2026-09-01"]);
  assert.equal(closedDaysDescending("2026-08", "2026-09-29").length, 31);
});

const audit = { status: "verified", day: "2026-08-20", run_id: "run-id",
  receipts: 2, declared_receipts: 2, lines: 3, declared_lines: 3,
  clients: 1, source_pages: 1, source_items: 2, stores_with_receipts: 1,
  invalid_payloads: 0, page_mismatches: 0, identity_mismatches: 0,
  client_link_errors: 0, duplicate_identities: 0, line_count_mismatches: 0 };

test("accepts only complete matching audit", () => {
  assert.equal(assertAudit(audit, "2026-08-20", "run-id",
    { receiptCount: 2, productLineCount: 3, clientSnapshots: 1, sourcePages: 1 }), "verified");
  assert.equal(assertAudit({ status: "missing", day: "2026-08-19" }, "2026-08-19"), "missing");
  for (const changed of [{ ...audit, receipts: 1 }, { ...audit, invalid_payloads: 1 },
    { ...audit, status: "ambiguous" }, { ...audit, run_id: "another" }]) {
    assert.throws(() => assertAudit(changed, "2026-08-20", "run-id"), /receipt_batch_audit_failed/);
  }
});
