"use client";

import { Tag } from "antd";
import { FOODCOST_GREEN_BELOW, FOODCOST_YELLOW_THROUGH, foodcostBand } from "@/lib/admin/foodcostBands";

const percentFormat = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const boundaryFormat = new Intl.NumberFormat("uk-UA", {
  minimumFractionDigits: 2, maximumFractionDigits: 10,
});

export function formatFoodcostPercent(value: number | null | undefined): string {
  if (foodcostBand(value) === "unknown") return "Н/Д";
  const exact = value as number;
  const rounded = Number(exact.toFixed(2));
  // Do not display a green 34.999% as 35.00%, or a red 45.001% as 45.00%.
  const crossesBoundary = (exact < FOODCOST_GREEN_BELOW && rounded >= FOODCOST_GREEN_BELOW) ||
    (exact > FOODCOST_YELLOW_THROUGH && rounded <= FOODCOST_YELLOW_THROUGH);
  return `${(crossesBoundary ? boundaryFormat : percentFormat).format(exact)} %`;
}

export function FoodcostStatusTag({ value }: { value: number | null | undefined }) {
  const band = foodcostBand(value);
  if (band === "unknown") return <Tag>Немає даних</Tag>;
  const status = {
    green: { color: "green", label: "Норма" },
    yellow: { color: "gold", label: "Увага" },
    red: { color: "red", label: "Високий" },
  }[band];
  return <Tag color={status.color} className="!mr-0">{status.label}</Tag>;
}

export function FoodcostRate({ value }: { value: number | null | undefined }) {
  if (foodcostBand(value) === "unknown") return <span>Н/Д</span>;
  return <span className="inline-flex flex-wrap items-center justify-end gap-1">
    <span>{formatFoodcostPercent(value)}</span><FoodcostStatusTag value={value} />
  </span>;
}
