# Store analytics S-14 performance evidence — 2026-10-01

## Scope

- source: working Supabase through service-role PostgREST RPC;
- fixed complete period: `2026-09-16` — `2026-09-22`;
- current roster loaded from `feedbackgb.v_stores`: 26 stores;
- a single fixed `asOf` was used inside every benchmark run;
- raw receipts, customer payloads, credentials and business row contents were not logged;
- these numbers measure PostgREST RPC, not the protected Next.js routes or browser meaningful-state.

## Read-only run

Command:

```powershell
npm.cmd run benchmark:store-analytics
```

`asOf=2026-10-01T14:30:16.276Z`, 20 sequential warm samples and 20 concurrent readers.

| Reader | First request | Warm p50 | Warm p95 | 20 readers p50 | 20 readers p95 | Max | Raw | Gzip |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| overview | 1170.4 ms | 124.8 ms | 166.0 ms | 471.7 ms | 542.0 ms | 553.5 ms | 5,360 B | 1,531 B |
| category/product | 454.1 ms | 199.7 ms | 221.4 ms | 640.2 ms | 912.6 ms | 917.6 ms | 26,844 B | 3,108 B |
| penetration | 1036.5 ms | 600.7 ms | 625.8 ms | 1791.7 ms | 2348.0 ms | 2556.5 ms | 21,580 B | 3,461 B |

Payload byte pairs remained stable across samples because `asOf` and scope were fixed.
The proposed compressed-payload budget of 250 KB is passed for all three RPC responses.
The proposed p95 ≤2 s budget is passed for sequential warm requests, but penetration exceeds
2 s under 20-reader concurrency.

## Twenty readers plus projection replay

Command:

```powershell
npm.cmd run benchmark:store-analytics -- --runs=5 --concurrency=20 --sync-day=2026-09-16
```

`asOf=2026-10-01T14:30:53.103Z`. The projection RPC returned `status=projected` and
`replayed=true`; therefore no new analytics facts were inserted.

```text
projection replay: 1300.3 ms
penetration reader p50: 1829.2 ms
penetration reader p95: 2778.0 ms
penetration reader max: 2842.0 ms
```

## Protected route and browser check

The authenticated local admin page was opened at:

```text
/admin/stores?tab=analytics&view=overview&period=custom&from=2026-09-16&to=2026-09-22
```

The rendered view showed the same complete-period evidence as the reader response:

- revenue `4,852,512.28 UAH`;
- Poster food cost `39.69%`;
- `15,700` receipts;
- sales coverage `182/182` and receipt coverage `7/7`;
- store ranking with revenue and food-cost values.

The browser console contained no warnings or errors. Five repeated local-development
navigations reached the revenue KPI and `182/182` coverage marker in `3677`, `3514`,
`3470`, `3297` and `3353` ms (p50 `3470` ms; observed p95 `3677` ms). This is a
development-server measurement and includes browser automation/accessibility polling; it
is not a production Web Vitals result. The local protected overview route returned HTTP 200;
after route compilation, two observed server timings were `118` and `356` ms.

The proposed meaningful-state budget of 3 seconds is therefore **not demonstrated** by this
local run. It must be measured on Preview/Production with a production build before S-14 can
be accepted.

## SQL Editor EXPLAIN evidence

The first SQL Editor result was captured for `read_store_analytics_overview` with the fixed
scope from the supplied probe:

```text
Execution Time: 1084.649 ms
Shared buffers: hit 1727, read 1083, written 672
Temporary buffers: read 3334, written 1240
WAL records/FPI/bytes: 0 / 0 / 0
```

At the default 8 KiB PostgreSQL block size this is approximately 26.0 MiB of temporary reads
and 9.7 MiB of temporary writes. The absence of WAL confirms that the probe did not persist
database changes. The shared written-buffer counter must not be interpreted as application
row writes: PostgreSQL may write already-dirty shared buffers while making room for this
query; the zero WAL counters are the relevant evidence for this read-only call.

The outer plan exposes the function only as a `Result` node, so it does **not** identify which
internal PL/pgSQL statement spills to temporary storage. No index or materialized view is
approved from this plan alone. The category/product and penetration plans, plus statement-
level internal probes for the slow reader, are still required.

The internal penetration P2 probe was then captured. It completed in `683.990 ms` for
`15,699` eligible receipts and `33,002` eligible product links. The evidence localizes the
cost as follows:

- accepted/projected run selection: `0.311 ms` for 7 runs;
- receipt relation: `30.239 ms` for 15,699 rows;
- line relation: `51.040 ms` for 33,002 rows;
- historical catalog aggregation: `130.630 ms` for 15,641 identities;
- catalog-to-receipt mapping merge: `249.974 ms` for 33,002 rows;
- root temporary I/O: 1,676 reads and 838 writes;
- planner estimate for the mapped relation: 200 rows versus 33,002 actual rows.

The receipt and line indexes are used and their heap/index scans are not the dominant cost.
The dominant evidence is the opaque catalog estimate, mapping join and repeated scans of
wide materialized `mapped`/`product_links` relations. A read-only candidate rewrite probe
was added to inline the catalog source and aggregate category/product statistics directly;
it must beat P2 and preserve all counts before any forward-only function replacement.

## Honest status

- PASS: fixed `asOf`, current roster from DB, 20 readers, sync replay, stable bounded payload,
  no year facts or raw receipt/customer payload returned to the caller.
- NEEDS OPTIMIZATION: penetration p95 under 20 readers is 2.35–2.78 s, above the proposed 2 s budget.
- PARTIAL, NOT ACCEPTANCE: the protected local route returned HTTP 200 and rendered the
  expected complete-period values, but local-development meaningful-state was 3.30–3.68 s,
  above the proposed 3 s budget.
- NOT YET MEASURED: Preview/Production browser meaningful-state and full year×roster on a
  complete year, because the current verified history is not a complete year.
- PARTIAL SQL EVIDENCE: overview outer EXPLAIN and penetration P2 internal EXPLAIN are
  captured. Category/product outer plan, penetration outer plan and the candidate rewrite
  plan are still required before approving a production replacement.

Do not infer PostgreSQL cold-cache performance from the first HTTP request: it is only the
first request in that Node process. Do not add guessed indexes or materialized views before
the explain plans are captured.
