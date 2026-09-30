"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, DatePicker, Empty, Select, Skeleton, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import { Line } from "@ant-design/plots";
import dayjs, { type Dayjs } from "dayjs";
import { useRouter, useSearchParams } from "next/navigation";
import type { StoreAnalyticsOverview, StoreAnalyticsWindow } from "@/lib/admin/storeAnalyticsOverview";
import { buildStoreAnalyticsRanking } from "@/lib/admin/storeAnalyticsRanking";
import type { StoreRow } from "./page";

type Payload = { data: StoreAnalyticsOverview };
type View = "overview" | "stores" | "categories" | "products" | "penetration" | "comparison" | "quality";
const PERIODS = [
  ["7d", "7 завершених днів"], ["14d", "14 завершених днів"],
  ["30d", "30 завершених днів"], ["60d", "60 завершених днів"],
  ["90d", "90 завершених днів"], ["month", "Поточний місяць"],
  ["previous-month", "Попередній місяць"], ["quarter", "Поточний квартал"],
  ["ytd", "З початку року"], ["all", "Уся доступна історія"], ["custom", "Свій період"],
] as const;

function formatMinor(value: string | null | undefined): string {
  if (value == null || !/^-?\d+$/.test(value)) return "—";
  const minor = BigInt(value), negative = minor < 0n, absolute = negative ? -minor : minor;
  const whole = absolute / 100n, fraction = String(absolute % 100n).padStart(2, "0");
  return `${negative ? "−" : ""}${new Intl.NumberFormat("uk-UA").format(whole)},${fraction} ₴`;
}

function foodcostColor(value: string | null): string {
  if (value == null) return "default";
  const number = Number(value);
  return number < 35 ? "green" : number <= 45 ? "gold" : "red";
}

function coverage(window: StoreAnalyticsWindow) {
  return `${window.completedCells}/${window.expectedCells}`;
}

