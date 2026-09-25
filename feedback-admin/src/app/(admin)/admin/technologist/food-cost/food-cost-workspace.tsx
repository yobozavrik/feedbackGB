"use client";

import { useState, type ReactNode } from "react";
import { Tabs } from "antd";
import { FoodCostCategories } from "./food-cost-categories";

type Tab = "overview" | "categories";

export function FoodCostWorkspace({ initialTab, overview }: { initialTab: Tab; overview: ReactNode }) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  return <Tabs activeKey={activeTab} onChange={(key) => {
    const next = key === "categories" ? "categories" : "overview";
    setActiveTab(next);
    const url = new URL(window.location.href);
    if (next === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
  }} items={[
    { key: "overview", label: "Огляд", children: overview },
    { key: "categories", label: "Категорії", children: activeTab === "categories" ? <FoodCostCategories /> : null },
  ]} />;
}
