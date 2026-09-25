"use client";

import type { ReactNode } from "react";
import { Tabs } from "antd";
import { useRouter } from "next/navigation";
import { FoodCostCategories } from "./food-cost-categories";
import { FoodCostProducts } from "./food-cost-products";

type Tab = "overview" | "categories" | "products";

export function FoodCostWorkspace({ initialTab, overview, spotId, categoryId }: {
  initialTab: Tab; overview: ReactNode; spotId?: number; categoryId?: string;
}) {
  const router = useRouter();
  return <Tabs activeKey={initialTab} onChange={(key) => {
    const next = key === "categories" || key === "products" ? key : "overview";
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    router.push(`${url.pathname}${url.search}`);
  }} items={[
    { key: "overview", label: "Огляд", children: overview },
    { key: "categories", label: "Категорії", children: initialTab === "categories" ? <FoodCostCategories spotId={spotId} focusedCategoryId={categoryId} /> : null },
    { key: "products", label: "Позиції", children: initialTab === "products" ? <FoodCostProducts key={`${spotId ?? "all"}:${categoryId ?? "all"}`} spotId={spotId} initialCategoryId={categoryId} /> : null },
  ]} />;
}
