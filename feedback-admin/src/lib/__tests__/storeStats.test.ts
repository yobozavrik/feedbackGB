import { describe, expect, it } from "vitest";
import {
  buildStoreDetail,
  buildStoreSummaries,
  groupSellersByStore,
} from "../storeStats";
import type {
  StoreFeedRow,
  StoreRow,
  StoreSeller,
} from "@/app/(admin)/admin/stores/page";

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function store(id: number, name = `Store ${id}`): StoreRow {
  return {
    id,
    name,
    address: null,
    lat: null,
    lng: null,
    is_active: true,
  } as StoreRow;
}

function feedRow(overrides: Partial<StoreFeedRow>): StoreFeedRow {
  return {
    id: `f-${Math.random()}`,
    store_id: 1,
    category: "missing_item",
    category_title: "Мало товару",
    category_emoji: null,
    status: "new",
    summary: "s",
    created_at: isoDaysAgo(1),
    user_full_name: null,
    product_id: null,
    product_name: null,
    ...overrides,
  } as StoreFeedRow;
}

function seller(storeId: number | null, isActive = true): StoreSeller {
  return {
    id: `u-${Math.random()}`,
    full_name: "Seller",
    store_id: storeId,
    is_active: isActive,
    has_pin: true,
    last_login: null,
  } as StoreSeller;
}

describe("buildStoreSummaries", () => {
  it("counts current window, previous window and per-category KPIs", () => {
    const feed = [
      feedRow({ created_at: isoDaysAgo(1) }),
      feedRow({ created_at: isoDaysAgo(5), category: "defect", category_title: "Брак" }),
      feedRow({ created_at: isoDaysAgo(10), category: "store_idea", category_title: "Ідея" }),
      // previous 30-day window (between day 30 and day 59)
      feedRow({ created_at: isoDaysAgo(35) }),
      feedRow({ created_at: isoDaysAgo(45) }),
      // outside both windows — ignored by counters but still counts for lastAt ordering
      feedRow({ created_at: isoDaysAgo(90) }),
    ];
    const sellersByStore = groupSellersByStore([
      seller(1, true),
      seller(1, false),
      seller(null),
    ]);

    const [s] = buildStoreSummaries([store(1)], feed, sellersByStore);

    expect(s.total30).toBe(3);
    expect(s.prev30).toBe(2);
    expect(s.defect30).toBe(1);
    expect(s.ideas30).toBe(1);
    expect(s.activeSellers).toBe(1);
    expect(s.totalSellers).toBe(2);
    // most recent row wins lastAt
    expect(s.lastAt).toBe(feed[0].created_at);
  });

  it("picks the most frequent category of the window as top category", () => {
    const feed = [
      feedRow({ category: "defect", category_title: "Брак" }),
      feedRow({ category: "defect", category_title: "Брак" }),
      feedRow({ category: "missing_item", category_title: "Мало товару" }),
    ];
    const [s] = buildStoreSummaries([store(1)], feed, new Map());
    expect(s.topCategoryId).toBe("defect");
    expect(s.topCategoryTitle).toBe("Брак");
  });

  it("returns zeroed summary for a store with no feedback", () => {
    const [s] = buildStoreSummaries([store(7)], [], new Map());
    expect(s.total30).toBe(0);
    expect(s.prev30).toBe(0);
    expect(s.topCategoryId).toBeNull();
    expect(s.lastAt).toBeNull();
  });
});

describe("buildStoreDetail", () => {
  it("builds a full-length trend series and aggregates products", () => {
    const feed = [
      feedRow({ product_id: 5, product_name: "Пельмені", category: "defect" }),
      feedRow({ product_id: 5, product_name: "Пельмені" }),
      feedRow({ product_id: 9, product_name: "Голубці" }),
      // other store — must be excluded
      feedRow({ store_id: 2, product_id: 5, product_name: "Пельмені" }),
    ];
    const [summary] = buildStoreSummaries([store(1)], feed, new Map());
    const detail = buildStoreDetail(summary, feed, new Map());

    expect(detail.trendData).toHaveLength(30);
    expect(detail.trendData.reduce((acc, d) => acc + d.value, 0)).toBe(3);
    expect(detail.topProducts[0]).toEqual({
      name: "Пельмені",
      count: 2,
      defectCount: 1,
    });
    expect(detail.recent).toHaveLength(3);
    expect(detail.total30Window).toBe(3);
  });
});
