"use client";

import { Alert, Card, Empty } from "antd";
import { useRouter } from "next/navigation";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { photoReportTabKey, type PhotoReportTabKey } from "@/lib/photoReportTabs";
import type { PhotoReportStore } from "@/lib/photoReport";
import { PhotoReportClient } from "./photo-report-client";
import { StoreAnalyticsClient } from "./store-analytics-client";

const tabs = [
  { key: "daily", label: "Контроль дня" },
  { key: "stores", label: "Магазини" },
  { key: "attendance", label: "Продавці та зміни" },
] as const;

function AttendancePlaceholder() {
  return (
    <Card>
      <Empty description="Дані про зміни ще не підключені" />
      <Alert
        className="mt-4"
        type="info"
        showIcon
        message="Присутність продавців не визначається за їхнім домашнім магазином."
        description="Тут буде журнал check-in/check-out та статуси по контрольних вікнах після окремого, підтвердженого джерела фактичних змін."
      />
    </Card>
  );
}

export function PhotoReportWorkspace({
  stores,
  error,
  initialTab,
}: {
  stores: PhotoReportStore[];
  error: string | null;
  initialTab: string | undefined;
}) {
  const router = useRouter();
  const activeTab = photoReportTabKey(initialTab);

  const changeTab = (nextTab: string) => {
    const tab = photoReportTabKey(nextTab) as PhotoReportTabKey;
    router.push(`/admin/photo-report?tab=${tab}`);
  };

  return (
    <AdminPageContainer
      title="Фото звіт"
      subTitle="Щоденний контроль надходження фото по активних магазинах."
      tabs={{ activeKey: activeTab, onChange: changeTab, items: [...tabs] }}
    >
      {activeTab === "daily" ? <PhotoReportClient stores={stores} error={error} /> : null}
      {activeTab === "stores" ? <StoreAnalyticsClient stores={stores} /> : null}
      {activeTab === "attendance" ? <AttendancePlaceholder /> : null}
    </AdminPageContainer>
  );
}