export function StoreAnalyticsWorkspace({ stores }: { stores: StoreRow[] }) {
  const router = useRouter(), search = useSearchParams();
  const view = (search.get("view") ?? "overview") as View;
  const period = search.get("period") ?? "30d";
  const selected = search.get("spot_ids") === "all" || !search.get("spot_ids")
    ? [] : (search.get("spot_ids") ?? "").split(",").map(Number).filter(Number.isSafeInteger);
  const [data, setData] = useState<StoreAnalyticsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const endpointQuery = useMemo(() => {
    const params = new URLSearchParams(search.toString());
    params.set("tab", "analytics"); params.set("view", "overview");
    if (!params.has("period") && !params.has("days")) params.set("period", "30d");
    if (!params.has("spot_ids") && !params.has("spot_id")) params.set("spot_ids", "all");
    if (!params.has("comparison")) params.set("comparison", "previous");
    for (const key of ["page", "page_size", "search", "sort", "direction", "category_id", "product_id"]) params.delete(key);
    return params.toString();
  }, [search]);

  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(null);
    fetch(`/api/admin/stores/analytics/overview?${endpointQuery}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "store_analytics_unavailable");
        return body as Payload;
      }).then((body) => setData(body.data)).catch((reason: unknown) => {
        if ((reason as { name?: string }).name !== "AbortError") setError(reason instanceof Error ? reason.message : "store_analytics_unavailable");
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpointQuery]);

  const update = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(search.toString()); params.set("tab", "analytics");
    for (const [key, value] of Object.entries(changes)) value === null ? params.delete(key) : params.set(key, value);
    router.replace(`/admin/stores?${params.toString()}`);
  };
  const range = period === "custom" ? [search.get("from"), search.get("to")] : [null, null];

  return <Space direction="vertical" size="middle" className="w-full">
    <Card size="small">
      <div className="flex flex-wrap items-end gap-3">
        <label><Typography.Text type="secondary" className="mb-1 block text-xs">Період</Typography.Text>
          <Select value={period} className="min-w-52" options={PERIODS.map(([value, label]) => ({ value, label }))}
            onChange={(value) => update({ period: value, from: value === "custom" ? search.get("from") : null,
              to: value === "custom" ? search.get("to") : null })} /></label>
        {period === "custom" && <DatePicker.RangePicker allowClear={false} value={range[0] && range[1] ? [dayjs(range[0]), dayjs(range[1])] : null}
          onChange={(value: null | [Dayjs | null, Dayjs | null]) => value?.[0] && value[1] && update({
            from: value[0].format("YYYY-MM-DD"), to: value[1].format("YYYY-MM-DD"), period: "custom",
          })} />}
        <label className="min-w-72 flex-1"><Typography.Text type="secondary" className="mb-1 block text-xs">Магазини</Typography.Text>
          <Select mode="multiple" allowClear maxTagCount="responsive" className="w-full" value={selected}
            placeholder="Уся мережа" options={stores.filter((store) => store.is_active).map((store) => ({ value: store.id, label: store.name }))}
            onChange={(ids: number[]) => update({ spot_ids: ids.length ? [...ids].sort((a, b) => a - b).join(",") : "all" })} /></label>
        <label><Typography.Text type="secondary" className="mb-1 block text-xs">Порівняння</Typography.Text>
          <Select value={search.get("comparison") ?? "previous"} className="min-w-48" options={[
            { value: "previous", label: "Попередній період" }, { value: "off", label: "Без порівняння" },
          ]} onChange={(value) => update({ comparison: value })} /></label>
      </div>
    </Card>
    <Tabs activeKey={view} onChange={(key) => update({ view: key })} items={[
      { key: "overview", label: "Огляд" }, { key: "stores", label: "Магазини" },
      { key: "categories", label: "Категорії", disabled: true }, { key: "products", label: "Товари", disabled: true },
      { key: "penetration", label: "Проникнення", disabled: true }, { key: "comparison", label: "Порівняння", disabled: true },
      { key: "quality", label: "Якість даних" },
    ]} />
    {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : error ? <Alert type="error" showIcon
      message="Аналітика магазинів недоступна" description={error === "store_analytics_schema_missing"
        ? "Потрібно застосувати міграцію 050." : "Не вдалося прочитати перевірені агрегати."} />
      : data ? view === "quality" ? <Quality data={data} stores={stores} />
        : view === "stores" ? <StoresView data={data} stores={stores} onSelectStore={(spotId) => update({ spot_ids: String(spotId) })}
          onAllStores={() => update({ spot_ids: "all" })} />
        : <Overview data={data} onSelectStore={(spotId) => update({ view: "stores", spot_ids: String(spotId) })} /> : <Empty />}
  </Space>;
}

function Overview({ data, onSelectStore }: { data: StoreAnalyticsOverview; onSelectStore: (spotId: number) => void }) {
  const current = data.current, metrics = current.metrics;
  if (current.status !== "complete" || !metrics) return <Alert type="warning" showIcon
    message="Період продажів неповний" description={`${current.from} — ${current.to}: ${coverage(current)} пар дата × магазин. Часткові KPI не показуємо.`} />;
  const chart = current.trend.map((row) => ({ date: row.date, value: Number(row.revenueMinor) / 100 }));
  return <Space direction="vertical" size="middle" className="w-full">
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card><Statistic title="Виручка" value={formatMinor(metrics.revenueMinor)} /></Card>
      <Card><Statistic title="Фудкост Poster" value={metrics.classicFoodcostPercent == null ? "—" : `${metrics.classicFoodcostPercent}%`}
        valueStyle={{ color: foodcostColor(metrics.classicFoodcostPercent) === "green" ? "#389e0d" : foodcostColor(metrics.classicFoodcostPercent) === "gold" ? "#d48806" : "#cf1322" }} /></Card>
      <Card><Statistic title="Чеки" value={current.receipts.receiptCount ?? "—"} suffix={current.receipts.status === "complete" ? null : <Tag color="gold">неповні</Tag>} /></Card>
      <Card><Statistic title="Середній чек" value="—" /><Typography.Text type="secondary" className="text-xs">Грошова база чеків ще не підтверджена</Typography.Text></Card>
    </div>
    {current.receipts.status !== "complete" && <Alert type="warning" showIcon message="Архів чеків неповний"
      description={`${current.receipts.completedDays}/${current.receipts.expectedDays} днів. Чеки та проникнення не використовуються як повний підсумок.`} />}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card title="Динаміка виручки" className="xl:col-span-2"><Line data={chart} xField="date" yField="value" height={300}
        axis={{ y: { title: "₴" } }} tooltip={{ items: [{ field: "value", name: "Виручка" }] }} /></Card>
      <Card title="Контроль даних"><Space direction="vertical">
        <Tag color="green">Продажі {coverage(current)}</Tag>
        <Tag color={current.receipts.status === "complete" ? "green" : "gold"}>Чеки {current.receipts.completedDays}/{current.receipts.expectedDays}</Tag>
        <Typography.Text type="secondary">Дані станом на {new Date(data.asOf).toLocaleString("uk-UA")}</Typography.Text>
        <Typography.Text type="secondary">Історичний склад мережі не підтверджено</Typography.Text>
      </Space></Card>
    </div>
    <Card title="Магазини за виручкою"><Table pagination={{ pageSize: 10 }} rowKey="spotId" dataSource={current.stores}
      columns={[
        { title: "Магазин", dataIndex: "storeName", render: (value: string, row: { spotId: number }) =>
          <Button type="link" className="h-auto p-0" onClick={() => onSelectStore(row.spotId)}>{value}</Button> },
        { title: "Виручка", dataIndex: "revenueMinor", align: "right" as const, render: formatMinor },
        { title: "Фудкост", dataIndex: "classicFoodcostPercent", align: "right" as const,
          render: (value: string | null) => value == null ? "—" : <Tag color={foodcostColor(value)}>{value}%</Tag> },
      ]} /></Card>
  </Space>;
}

function signedMinor(value: string | null): React.ReactNode {
  if (value === null) return "—";
  const positive = BigInt(value) > 0n, negative = BigInt(value) < 0n;
  return <Tag color={positive ? "green" : negative ? "red" : "default"}>{positive ? "+" : ""}{formatMinor(value)}</Tag>;
}

function StoresView({ data, stores, onSelectStore, onAllStores }: {
  data: StoreAnalyticsOverview;
  stores: StoreRow[];
  onSelectStore: (spotId: number) => void;
  onAllStores: () => void;
}) {
  const current = data.current;
  if (current.status !== "complete" || !current.metrics) return <Alert type="warning" showIcon
    message="Період продажів неповний" description={`${current.from} — ${current.to}: ${coverage(current)} пар дата × магазин. Рейтинг не показуємо.`} />;
  const rows = buildStoreAnalyticsRanking(current, data.comparison);
  const storeDirectory = new Map(stores.map((store) => [store.id, store]));
  const focused = data.spotIds.length === 1 ? storeDirectory.get(data.spotIds[0]) : null;

  if (focused) return <Space direction="vertical" size="middle" className="w-full">
    <Card size="small"><div className="flex flex-wrap items-start justify-between gap-3">
      <div><Typography.Title level={4} className="!mb-1">{focused.name}</Typography.Title>
        <Typography.Text type="secondary">{focused.address ?? "Адресу не вказано"} · {current.from} — {current.to}</Typography.Text></div>
      <Button onClick={onAllStores}>До всіх магазинів</Button>
    </div></Card>
    <Overview data={data} onSelectStore={onSelectStore} />
  </Space>;

  return <Space direction="vertical" size="middle" className="w-full">
    {data.comparison?.status === "incomplete" && <Alert type="warning" showIcon message="Порівняння недоступне"
      description={`${data.comparison.from} — ${data.comparison.to}: ${coverage(data.comparison)} пар дата × магазин. Зміни не розраховуємо з неповного періоду.`} />}
    <Card title="Рейтинг магазинів" extra={<Typography.Text type="secondary">{current.from} — {current.to}</Typography.Text>}>
    <Table rowKey="spotId" dataSource={rows} pagination={{ pageSize: 26, hideOnSinglePage: true }} scroll={{ x: 900 }}
      onRow={(row) => ({ onClick: () => onSelectStore(row.spotId), className: "cursor-pointer" })}
      columns={[
        { title: "Магазин", dataIndex: "storeName", fixed: "left" as const, width: 190,
          render: (value: string, row) => <Button type="link" className="h-auto p-0" onClick={(event) => {
            event.stopPropagation(); onSelectStore(row.spotId);
          }}>{value}</Button> },
        { title: "Виручка", dataIndex: "revenueMinor", align: "right" as const, sorter: (a, b) =>
          BigInt(a.revenueMinor) === BigInt(b.revenueMinor) ? 0 : BigInt(a.revenueMinor) > BigInt(b.revenueMinor) ? 1 : -1,
          render: formatMinor },
        { title: "Частка", dataIndex: "revenueSharePercent", align: "right" as const,
          render: (value: string | null) => value === null ? "—" : `${value}%` },
        { title: "Зміна", dataIndex: "deltaRevenueMinor", align: "right" as const, render: signedMinor },
        { title: "Зміна, %", dataIndex: "deltaRevenuePercent", align: "right" as const,
          render: (value: string | null) => value === null ? "—" : `${Number(value) > 0 ? "+" : ""}${value}%` },
        { title: "Фудкост", dataIndex: "classicFoodcostPercent", align: "right" as const,
          render: (value: string | null) => value === null ? "—" : <Tag color={foodcostColor(value)}>{value}%</Tag> },
        { title: "Повнота", align: "right" as const, render: () => `${current.completedCells / data.spotIds.length}/${current.expectedCells / data.spotIds.length}` },
      ]} />
    </Card>
  </Space>;
}

function Quality({ data, stores }: { data: StoreAnalyticsOverview; stores: StoreRow[] }) {
  const names = new Map(stores.map((store) => [store.id, store.name]));
  return <Space direction="vertical" size="middle" className="w-full">
    <Card title="Повнота продажів"><Statistic value={coverage(data.current)} suffix="дата × магазин" />
      <Typography.Text type="secondary">{data.current.from} — {data.current.to}</Typography.Text></Card>
    <Card title="Повнота чеків"><Statistic value={`${data.current.receipts.completedDays}/${data.current.receipts.expectedDays}`} suffix="днів" /></Card>
    {data.current.missing.length ? <Card title={`Пропуски продажів (${data.current.missingCount})`}><Table size="small" pagination={{ pageSize: 20 }}
      rowKey={(row) => `${row.date}:${row.spotId}`} dataSource={data.current.missing}
      columns={[{ title: "Дата", dataIndex: "date" }, { title: "Магазин", dataIndex: "spotId", render: (id: number) => names.get(id) ?? `#${id}` }]} /></Card> : <Alert type="success" showIcon message="Пропусків продажів у вибраному періоді немає" />}
    {data.current.receipts.missingDates.length > 0 && <Alert type="warning" showIcon message="Пропущені дні чеків"
      description={data.current.receipts.missingDates.join(", ")} />}
  </Space>;
}
