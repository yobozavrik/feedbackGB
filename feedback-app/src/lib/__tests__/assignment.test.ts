import { describe, expect, it, vi } from "vitest";
import { resolveAssignedAdmin } from "../assignment";

/**
 * Minimal fluent mock matching the subset of the Supabase query builder
 * `resolveAssignedAdmin` actually calls: .from().select().eq().eq()[.eq()|.is()].
 * Each completed query records which filters it was built with, and
 * resolves to a caller-supplied row array — so a scope can now return 0, 1,
 * or several admin_ids (the direction table no longer enforces a single
 * admin per scope).
 */
function makeSupabaseMock(responses: {
  exact?: { data: Array<{ admin_id: string }> | null; error: { code: string } | null };
  allStores?: { data: Array<{ admin_id: string }> | null; error: { code: string } | null };
}) {
  const calls: Array<{ eq: Array<[string, unknown]>; is: Array<[string, unknown]> }> = [];

  function builder() {
    const filters: { eq: Array<[string, unknown]>; is: Array<[string, unknown]> } = {
      eq: [],
      is: [],
    };
    // The real query is awaited directly (no terminal .maybeSingle()/.single()
    // call) — resolveAssignedAdmin does `const { data, error } = await scoped`.
    // Make the chain itself thenable so `await` resolves it.
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        filters.eq.push([col, val]);
        return chain;
      },
      is: (col: string, val: unknown) => {
        filters.is.push([col, val]);
        return chain;
      },
      then: (resolve: (v: unknown) => void) => {
        calls.push(filters);
        const isStoreIdNull = filters.is.some(([col]) => col === "store_id");
        const result = isStoreIdNull
          ? responses.allStores ?? { data: [], error: null }
          : responses.exact ?? { data: [], error: null };
        resolve(result);
      },
    };
    return chain;
  }

  const supabase = {
    from: vi.fn(() => builder()),
  };

  return { supabase: supabase as unknown as Parameters<typeof resolveAssignedAdmin>[0], calls };
}

function admins(...ids: string[]) {
  return { data: ids.map((admin_id) => ({ admin_id })), error: null };
}

describe("resolveAssignedAdmin", () => {
  it("auto-assigns when exactly one admin covers the exact store", async () => {
    const { supabase } = makeSupabaseMock({ exact: admins("admin-store-11") });
    const result = await resolveAssignedAdmin(supabase, "defect", 11);
    expect(result).toBe("admin-store-11");
  });

  it("returns null (shared queue) when 2+ admins cover the exact store", async () => {
    const { supabase } = makeSupabaseMock({ exact: admins("admin-a", "admin-b") });
    const result = await resolveAssignedAdmin(supabase, "defect", 11);
    expect(result).toBeNull();
  });

  it("does not fall back to all-stores when the exact-store scope is ambiguous (2+ admins)", async () => {
    const { supabase, calls } = makeSupabaseMock({
      exact: admins("admin-a", "admin-b"),
      allStores: admins("admin-all-stores"),
    });
    const result = await resolveAssignedAdmin(supabase, "defect", 11);
    expect(result).toBeNull();
    // Only the exact-store lookup should have run — an ambiguous exact
    // scope is authoritative, we don't consult the all-stores fallback.
    expect(calls).toHaveLength(1);
  });

  it("falls back to the all-stores admin when no exact-store rule matches", async () => {
    const { supabase } = makeSupabaseMock({
      exact: admins(),
      allStores: admins("admin-all-stores"),
    });
    const result = await resolveAssignedAdmin(supabase, "defect", 11);
    expect(result).toBe("admin-all-stores");
  });

  it("returns null (shared queue) when 2+ admins cover all stores and no exact-store rule exists", async () => {
    const { supabase } = makeSupabaseMock({
      exact: admins(),
      allStores: admins("admin-a", "admin-b"),
    });
    const result = await resolveAssignedAdmin(supabase, "defect", 11);
    expect(result).toBeNull();
  });

  it("returns null when neither an exact-store nor an all-stores rule exists", async () => {
    const { supabase } = makeSupabaseMock({ exact: admins(), allStores: admins() });
    const result = await resolveAssignedAdmin(supabase, "customer_voice", 11);
    expect(result).toBeNull();
  });

  it("skips the store-scoped lookup entirely when storeId is null", async () => {
    const { supabase, calls } = makeSupabaseMock({ allStores: admins("admin-all-stores") });
    const result = await resolveAssignedAdmin(supabase, "store_idea", null);
    expect(result).toBe("admin-all-stores");
    expect(calls).toHaveLength(1);
    expect(calls[0].is).toContainEqual(["store_id", null]);
  });

  it("falls back to all-stores lookup (does not throw) when the exact-store query errors", async () => {
    const { supabase } = makeSupabaseMock({
      exact: { data: null, error: { code: "500" } },
      allStores: admins("admin-all-stores"),
    });
    const result = await resolveAssignedAdmin(supabase, "defect", 11);
    expect(result).toBe("admin-all-stores");
  });

  it("returns null (never throws) when the all-stores query errors", async () => {
    const { supabase } = makeSupabaseMock({
      exact: admins(),
      allStores: { data: null, error: { code: "500" } },
    });
    const result = await resolveAssignedAdmin(supabase, "defect", 11);
    expect(result).toBeNull();
  });

  it("returns null (never throws) when the client itself throws", async () => {
    const supabase = {
      from: vi.fn(() => {
        throw new Error("connection reset");
      }),
    } as unknown as Parameters<typeof resolveAssignedAdmin>[0];
    const result = await resolveAssignedAdmin(supabase, "defect", 11);
    expect(result).toBeNull();
  });

  it("always filters on is_active = true, so deactivated rules are structurally excluded", async () => {
    const { supabase, calls } = makeSupabaseMock({ exact: admins("admin-store-11") });
    await resolveAssignedAdmin(supabase, "defect", 11);
    expect(calls[0].eq).toContainEqual(["is_active", true]);

    const { supabase: supabaseAllStores, calls: allStoresCalls } = makeSupabaseMock({
      allStores: admins("admin-all-stores"),
    });
    await resolveAssignedAdmin(supabaseAllStores, "store_idea", null);
    expect(allStoresCalls[0].eq).toContainEqual(["is_active", true]);
  });
});
