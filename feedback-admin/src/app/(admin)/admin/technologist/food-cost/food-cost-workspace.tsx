"use client";

import type { ReactNode } from "react";
import { Alert, Select, Space, Tabs, Typography } from "antd";
import { useRouter } from "next/navigation";
import { FOODCOST_PERIOD_OPTIONS, type FoodcostPeriodDays } from "@/lib/admin/foodcostPeriod";
import { FoodCostCategories } from "./food-cost-categories";
import { FoodCostProducts } from "./food-cost-products";
import { FoodCostSupplyPrices } from "./food-cost-supply-prices";
import type { SupplyPriceReadModel } from "@/lib/admin/posterSupplyPrices";

type Tab = "overview" | "categories" | "products" | "supply-prices" | "matrix";

export function FoodCostWorkspace({ initialTab, overview, supplyPrices, matrixContent, spotId, categoryId, days }: {
  initialTab: Tab; overview: ReactNode; supplyPrices: SupplyPriceReadModel | null; matrixContent: ReactNode; spotId?: number; categoryId?: string; days: FoodcostPeriodDays;
}) {
  const router = useRouter();
  return <Space direction="vertical" size="middle" className="w-full">
    <div className="flex flex-wrap items-center gap-3">
      <Typography.Text>Період</Typography.Text>
      <Select aria-label="Період фудкосту" value={days} className="min-w-44"
        options={FOODCOST_PERIOD_OPTIONS.map((value) => ({ value, label: `${value} завершених днів` }))}
        onChange={(value: FoodcostPeriodDays) => {
          const url = new URL(window.location.href);
          url.searchParams.set("days", String(value));
          router.push(`${url.pathname}${url.search}`);
        }} />
    </div>
    <Tabs activeKey={initialTab} onChange={(key) => {
    const next = key === "categories" || key === "products" || key === "supply-prices" || key === "matrix" ? key : "overview";
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    router.push(`${url.pathname}${url.search}`);
  }} items={[
    { key: "overview", label: "Огляд", children: overview },
    { key: "categories", label: "Категорії", children: initialTab === "categories" ? <FoodCostCategories key={`${spotId ?? "all"}:${categoryId ?? "all"}:${days}`} spotId={spotId} focusedCategoryId={categoryId} days={days} /> : null },
    { key: "products", label: "Позиції", children: initialTab === "products" ? <FoodCostProducts key={`${spotId ?? "all"}:${categoryId ?? "all"}:${days}`} spotId={spotId} initialCategoryId={categoryId} days={days} /> : null },
    { key: "supply-prices", label: "Ціни", children: initialTab === "supply-prices"
      ? supplyPrices ? <FoodCostSupplyPrices key={days} data={supplyPrices} />
        : <Alert type="error" showIcon message="Ціни закупівель зараз недоступні" description="Не вдалося прочитати перевірений знімок накладних." />
      : null },
    { key: "matrix", label: "Матриця", children: initialTab === "matrix" ? matrixContent : null },
  ]} />
  </Space>;
}
