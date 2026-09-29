import { describe, expect, it } from "vitest";
import { aggregateSupplyPriceWindows, type PosterSupplyDocument } from "../posterSupplyPrices";

const names = new Map([[23, "Банан"], [101, "Ананас консервований"]]);
function doc(supplyId: number, supplyDate: string, lines: PosterSupplyDocument["lines"]): PosterSupplyDocument {
  return { supplyId, supplyDate, lines };
}
function line(ingredientId: number, quantity: number, sumMinor: number, unit: "kg" | "l" | "p" = "kg") {
  return { ingredientId, unit, quantity, sumMinor };
}

describe("aggregateSupplyPriceWindows", () => {
  const snapshotFrom = "2026-08-26";
  const snapshotTo = "2026-09-24";
  const sample: PosterSupplyDocument[] = [
    doc(100, "2026-09-20T12:00:00", [line(23, 2, 30000), line(23, 1, 16000)]),
    doc(101, "2026-09-15 09:00:00", [line(23, 3, 45000)]),
    doc(102, "2026-09-10 10:00:00", [line(23, 1, 10000)]),
    doc(103, "2026-09-02 10:00:00", [line(101, 2, 20000)]),
    doc(104, "2026-08-27 10:00:00", [line(23, 3, 30000)]),
  ];

  it("builds complete 7-day current and previous equal windows from the snapshot anchor", () => {
    const model = aggregateSupplyPriceWindows({ days: 7, snapshotFrom, snapshotTo, documents: sample, names });
    expect(model.status).toBe("complete");
    expect(model.current).toMatchObject({ from: "2026-09-18", to: "2026-09-24", status: "complete", documentCount: 1 });
    expect(model.previous).toMatchObject({ from: "2026-09-11", to: "2026-09-17", status: "complete", documentCount: 1 });
    const banana = model.rows.find((row) => row.ingredientId === 23)!;
    expect(banana.currentWeightedPriceMinor).toBe(15_333); // 46,000 minor / 3 kg, rounded to 1 kopeck
    expect(banana.previousWeightedPriceMinor).toBe(15000);
    expect(banana.deltaMinor).toBe(333);
    expect(banana.deltaPercent).toBeCloseTo((333 / 15_000) * 100);
  });

  it("builds complete 14-day current and previous windows", () => {
    const model = aggregateSupplyPriceWindows({ days: 14, snapshotFrom, snapshotTo, documents: sample, names });
    expect(model.current).toMatchObject({ from: "2026-09-11", to: "2026-09-24", status: "complete" });
    expect(model.previous).toMatchObject({ from: "2026-08-28", to: "2026-09-10", status: "complete" });
    expect(model.status).toBe("complete");
  });

  it("keeps current 30-day prices but marks previous 30 days unavailable", () => {
    const model = aggregateSupplyPriceWindows({ days: 30, snapshotFrom, snapshotTo, documents: sample, names });
    expect(model.current.status).toBe("complete");
    expect(model.previous).toMatchObject({ from: "2026-07-27", to: "2026-08-25", status: "unavailable" });
    expect(model.rows.find((row) => row.ingredientId === 23)?.currentWeightedPriceMinor).not.toBeNull();
    expect(model.rows.find((row) => row.ingredientId === 23)?.previousWeightedPriceMinor).toBeNull();
  });

  it("suppresses all selected-period rows when 60 days exceed snapshot coverage", () => {
    const model = aggregateSupplyPriceWindows({ days: 60, snapshotFrom, snapshotTo, documents: sample, names });
    expect(model.status).toBe("unavailable");
    expect(model.current.status).toBe("unavailable");
    expect(model.rows).toEqual([]);
  });

  it("keeps units separate and represents a missing purchase as null, not zero", () => {
    const docs = [...sample, doc(105, "2026-09-21 10:00:00", [line(23, 2, 50000, "p"), line(999, 1, 0, "l")])];
    const model = aggregateSupplyPriceWindows({ days: 7, snapshotFrom, snapshotTo, documents: docs, names });
    const bananaKg = model.rows.find((row) => row.ingredientId === 23 && row.unit === "kg")!;
    const bananaPiece = model.rows.find((row) => row.ingredientId === 23 && row.unit === "p")!;
    const ingredientWithoutPrevious = model.rows.find((row) => row.ingredientId === 999)!;
    expect(bananaKg.currentWeightedPriceMinor).not.toBe(bananaPiece.currentWeightedPriceMinor);
    expect(ingredientWithoutPrevious.currentWeightedPriceMinor).toBe(0);
    expect(ingredientWithoutPrevious.previousWeightedPriceMinor).toBeNull();
    expect(ingredientWithoutPrevious.deltaMinor).toBeNull();
  });

  it("uses last invoice date then supply ID as deterministic tie-break and aggregates duplicate lines per invoice", () => {
    const docs = [
      ...sample,
      doc(200, "2026-09-23 11:00:00", [line(23, 1, 12000), line(23, 1, 13000)]),
      doc(201, "2026-09-23 11:00:00", [line(23, 2, 50000)]),
    ];
    const model = aggregateSupplyPriceWindows({ days: 7, snapshotFrom, snapshotTo, documents: docs, names });
    const banana = model.rows.find((row) => row.ingredientId === 23 && row.unit === "kg")!;
    expect(banana.lastSupplyId).toBe(201);
    expect(banana.lastPriceMinor).toBe(25000);
  });

  it("rounds weighted prices to the displayed kopeck before delta and change classification", () => {
    const docs = [
      doc(300, "2026-09-20 12:00:00", [line(23, 10, 238001)]),
      doc(301, "2026-09-15 09:00:00", [line(23, 10, 238000)]),
    ];
    const model = aggregateSupplyPriceWindows({ days: 7, snapshotFrom, snapshotTo, documents: docs, names });
    const banana = model.rows[0];
    expect(banana.currentWeightedPriceMinor).toBe(23800);
    expect(banana.previousWeightedPriceMinor).toBe(23800);
    expect(banana.deltaMinor).toBe(0);
    expect(banana.deltaPercent).toBe(0);
  });

  it("rejects duplicate supply IDs and invalid persisted lines rather than silently lowering prices", () => {
    const duplicate = aggregateSupplyPriceWindows({ days: 7, snapshotFrom, snapshotTo,
      documents: [...sample, doc(100, "2026-09-20 12:00:00", [line(23, 5, 50000)])], names });
    const invalid = aggregateSupplyPriceWindows({ days: 7, snapshotFrom, snapshotTo,
      documents: [...sample, doc(999, "2026-09-20 12:00:00", [line(23, 0, 50000)])], names });
    expect(duplicate.status).toBe("unavailable");
    expect(duplicate.rows).toEqual([]);
    expect(invalid.status).toBe("unavailable");
    expect(invalid.reason).toBe("snapshot_contains_invalid_lines");
  });
});
