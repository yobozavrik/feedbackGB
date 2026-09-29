import { describe, expect, it } from "vitest";
import { probeIsoDate, probeSales, probeSpots, probeSupplies, probeSupplyLines, probeReceiptPage,
  probeReceiptMajorToMinor, probeReceiptMoneyBridge } from "../analyticsHistoryProbe";

const sale = { product_id: "1", modification_id: "0", count: "1.25", weight_flag: "1", unit: "kg",
  payed_sum: "123", product_profit: "23", product_profit_netto: "20", delete: "0" };
const supply = { supply_id: "1", storage_id: "2", date: "2026-01-15 10:20:30", delete: "0", supply_sum: "100" };
const receipt = { transaction_id: 1, spot_id: 2, payed_sum: "100", products: [{ product_id: 1 }], print_fiscal: 0 };
const page = { count: 100, page: { page: 1, per_page: 2, count: 1 }, data: [receipt] };

describe("safe bounded analytics history probe", () => {
  it("accepts real ISO dates", () => expect(probeIsoDate("2026-01-01")).toBe("2026-01-01"));
  it.each(["2026-02-31", "2026-13-01", "2026-1-01", "not-a-date"])("rejects invalid date %s", value => {
    expect(() => probeIsoDate(value)).toThrow("probe_invalid_date");
  });
  it("keeps exact money beyond JS safe integer", () => {
    expect(probeSales([{ ...sale, payed_sum: "9007199254740993" }, sale]).paidMinor).toBe("9007199254741116");
  });
  it("does not zero-fill missing netto", () => expect(probeSales([{ ...sale, product_profit_netto: null }]).nettoMinor).toBeNull());
  it("preserves negative corrections", () => expect(probeSales([{ ...sale, count: "-1", payed_sum: "-123" }])).toMatchObject({ paidMinor: "-123", negativeQuantityRows: 1 }));
  it("summarizes modifiers and deleted products without leaking raw fields", () => {
    const summary = probeSales([{ ...sale, modification_id: "2", delete: "1", client_phone: "secret" }, sale]);
    expect(summary).toMatchObject({ rows: 2, products: 1, modifiedRows: 1, deletedProductRows: 1 });
    expect(JSON.stringify(summary)).not.toContain("secret");
  });
  it("recognizes a verified empty response", () => expect(probeSales([])).toMatchObject({ rows: 0, paidMinor: "0", nettoMinor: "0" }));
  it("rejects a malformed non-array response", () => expect(() => probeSales({})).toThrow("probe_invalid_rows"));
  it("rejects absent required money", () => expect(() => probeSales([{ ...sale, payed_sum: undefined }])).toThrow("probe_invalid_money"));
  it("rejects unsafe already-rounded number money", () => expect(() => probeSales([{ ...sale, payed_sum: 9007199254740992 }])).toThrow("probe_invalid_money"));
  it("rejects duplicate roster identities", () => expect(() => probeSpots([{ spot_id: 1 }, { spot_id: 1 }])).toThrow("probe_invalid_roster"));
  it("does not invent historical validity from current mappings", () => {
    expect(probeSpots([{ spot_id: 1, storages: [{ storage_id: 2 }] }])).toEqual({ spotIds: [1], storageMappings: [{ spotId: 1, storageId: 2 }], historicalIntervalsConfirmed: false });
  });
  it("excludes deleted supplies from active sums", () => expect(probeSupplies([supply, { ...supply, supply_id: 2, delete: 1 }], "2026-01-15", "2026-01-15")).toMatchObject({ rows: 2, active: 1, deleted: 1, activeSumMinor: "100" }));
  it("rejects duplicate supply IDs", () => expect(() => probeSupplies([supply, supply], "2026-01-15", "2026-01-15")).toThrow("probe_duplicate_supply"));
  it("rejects out-of-window documents", () => expect(() => probeSupplies([supply], "2026-01-01", "2026-01-01")).toThrow("probe_supply_outside_window"));
  it("keeps piece/weight/litre supply units distinct", () => {
    const rows = ["kg", "p", "l"].map(ingredient_unit => ({ ingredient_id: 1, ingredient_unit, supply_ingredient_num: "1", supply_ingredient_sum: "100" }));
    expect(probeSupplyLines(rows)).toEqual({ rows: 3, sumMinor: "300", units: ["kg", "l", "p"] });
  });
  it("marks receipt samples as not full-day verified", () => expect(probeReceiptPage(page, 1, 2)).toMatchObject({ totalDeclared: 100, sampledReceipts: 1, fullDayVerified: false }));
  it("rejects inconsistent page metadata", () => expect(() => probeReceiptPage({ ...page, page: { ...page.page, count: 2 } }, 1, 2)).toThrow("probe_invalid_receipt_page"));
  it("rejects repeated receipts in a page", () => expect(() => probeReceiptPage({ ...page, page: { ...page.page, count: 2 }, data: [receipt, receipt] }, 1, 2)).toThrow("probe_duplicate_receipt"));
  it("never emits receipt PII", () => {
    expect(JSON.stringify(probeReceiptPage({ ...page, data: [{ ...receipt, client_phone: "hidden", client_name: "hidden" }] }, 1, 2))).not.toContain("hidden");
  });
  it.each([["18.50", 1850n], ["724.50", 72450n], ["1.01", 101n], ["-1.01", -101n], ["0", 0n]])(
    "converts receipt major money %s exactly", (value, expected) => expect(probeReceiptMajorToMinor(value)).toBe(expected));
  it("rejects fractional sub-kopeck receipt money", () => expect(() => probeReceiptMajorToMinor("1.001")).toThrow("probe_invalid_receipt_money"));
  it("rejects ambiguous number rather than string receipt money", () => expect(() => probeReceiptMajorToMinor(18.5)).toThrow("probe_invalid_receipt_money"));
  it("checks the cross-method factor without exposing receipt IDs", () => {
    expect(probeReceiptMoneyBridge(page, [{ transaction_id: 1, payed_sum: "10000" }])).toMatchObject({ sampledReceipts: 1, exactMoneyEqual: true, fullDayVerified: false });
  });
  it("rejects missing dashboard receipt match", () => expect(() => probeReceiptMoneyBridge(page, [])).toThrow("probe_receipt_money_bridge_mismatch"));
  it("rejects wrong money conversion factor", () => expect(() => probeReceiptMoneyBridge(page, [{ transaction_id: 1, payed_sum: "100" }])).toThrow("probe_receipt_money_bridge_mismatch"));
});
