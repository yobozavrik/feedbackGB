/** Isolated in-memory PostgreSQL only. Never loads .env, contacts Poster or Supabase.
 * Install the pinned optional runtime under ignored node_modules/.receipt-sql-qa.
 * One connection: NO true concurrent transaction proof. All data are synthetic.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const require = createRequire(resolve("node_modules/.receipt-sql-qa/runtime.cjs"));
const { PGlite } = require("@electric-sql/pglite");
const localRequire = createRequire(import.meta.url);
const ts = localRequire("typescript");
localRequire.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(readFileSync(filename, "utf8"), {
  fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename);
const { buildPosterReceiptBundle, buildPlainPosterReceiptBundle } = localRequire("../src/lib/admin/posterReceiptBundle.ts");
const { decryptReceiptArchive } = localRequire("../src/lib/admin/posterReceiptArchive.ts");
const bulkMode = process.argv.length === 3 && process.argv[2] === "--bulk";
if (process.argv.length > (bulkMode ? 3 : 2)) throw new Error("local_sql_arguments_not_supported");
const db = new PGlite();
const key = randomBytes(32);
const checks = [];
let bulkDurationMs = null;
let stage = "init";
let analyticsDay = null;
async function check(name, action) { stage = name; await action(); checks.push(name); }
async function query(sql, args) { return (await db.query(sql, args)).rows; }
async function expectError(action, expected) {
  try { await action(); } catch (error) {
    assert.ok(error.code === expected || error.message === expected, `unexpected_sql_error_${error.code}`); return;
  }
  assert.fail("expected_sql_error_missing");
}
const bytes = v => Buffer.from(JSON.stringify(v));
let options;
function fixture() {
  const raw = bytes({ response: { count: 2, page: { per_page: 1000, page: 1, count: 2 }, data: [
    { transaction_id: "9007199254740993", spot_id: 1, client_id: 5, date_close: `${options.businessDate} 12:00:00`,
      sum: "-12.50", discount: 35, products: [{ product_id: 1, num: "-0.5" }, { product_id: 1, num: "-0.5" }] },
    { transaction_id: "9007199254740994", spot_id: 2, client_id: 0, date_close: `${options.businessDate} 13:00:00`,
      sum: "0", products: [{ product_id: 2, num: "1" }] },
  ] } });
  const client = bytes({ response: [{ client_id: "5", firstname: "SYNTHETIC", phone: "SYNTHETIC-NOT-A-PHONE", unknown: { retained: true } }] });
  return { raw, client, bundle: buildPosterReceiptBundle(options, [{ bytes: raw }], [{ clientId: "5", bytes: client }]) };
}
const invoke = b => query("select feedbackgb.import_poster_receipt_bundle($1::jsonb) as result", [JSON.stringify(b)]);
try {
  await db.waitReady;
  const version = (await query("select version() as version"))[0].version;
  await check("create_local_roles_schema", () => db.exec("create schema feedbackgb; create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema feedbackgb to anon,authenticated,service_role;"));
  await check("migration_043_executes", () => db.exec(readFileSync("supabase/043_poster_receipt_archive_foundation.sql", "utf8")));
  await check("migration_044_executes", () => db.exec(readFileSync("supabase/044_poster_receipt_atomic_import.sql", "utf8")));
  await check("readback_044_guards", async () => {
    const result = await db.exec(readFileSync("supabase/044_poster_receipt_atomic_import_readback.sql", "utf8"));
    const rb = result[0].rows[0].receipt_atomic_import_readback;
    for (const [name, value] of Object.entries(rb)) assert.equal(value, name === "ingestion_enabled" ? false : true, name);
  });
  await check("staging_smoke_rollback", async () => {
    await db.exec("set feedbackgb.receipt_smoke_environment='staging'");
    await db.exec(readFileSync("supabase/044_poster_receipt_atomic_import_staging_smoke.sql", "utf8"));
    assert.equal((await query("select count(*)::int as n from feedbackgb.poster_receipt_import_runs"))[0].n, 0);
    assert.equal((await query("select enabled from feedbackgb.poster_receipt_ingest_policy"))[0].enabled, false);
  });
  const day = (await query("select ((statement_timestamp() at time zone 'Europe/Kyiv')::date-1)::text as day"))[0].day;
  options = { accountId: "local-synthetic", businessDate: day, verifiedSpotIds: ["1", "2"], observedAt: new Date().toISOString(), keyId: "ephemeral-local", key };
  const f = fixture();
  await check("disabled_policy_rejects_real_encrypted_bundle", () => expectError(() => invoke(f.bundle), "receipt_ingestion_disabled"));
  for (const role of ["anon", "authenticated"]) {
    await check(`${role}_cannot_execute`, async () => {
      await db.exec(`set role ${role}`);
      try { await expectError(() => invoke(f.bundle), "42501"); } finally { await db.exec("reset role"); }
    });
  }
  await check("service_cannot_read_or_insert_tables", async () => {
    await db.exec("set role service_role");
    try {
      await expectError(() => query("select * from feedbackgb.poster_receipt_source_payloads"), "42501");
      await expectError(() => query("insert into feedbackgb.poster_receipt_import_runs(id) values(gen_random_uuid())"), "42501");
    } finally { await db.exec("reset role"); }
  });
  await db.exec("update feedbackgb.poster_receipt_ingest_policy set enabled=true where singleton");
  await check("service_atomic_publish", async () => {
    await db.exec("set role service_role");
    try { assert.equal((await invoke(f.bundle))[0].result.status, "accepted"); } finally { await db.exec("reset role"); }
  });
  await check("exact_receipt_identity_and_repeated_lines", async () => {
    const ids = await query("select transaction_id::text as id from feedbackgb.poster_receipt_identities order by transaction_id");
    assert.deepEqual(ids.map(r => r.id), ["9007199254740993", "9007199254740994"]);
    const lines = await query("select source_line_no,quantity_source from feedbackgb.poster_receipt_line_versions l join feedbackgb.poster_receipt_versions r on r.id=l.receipt_version_id join feedbackgb.poster_receipt_identities i on i.id=r.identity_id where i.transaction_id=9007199254740993 order by source_line_no");
    assert.deepEqual(lines, [{ source_line_no: 1, quantity_source: "-0.5" }, { source_line_no: 2, quantity_source: "-0.5" }]);
  });
  await check("archive_ciphertext_roundtrip_from_postgres", async () => {
    const rows = await query("select id,endpoint,key_id,encode(nonce,'base64') as nonce,encode(auth_tag,'base64') as tag,encode(ciphertext,'base64') as ciphertext from feedbackgb.poster_receipt_source_payloads");
    for (const row of rows) {
      const clear = decryptReceiptArchive({ format: "aes-256-gcm-v1", keyId: row.key_id, nonce: row.nonce.replace(/\n/g, ""), tag: row.tag.replace(/\n/g, ""), ciphertext: row.ciphertext.replace(/\n/g, "") }, { accountId: options.accountId, objectId: row.id, endpoint: row.endpoint }, key);
      assert.deepEqual(clear, row.endpoint === "clients.getClient" ? f.client : f.raw);
    }
  });
  await check("exact_replay_no_duplicates", async () => { assert.equal((await invoke(f.bundle))[0].result.replayed, true); assert.equal((await query("select count(*)::int as n from feedbackgb.poster_receipt_versions"))[0].n, 2); });
  await check("changed_manifest_conflicts", () => expectError(() => invoke({ ...f.bundle, parser_version: "changed" }), "receipt_run_conflict"));
  await check("missing_client_rolls_back_all_rows", async () => {
    const b = fixture().bundle; b.clients = []; b.payloads = b.payloads.filter(p => p.endpoint !== "clients.getClient");
    await expectError(() => invoke(b), "receipt_client_incomplete");
    assert.equal((await query("select count(*)::int as n from feedbackgb.poster_receipt_import_runs where id=$1", [b.run_id]))[0].n, 0);
  });
  await check("invalid_second_line_rolls_back_partial_insert", async () => {
    const b = fixture().bundle; b.receipts[0].lines[1].product_id = "0";
    await expectError(() => invoke(b), "receipt_bundle_invalid");
    for (const table of ["poster_receipt_import_runs", "poster_receipt_versions", "poster_receipt_source_payloads", "poster_client_snapshots"]) {
      const field = table === "poster_receipt_import_runs" ? "id" : "run_id";
      assert.equal((await query(`select count(*)::int as n from feedbackgb.${table} where ${field}=$1`, [b.run_id]))[0].n, 0);
    }
  });
  await check("accepted_run_and_source_are_immutable", async () => {
    await expectError(() => query("update feedbackgb.poster_receipt_import_runs set parser_version='changed' where id=$1", [f.bundle.run_id]), "receipt_accepted_run_immutable");
    await expectError(() => query("delete from feedbackgb.poster_receipt_source_payloads where run_id=$1", [f.bundle.run_id]), "poster_receipt_archive_immutable");
  });
  await check("migration_045_executes_without_rewriting_legacy_rows", async () => {
    await db.exec("update feedbackgb.poster_receipt_ingest_policy set enabled=false where singleton");
    await db.exec(readFileSync("supabase/045_poster_receipt_plaintext_archive.sql", "utf8"));
    if (bulkMode) await db.exec(readFileSync("supabase/046_poster_receipt_bulk_publication.sql", "utf8"));
    const row = (await query("select archive_format,raw_body from feedbackgb.poster_receipt_source_payloads where id=$1", [f.bundle.payloads[0].id]))[0];
    assert.equal(row.archive_format, "aes-256-gcm-v1"); assert.equal(row.raw_body, null);
  });
  await check("readback_045_guards_policy_still_off", async () => {
    const result = await db.exec(readFileSync("supabase/045_poster_receipt_plaintext_readback.sql", "utf8"));
    const rb = result[0].rows[0].receipt_plaintext_readback;
    for (const [name, value] of Object.entries(rb)) {
      if (name === "accepted_runs") assert.equal(Number(value), 1);
      else assert.equal(value, name === "ingestion_enabled" ? false : true, name);
    }
  });
  if (bulkMode) await check("bulk_readback_guards", async () => {
    const result = await db.exec(readFileSync("supabase/046_poster_receipt_bulk_readback.sql", "utf8"));
    for (const [name, value] of Object.entries(result[0].rows[0].receipt_bulk_readback)) {
      if (name === "accepted_runs") assert.equal(Number(value), 1);
      else assert.equal(value, name === "ingestion_enabled" ? false : true, name);
    }
  });
  const plain = buildPlainPosterReceiptBundle(options, [{ bytes: f.raw }], [{ clientId: "5", bytes: f.client }]);
  await check("raw_bundle_blocked_by_policy", () => expectError(() => invoke(plain), "receipt_ingestion_disabled"));
  await db.exec("update feedbackgb.poster_receipt_ingest_policy set enabled=true where singleton");
  await check("raw_service_atomic_publish", async () => {
    await db.exec("set role service_role");
    try { assert.equal((await invoke(plain))[0].result.status, "accepted"); } finally { await db.exec("reset role"); }
  });
  await check("raw_text_byte_exact_roundtrip_and_no_key", async () => {
    const rows = await query("select endpoint,raw_body,key_id,nonce,auth_tag,ciphertext from feedbackgb.poster_receipt_source_payloads where run_id=$1", [plain.run_id]);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.deepEqual(Buffer.from(row.raw_body, "utf8"), row.endpoint === "clients.getClient" ? f.client : f.raw);
      for (const field of ["key_id", "nonce", "auth_tag", "ciphertext"]) assert.equal(row[field], null);
    }
  });
  await check("raw_exact_replay_and_changed_manifest", async () => {
    assert.equal((await invoke(plain))[0].result.replayed, true);
    await expectError(() => invoke({ ...plain, parser_version: "changed" }), "receipt_run_conflict");
  });
  await check("raw_changed_hash_rolls_back_all", async () => {
    const b = buildPlainPosterReceiptBundle(options, [{ bytes: f.raw }], [{ clientId: "5", bytes: f.client }]);
    b.payloads[0].source_sha256 = "0".repeat(64);
    await expectError(() => invoke(b), "receipt_bundle_invalid");
    assert.equal((await query("select count(*)::int as n from feedbackgb.poster_receipt_import_runs where id=$1", [b.run_id]))[0].n, 0);
  });
  await check("raw_mixed_storage_rejected", async () => {
    const b = buildPlainPosterReceiptBundle(options, [{ bytes: f.raw }], [{ clientId: "5", bytes: f.client }]);
    b.payloads[0].key_id = "invalid-mix";
    await expectError(() => invoke(b), "receipt_bundle_invalid");
  });
  for (const testCase of ["missing_client", "invalid_line", "unknown_spot", "wrong_row", "private_projection"]) {
    await check(`raw_${testCase}_atomic_rollback`, async () => {
      const b = buildPlainPosterReceiptBundle(options, [{ bytes: f.raw }], [{ clientId: "5", bytes: f.client }]);
      const expected = { missing_client: "receipt_client_incomplete", invalid_line: "receipt_bundle_invalid",
        unknown_spot: "receipt_unknown_spot", wrong_row: "receipt_bundle_incomplete", private_projection: "receipt_bundle_invalid" };
      if (testCase === "missing_client") { b.clients = []; b.payloads = b.payloads.filter(p => p.endpoint !== "clients.getClient"); }
      if (testCase === "invalid_line") b.receipts[0].lines[1].product_id = "0";
      if (testCase === "unknown_spot") b.receipts[0].spot_id = "99";
      if (testCase === "wrong_row") b.receipts[0].source_row_no = 99;
      if (testCase === "private_projection") b.receipts[0].projection.raw_body = "SYNTHETIC PRIVATE";
      await expectError(() => invoke(b), expected[testCase]);
      for (const table of ["poster_receipt_import_runs", "poster_receipt_versions", "poster_receipt_source_payloads", "poster_client_snapshots"]) {
        const field = table === "poster_receipt_import_runs" ? "id" : "run_id";
        assert.equal((await query(`select count(*)::int as n from feedbackgb.${table} where ${field}=$1`, [b.run_id]))[0].n, 0);
      }
    });
  }
  await check("raw_immutability_and_access_denied", async () => {
    await expectError(() => query("update feedbackgb.poster_receipt_source_payloads set raw_body='{}' where run_id=$1", [plain.run_id]), "poster_receipt_archive_immutable");
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`set role ${role}`);
      try { await expectError(() => query("select raw_body from feedbackgb.poster_receipt_source_payloads"), "42501"); }
      finally { await db.exec("reset role"); }
    }
  });
  await check("day_verification_matches_all_synthetic_raw_fields", async () => {
    const sql = readFileSync("supabase/045_poster_receipt_day_verification.sql", "utf8").replaceAll("2026-09-28", day);
    const result = await db.exec(sql);
    const value = result[0].rows[0].receipt_day_verification;
    assert.equal(value.accepted_run_found, true);
    assert.equal(Number(value.actual_receipts), 2);
    assert.equal(Number(value.actual_product_lines), 3);
    assert.equal(Number(value.client_snapshots), 1);
    for (const [name, n] of Object.entries(value)) {
      if (/mismatches|errors|duplicate_receipt/.test(name)) assert.equal(Number(n), 0, name);
    }
  });
  await check("migration_048_and_054_execute", async () => {
    await db.exec(readFileSync("supabase/048_poster_receipt_day_audit_rpc.sql", "utf8"));
    await db.exec(readFileSync("supabase/054_poster_receipt_analytics_projection.sql", "utf8"));
  });
  await check("receipt_analytics_projection_trigger_and_methodology", async () => {
    analyticsDay = (await query("select ($1::date-1)::text as day", [day]))[0].day;
    const analyticsRaw = bytes({ response: { count: 2,
      page: { per_page: 1000, page: 1, count: 2 }, data: [
        { transaction_id: "9007199254741001", spot_id: 1, client_id: 0,
          date_close: `${analyticsDay} 12:00:00`, sum: "100.25", payed_sum: "100.25",
          reason: 0, print_fiscal: 1, products: [
            { product_id: 1, modification_id: 0, num: "1", payed_sum: "40.25" },
            { product_id: 2, modification_id: 0, num: "0.5", payed_sum: "60.00" },
          ] },
        { transaction_id: "9007199254741002", spot_id: 2, client_id: 0,
          date_close: `${analyticsDay} 13:00:00`, sum: "20.00", payed_sum: "20.00",
          reason: 0, print_fiscal: 2,
          products: [{ product_id: 3, modification_id: 0, num: "1", payed_sum: "20.00" }] },
      ] } });
    const analyticsBundle = buildPlainPosterReceiptBundle({ ...options,
      accountId: "local-synthetic-analytics", businessDate: analyticsDay,
      observedAt: new Date().toISOString() }, [{ bytes: analyticsRaw }], []);
    await db.exec("set role service_role");
    try { assert.equal((await invoke(analyticsBundle))[0].result.status, "accepted"); }
    finally { await db.exec("reset role"); }
    const audit = (await query("select feedbackgb.audit_poster_receipt_analytics_day($1::date) as value", [analyticsDay]))[0].value;
    assert.equal(audit.status, "verified");
    assert.equal(Number(audit.receipts), 2);
    assert.equal(Number(audit.lines), 3);
    assert.equal(Number(audit.eligible_receipts), 1);
    assert.equal(Number(audit.fiscal_returns), 1);
    assert.equal(audit.paid_minor_total, "12025");
    assert.equal(audit.eligible_paid_minor, "10025");
    assert.equal((await query("select count(*)::int as n from feedbackgb.v_poster_receipt_product_bridge"))[0].n, 2);
  });
  await check("receipt_analytics_projection_replay_and_acl", async () => {
    await db.exec("set role service_role");
    try {
      const replay = (await query("select feedbackgb.project_poster_receipt_analytics_day($1::date) as value", [analyticsDay]))[0].value;
      assert.equal(replay.replayed, true);
      await expectError(() => query("select * from feedbackgb.poster_receipt_analytics_facts"), "42501");
    } finally { await db.exec("reset role"); }
    await expectError(() => query("delete from feedbackgb.poster_receipt_analytics_facts"), "poster_receipt_archive_immutable");
  });
  await check("migration_055_executes_with_verified_sources", async () => {
    await db.exec(`
      create view feedbackgb.v_stores as
      select id::bigint id, true is_active from (values (1),(2)) stores(id);

      create function feedbackgb._store_analytics_latest_facts(
        p_from date, p_to date, p_spot_ids bigint[], p_as_of timestamptz
      ) returns table (
        business_date date, spot_id bigint, source_row_no integer,
        product_id bigint, modification_id bigint, category_id bigint,
        product_name text, category_name text, quantity numeric, unit text,
        weight_based boolean, revenue_minor bigint, profit_minor bigint
      ) language sql stable security definer set search_path=feedbackgb,pg_temp as $$
        select p_from, valueset.spot_id, valueset.source_row_no,
          valueset.product_id, 0::bigint, valueset.category_id,
          valueset.product_name, valueset.category_name, 1::numeric, 'шт'::text,
          false, valueset.revenue_minor, valueset.revenue_minor
        from (values
          (1::bigint,1,1::bigint,10::bigint,'Product 1'::text,'Category 10'::text,4025::bigint),
          (1::bigint,2,2::bigint,20::bigint,'Product 2'::text,'Category 20'::text,6000::bigint),
          (2::bigint,1,3::bigint,30::bigint,'Return product'::text,'Category 30'::text,2000::bigint)
        ) valueset(spot_id,source_row_no,product_id,category_id,product_name,category_name,revenue_minor)
        where valueset.spot_id=any(p_spot_ids) and p_from<=p_to and p_as_of is not null
      $$;
    `);
    await db.exec(readFileSync("supabase/055_store_penetration_analytics.sql", "utf8"));
  });
  await check("store_penetration_denominator_mapping_and_acl", async () => {
    await db.exec("set role service_role");
    try {
      const value = (await query(
        "select feedbackgb.read_store_penetration_analytics($1::date,$1::date,array[1,2]::bigint[],clock_timestamp(),10) as value",
        [analyticsDay],
      ))[0].value;
      assert.equal(value.status, "complete");
      assert.equal(Number(value.denominator.eligibleReceipts), 1);
      assert.equal(value.mapping.status, "complete");
      assert.equal(Number(value.mapping.bridgeRows), 2);
      assert.equal(Number(value.mapping.unmappedRows), 0);
      assert.equal(value.categories.length, 2);
      assert.equal(value.products.length, 1);
      assert.equal(value.stores.length, 2);
      assert.equal(value.trend.length, 1);
      assert.equal(Number(value.categories.find(row => Number(row.categoryId) === 10).receiptCount), 1);
      assert.equal(Number(value.stores.find(row => Number(row.spotId) === 1).eligibleReceipts), 1);
      assert.equal(Number(value.stores.find(row => Number(row.spotId) === 2).eligibleReceipts), 0);
    } finally { await db.exec("reset role"); }
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await expectError(() => query(
          "select feedbackgb.read_store_penetration_analytics($1::date,$1::date,array[1,2]::bigint[],clock_timestamp(),10)",
          [analyticsDay],
        ), "42501");
      } finally { await db.exec("reset role"); }
    }
  });
  await check("store_penetration_fails_closed_for_coverage_and_mapping", async () => {
    const incomplete = (await query(
      "select feedbackgb.read_store_penetration_analytics(($1::date-1),$1::date,array[1,2]::bigint[],clock_timestamp(),10) as value",
      [analyticsDay],
    ))[0].value;
    assert.equal(incomplete.status, "incomplete");
    assert.equal(incomplete.denominator.eligibleReceipts, null);
    assert.deepEqual(incomplete.categories, []);

    await db.exec(`
      create or replace function feedbackgb._store_analytics_latest_facts(
        p_from date, p_to date, p_spot_ids bigint[], p_as_of timestamptz
      ) returns table (
        business_date date, spot_id bigint, source_row_no integer,
        product_id bigint, modification_id bigint, category_id bigint,
        product_name text, category_name text, quantity numeric, unit text,
        weight_based boolean, revenue_minor bigint, profit_minor bigint
      ) language sql stable security definer set search_path=feedbackgb,pg_temp as $$
        select p_from,1::bigint,1,1::bigint,0::bigint,10::bigint,
          'Product 1'::text,'Category 10'::text,1::numeric,'шт'::text,false,
          4025::bigint,4025::bigint
        where 1=any(p_spot_ids) and p_from<=p_to and p_as_of is not null
      $$;
    `);
    const unmapped = (await query(
      "select feedbackgb.read_store_penetration_analytics($1::date,$1::date,array[1,2]::bigint[],clock_timestamp(),10) as value",
      [analyticsDay],
    ))[0].value;
    assert.equal(unmapped.status, "mapping_incomplete");
    assert.equal(Number(unmapped.mapping.unmappedRows), 1);
    assert.deepEqual(unmapped.categories, []);
    assert.deepEqual(unmapped.products, []);
    assert.deepEqual(unmapped.stores, []);
    assert.deepEqual(unmapped.trend, []);
  });
  if (bulkMode) {
    await check("bulk_full_size_synthetic_day_no_partial_chunks", async () => {
      const receipts = Array.from({ length: 2188 }, (_, index) => ({
        transaction_id: String(100000 + index), spot_id: index % 26 + 1, client_id: index % 618 + 1,
        date_close: `${day} 12:00:00`, sum: "100.00", payed_sum: "100.00", payed_cash: "100.00", discount: 0,
        unknown_metadata: "synthetic-metadata.".repeat(45),
        products: Array.from({ length: index < 248 ? 3 : 2 }, () => ({ product_id: 1, num: "1.250", product_sum: "25.00", product_cost: "10.00" })),
      }));
      const pages = [0, 1, 2].map(index => {
        const data = receipts.slice(index * 1000, (index + 1) * 1000);
        return { bytes: bytes({ response: { count: receipts.length, page: { page: index + 1, per_page: 1000, count: data.length }, data } }) };
      });
      const clients = Array.from({ length: 618 }, (_, index) => ({ clientId: String(index + 1),
        bytes: bytes({ response: [{ client_id: String(index + 1), firstname: "SYNTHETIC", phone: "NOT-A-PHONE", unknown_metadata: "synthetic-client.".repeat(75) }] }) }));
      const b = buildPlainPosterReceiptBundle({ ...options, accountId: "local-synthetic-large",
        verifiedSpotIds: Array.from({ length: 26 }, (_, i) => String(i + 1)) }, pages, clients);
      const started = Date.now();
      await db.exec("set role service_role");
      try { assert.equal((await invoke(b))[0].result.status, "accepted"); } finally { await db.exec("reset role"); }
      bulkDurationMs = Date.now() - started;
      const result = (await query("select (select count(*) from feedbackgb.poster_receipt_versions where run_id=$1)::int as receipts,(select count(*) from feedbackgb.poster_receipt_line_versions l join feedbackgb.poster_receipt_versions r on r.id=l.receipt_version_id where r.run_id=$1)::int as lines,(select count(*) from feedbackgb.poster_client_snapshots where run_id=$1)::int as clients", [b.run_id]))[0];
      assert.deepEqual(result, { receipts: 2188, lines: 4624, clients: 618 });
      assert.equal((await invoke(b))[0].result.replayed, true);
    });
  }
  console.log(JSON.stringify({ status: "passed", engine: version, runtimePackage: "@electric-sql/pglite@0.5.8", localOnly: true,
    checks, bulkMode, bulkDurationMs, limits: ["One exclusive connection: concurrent transactions NOT tested", "Engine version may differ from production PostgreSQL15.8", "Synthetic clients/receipts only, no live API/storage", "No Supabase writes or policy changes", "No external environment/key loaded"] }, null, 2));
} catch (error) {
  console.log(JSON.stringify({ status: "failed", localOnly: true, stage, sqlState: error?.code ?? null,
    code: "receipt_local_sql_check_failed", safeMessage: error?.message?.startsWith("receipt_") ? error.message : null, checks }));
  process.exitCode = 1;
} finally { key.fill(0); await db.close(); }
