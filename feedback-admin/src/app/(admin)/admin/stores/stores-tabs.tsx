"use client";

import { Tabs } from "antd";
import { PlannedDataPlaceholder } from "@/components/admin/PlannedDataPlaceholder";
import { StoresClient } from "./stores-client";
import type { StoreFeedRow, StoreRow, StoreSeller } from "./page";

interface Props {
  stores: StoreRow[];
  feed: StoreFeedRow[];
  sellers: StoreSeller[];
  windowDays: number;
  error: string | null;
}

export function StoresTabs(props: Props) {
  return (
    <Tabs
      defaultActiveKey="stores"
      items={[
        {
          key: "stores",
          label: "Магазини",
          children: <StoresClient {...props} />,
        },
        {
          key: "reports",
          label: "Звіти",
          children: <PlannedDataPlaceholder title="Звіти магазинів" description="Формати звітів, періоди, відповідальні та джерела ще не погоджені. Наявні фідбеки не змішуємо зі звітами магазинів без затвердженого правила." scope="network" />,
        },
        {
          key: "analytics",
          label: "Аналітика",
          children: <PlannedDataPlaceholder title="Аналітика магазинів" description="Метрики, цілі, періоди порівняння й джерела аналітики ще не погоджені. Показники не вигадуються до затвердження їхнього складу." scope="network" />,
        },
      ]}
    />
  );
}
