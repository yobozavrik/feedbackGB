"use client";

import { Alert, Card, Space, Statistic, Table, Typography } from "antd";
import type { loadFoodcostRecentNetwork } from "@/lib/admin/foodcostRecentNetwork";

type RecentNetwork = Awaited<ReturnType<typeof loadFoodcostRecentNetwork>>;
const percent = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = new Intl.DateTimeFormat("uk-UA", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
const fetchedAt = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short" });

function displayPercent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "Н/Д" : `${percent.format(value)} %`;
}

export function FoodCostRecentSummary({ data }: { data: RecentNetwork | null }) {
  if (!data) return <Alert type="warning" showIcon message="Огляд продажів мережі зараз недоступний"
    description="Показуємо лише окремий пілот продукту. Неперевірені підсумки мережі не підставляємо." />;
  if (data.status !== "complete" || !data.metrics || !data.days) {
    return <Alert type="warning" showIcon message="Знімок продажів неповний"
      description={`${data.completedCells} із ${data.expectedCells} пар дата × магазин. Фудкост мережі не розраховуємо до повного синку.`} />;
  }
  const delta = data.metrics.foodCostPercent === null || data.metrics.nettoFoodCostPercent === null
    ? null : data.metrics.foodCostPercent - data.metrics.nettoFoodCostPercent;
  return <Space direction="vertical" size="middle" className="mb-4 w-full">
    <Alert type="info" showIcon message="Поточний склад мережі · 3 завершені дні"
      description={`${data.spotCount} магазинів Poster звірено з базою, ${data.completedCells}/${data.expectedCells} знімків. Історичний склад мережі не підтверджено: цей блок не є звітом за 7/14/30 днів.`} />
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Card size="small"><Statistic title="Фудкост за прибутком товарів" value={displayPercent(data.metrics.foodCostPercent)} /></Card>
      <Card size="small"><Statistic title="Фудкост за прибутком без ПДВ Poster" value={displayPercent(data.metrics.nettoFoodCostPercent)} /></Card>
      <Card size="small"><Statistic title="Різниця методик" value={delta === null ? "Н/Д" : `${percent.format(delta)} в. п.`} /></Card>
    </div>
    <Card size="small" title="За днями" extra={<Typography.Text type="secondary">{data.dateFrom} — {data.dateTo}</Typography.Text>}>
      <Table rowKey="businessDate" size="small" pagination={false} dataSource={data.days}
        columns={[
          { title: "Дата", dataIndex: "businessDate", render: (value: string) => date.format(new Date(`${value}T00:00:00Z`)) },
          { title: "За прибутком товарів", align: "right", render: (_, row) => displayPercent(row.metrics.foodCostPercent) },
          { title: "Без ПДВ Poster", align: "right", render: (_, row) => displayPercent(row.metrics.nettoFoodCostPercent) },
        ]} />
      <Typography.Text type="secondary" className="mt-2 block text-xs">
        Розрахунок із фактичної оплаченої суми та двох полів прибутку Poster; це не собівартість закупівель і не чистий прибуток бізнесу.
        Найстаріший знімок: {data.sourceFetchedAt ? fetchedAt.format(new Date(data.sourceFetchedAt)) : "Н/Д"};
        найновіший: {data.newestSourceFetchedAt ? fetchedAt.format(new Date(data.newestSourceFetchedAt)) : "Н/Д"}.
      </Typography.Text>
    </Card>
  </Space>;
}
