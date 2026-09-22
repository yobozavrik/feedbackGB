"use client";

import { useEffect, useState } from "react";
import { Alert, Badge, Card, Empty, Spin, Tabs, Typography } from "antd";
import { PlannedDataPlaceholder } from "@/components/admin/PlannedDataPlaceholder";
import { StoresClient } from "./stores-client";
import type { StoreFeedRow, StoreRow, StoreSeller } from "./page";

interface Props {
  stores: StoreRow[];
  windowDays: number;
  error: string | null;
}

interface ReportPage {
  feed: StoreFeedRow[];
  sellers: StoreSeller[];
  hasMore: boolean;
  page: number;
  windowDays: number;
  asOf: string;
}

export function StoresTabs(props: Props) {
  const [activeKey, setActiveKey] = useState("stores");
  const [reportData, setReportData] = useState<{ feed: StoreFeedRow[]; sellers: StoreSeller[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    if (activeKey !== "reports" || reportData || props.error) return;
    const controller = new AbortController();
    setLoading(true);
    setReportError(null);

    async function loadReports() {
      try {
        const feed: StoreFeedRow[] = [];
        let sellers: StoreSeller[] = [];
        let asOf: string | null = null;
        for (let page = 1; page <= 10; page += 1) {
          const asOfParam = asOf ? `&as_of=${encodeURIComponent(asOf)}` : "";
          const response = await fetch(`/api/admin/stores/reports?page=${page}&period=${props.windowDays}&limit=1000${asOfParam}`, {
            signal: controller.signal,
            cache: "no-store",
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = (await response.json()) as ReportPage;
          if (!Array.isArray(data.feed) || !Array.isArray(data.sellers) || data.page !== page || data.windowDays !== props.windowDays || typeof data.asOf !== "string" || (asOf !== null && data.asOf !== asOf)) {
            throw new Error("invalid_response");
          }
          asOf = data.asOf;
          feed.push(...data.feed);
          if (page === 1) sellers = data.sellers;
          if (!data.hasMore) {
            if (!controller.signal.aborted) setReportData({ feed, sellers });
            return;
          }
        }
        throw new Error("report_limit_exceeded");
      } catch (error) {
        if (!controller.signal.aborted) {
          setReportError(error instanceof Error && error.message === "report_limit_exceeded"
            ? "Забагато записів для поточного звіту. Дані не показано, щоб не занижувати показники."
            : "Не вдалося завантажити звіти магазинів.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadReports();
    return () => controller.abort();
  }, [activeKey, reportData, props.error, props.windowDays]);

  return (
    <Tabs
      activeKey={activeKey}
      onChange={setActiveKey}
      items={[
        {
          key: "stores",
          label: "Магазини",
          children: <StoreCards stores={props.stores} />,
        },
        {
          key: "reports",
          label: "Звіти",
          children: props.error
            ? <Alert type="error" showIcon message="Не вдалося завантажити магазини" description={props.error} />
            : reportError
              ? <Alert type="error" showIcon message={reportError} />
              : reportData
                ? <StoresClient stores={props.stores} feed={reportData.feed} sellers={reportData.sellers} windowDays={props.windowDays} error={null} />
                : <div className="flex min-h-40 items-center justify-center"><Spin spinning={loading} tip="Завантаження звітів" /></div>,
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
