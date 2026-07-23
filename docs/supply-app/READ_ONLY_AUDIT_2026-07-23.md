# Read-only audit: FeedbackGB and CRM

Date: 2026-07-23. Scope: live metadata and read-only RPC inspection only. No
data, schema, storage or configuration was changed.

## FeedbackGB facts

- `feedbackgb.users` currently permits only `seller`, `admin`, and
  `super_admin`. A reviewed migration must add `supply_worker`; it must not
  weaken the existing admin guard.
- Live active users at audit time: 49 sellers, 4 admins, 1 super-admin.
- Existing PIN functions are security-definer `set_user_pin`, `verify_pin`,
  and `verify_pin_global`; the global verifier is not an app-scoped contract.
- `users` has a `pin_hash`, `is_active`, `failed_attempts`, and `locked_until`.
  Existing PIN format is six digits.
- RLS is enabled for the existing business tables except
  `feedbackgb.user_interactions`. New Supply tables must enable and force RLS;
  browser clients receive no direct write grant.
- Existing storage buckets are unrelated to Supply attachments. A new private
  bucket and authorization path are required.
- `service_role` has full CRUD grants on the existing business tables. It must
  remain server-only and never be exposed to either Supply client channel.

## CRM facts

- Catalogue: `household_chemicals.products` and `product_categories`;
  `rpc_product_catalog` reads products for a warehouse.
- Facility directory: active `household_chemicals.warehouses` contains shop,
  workshop, and storage locations. Facility mapping must persist the CRM
  warehouse ID; no UI code may hardcode an ID.
- Raw-material orders: `orders` / `order_items`. Valid statuses are `draft`,
  `submitted`, `confirmed`, `partially_shipped`, `shipped`, `cancelled`.
- Defects are accounting write-offs: `write_offs` / `write_off_items`.
  `rpc_create_write_off_with_items` creates a `draft`; `confirm_write_off`
  verifies stock, creates stock movements, then sets `confirmed`.
- Incoming invoices are receipts: `receipts` / `receipt_items`.
  `rpc_create_receipt_with_items` creates a `draft`; `confirm_receipt` creates
  stock movements and sets `confirmed`.
- There is no CRM relation called `raw_materials`, `raw_material_defects`, or
  `incoming_documents`; those are Supply domain names, not CRM names.

## Blocking finding: CRM idempotency

The three create RPCs accept no immutable idempotency key and their destination
tables have no unique source-document key. `receipts.poster_supply_id` is
unique but is not accepted by `rpc_create_receipt_with_items`, so it cannot
serve this integration.

Required CRM contract, implemented and tested in the CRM repository before
Supply bridge writes are enabled:

1. Add `source_system` and `source_document_id` (or one immutable
   `idempotency_key`) to orders, write-offs, and receipts.
2. Add a unique constraint per document type.
3. Extend each create RPC with the key and make duplicate calls return the
   original document, not create a second one.
4. Add integration tests for timeout after commit, duplicate delivery and
   concurrent retries.
5. Publish the changed request/response contract and owner in
   `INTEGRATIONS.md` and `API.openapi.yaml`.

Until all five items are verified, Supply may not create or confirm CRM
accounting documents. This prevents duplicate stock movements and receipts.
