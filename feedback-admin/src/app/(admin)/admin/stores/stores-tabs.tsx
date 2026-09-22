"use client";

import { Badge, Card, Empty, Tabs, Typography } from "antd";
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
          children: <StoreCards stores={props.stores} />,
        },
        {
          key: "reports",
          label: "Звіти",
          children: <StoresClient {...props} />,
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

function StoreCards({ stores }: { stores: StoreRow[] }) {
  if (!stores.length) return <Empty className="py-12" description="Магазинів не знайдено" />;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {stores.map((store) => (
        <Card key={store.id} className="h-full" size="small">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Typography.Text strong className="block truncate text-base">{store.name}</Typography.Text>
              <Typography.Text type="secondary" className="mt-1 block min-h-10 text-sm">{store.address ?? "Адресу не вказано"}</Typography.Text>
            </div>
            <Badge status={store.is_active ? "success" : "default"} text={store.is_active ? "Активний" : "Неактивний"} />
          </div>
          <Typography.Text type="secondary" className="mt-4 block text-xs">Магазин #{store.id}</Typography.Text>
        </Card>
      ))}
    </div>
  );
}
