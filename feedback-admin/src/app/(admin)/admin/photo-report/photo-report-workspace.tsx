"use client";

import { Alert, Card, Empty } from "antd";
import { useRouter } from "next/navigation";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { photoReportTabKey, type PhotoReportTabKey } from "@/lib/photoReportTabs";
import type { PhotoReportStore } from "@/lib/photoReport";
import { PhotoReportClient } from "./photo-report-client";

const tabs = [
  { key: "daily", label: "Контроль дня" },
  { key: "stores", label: "Магазини" },
  { key: "attendance", label: "Продавці та зміни" },
] as const;

function StoresPlaceholder() {
  return (
    <Card>
      <Empty
        description="Аналітика за період ще не підключена"
      />
      <Alert
        className="mt-4"
        type="info"
        showIcon
        message="Тут з’являться динаміка магазину, календар контрольних вікон і перехід до галереї."
        description="Зараз не показуємо умовні графіки: поточний API повертає лише один день, а історичний SQL-агрегат ще не реалізований."
      />
    </Card>
  );
}

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
      {activeTab === "stores" ? <StoresPlaceholder /> : null}
      {activeTab === "attendance" ? <AttendancePlaceholder /> : null}
    </AdminPageContainer>
  );
}
