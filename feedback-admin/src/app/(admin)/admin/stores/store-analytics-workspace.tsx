"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, DatePicker, Empty, Input, Select, Skeleton, Space, Statistic, Table, Tabs, Tag, Typography } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { Bar, Line } from "@ant-design/plots";
import dayjs, { type Dayjs } from "dayjs";
import { useRouter, useSearchParams } from "next/navigation";
import type { StoreAnalyticsOverview, StoreAnalyticsWindow } from "@/lib/admin/storeAnalyticsOverview";
import { buildStoreAnalyticsRanking } from "@/lib/admin/storeAnalyticsRanking";
import type { StoreCategoryProductAnalytics } from "@/lib/admin/storeCategoryProductAnalytics";
import type { StoreAnalyticsComparison } from "@/lib/admin/storeAnalyticsComparison";
import type { StorePenetrationAnalytics } from "@/lib/admin/storePenetrationAnalytics";
import type { StoreRow } from "./page";

type Payload = { data: StoreAnalyticsOverview };
type CatalogPayload = { data: StoreCategoryProductAnalytics };
type ComparisonPayload = { data: StoreAnalyticsComparison };
type PenetrationPayload = { data: StorePenetrationAnalytics };
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

function formatMinorDecimal(value: string | null | undefined): string {
  if (value == null || !/^-?\d+(?:\.\d+)?$/.test(value)) return "—";
  return `${new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) / 100)} ₴`;
}

function formatQuantity(value: string, unit: string | null): string {
  const units: Record<string, string> = { p: "шт", pcs: "шт", piece: "шт", kg: "кг", g: "г", l: "л", ml: "мл" };
  return `${new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 3 }).format(Number(value))} ${unit ? units[unit.toLowerCase()] ?? unit : "од."}`;
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
  const [catalog, setCatalog] = useState<StoreCategoryProductAnalytics | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [comparisonData, setComparisonData] = useState<StoreAnalyticsComparison | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [penetrationData, setPenetrationData] = useState<StorePenetrationAnalytics | null>(null);
  const [penetrationError, setPenetrationError] = useState<string | null>(null);
  const [penetrationLoading, setPenetrationLoading] = useState(false);

  const endpointQuery = useMemo(() => {
    const params = new URLSearchParams(search.toString());
    params.set("tab", "analytics"); params.set("view", "overview");
    if (!params.has("period") && !params.has("days")) params.set("period", "30d");
    if (!params.has("spot_ids") && !params.has("spot_id")) params.set("spot_ids", "all");
    if (!params.has("comparison")) params.set("comparison", "previous");
    for (const key of ["page", "page_size", "search", "sort", "direction", "category_id", "product_id", "modification_id"]) params.delete(key);
    return params.toString();
  }, [search]);

  useEffect(() => {
    if (!["overview", "stores", "quality"].includes(view)) { setLoading(false); return; }
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
  }, [endpointQuery, view]);

  const catalogQuery = useMemo(() => {
    const params = new URLSearchParams(search.toString());
    params.set("tab", "analytics"); params.set("view", view);
    if (!params.has("period") && !params.has("days")) params.set("period", "30d");
    if (!params.has("spot_ids") && !params.has("spot_id")) params.set("spot_ids", "all");
    if (!params.has("comparison")) params.set("comparison", "previous");
    return params.toString();
  }, [search, view]);
  const exportQuery = useMemo(() => {
    const params = new URLSearchParams(search.toString());
    params.set("tab", "analytics"); params.set("view", view);
    params.delete("page"); params.delete("page_size");
    return params.toString();
  }, [search, view]);

  useEffect(() => {
    if (!["categories", "products"].includes(view)) return;
    const controller = new AbortController(); setCatalogLoading(true); setCatalogError(null);
    fetch(`/api/admin/stores/analytics/${view}?${catalogQuery}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "store_catalog_unavailable");
        return body as CatalogPayload;
      }).then((body) => setCatalog(body.data)).catch((reason: unknown) => {
        if ((reason as { name?: string }).name !== "AbortError") setCatalogError(reason instanceof Error ? reason.message : "store_catalog_unavailable");
      }).finally(() => { if (!controller.signal.aborted) setCatalogLoading(false); });
    return () => controller.abort();
  }, [catalogQuery, view]);

  useEffect(() => {
    if (view !== "comparison") return;
    const controller = new AbortController(); setComparisonLoading(true); setComparisonError(null);
    fetch(`/api/admin/stores/analytics/comparison?${catalogQuery}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "store_comparison_unavailable");
        return body as ComparisonPayload;
      }).then((body) => setComparisonData(body.data)).catch((reason: unknown) => {
        if ((reason as { name?: string }).name !== "AbortError") setComparisonError(reason instanceof Error ? reason.message : "store_comparison_unavailable");
      }).finally(() => { if (!controller.signal.aborted) setComparisonLoading(false); });
    return () => controller.abort();
  }, [catalogQuery, view]);

  useEffect(() => {
    if (view !== "penetration") return;
    const controller = new AbortController(); setPenetrationLoading(true); setPenetrationError(null);
    fetch(`/api/admin/stores/analytics/penetration?${catalogQuery}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "store_penetration_unavailable");
        return body as PenetrationPayload;
      }).then((body) => setPenetrationData(body.data)).catch((reason: unknown) => {
        if ((reason as { name?: string }).name !== "AbortError") {
          setPenetrationError(reason instanceof Error ? reason.message : "store_penetration_unavailable");
        }
      }).finally(() => { if (!controller.signal.aborted) setPenetrationLoading(false); });
    return () => controller.abort();
  }, [catalogQuery, view]);

  const nextUrl = (changes: Record<string, string | null>) => {
    const params = new URLSearchParams(search.toString()); params.set("tab", "analytics");
    for (const [key, value] of Object.entries(changes)) value === null ? params.delete(key) : params.set(key, value);
    return `/admin/stores?${params.toString()}`;
  };
  const update = (changes: Record<string, string | null>) => router.replace(nextUrl(changes));
  const drill = (changes: Record<string, string | null>) => router.push(nextUrl(changes));
  const range = period === "custom" ? [search.get("from"), search.get("to")] : [null, null];
  const comparisonMode = search.get("comparison") ?? "previous";
  const comparisonRange = comparisonMode === "custom" ? [search.get("compare_from"), search.get("compare_to")] : [null, null];
  const defaultCustomComparison = () => {
    const currentFrom = range[0] ? dayjs(range[0]) : dayjs().subtract(7, "day");
    const currentTo = range[1] ? dayjs(range[1]) : dayjs().subtract(1, "day");
    const days = Math.max(1, currentTo.diff(currentFrom, "day") + 1);
    const to = currentFrom.subtract(1, "day");
    return [to.subtract(days - 1, "day").format("YYYY-MM-DD"), to.format("YYYY-MM-DD")];
  };

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
          <Select value={comparisonMode} className="min-w-48" options={[
            { value: "previous", label: "Попередній період" }, { value: "custom", label: "Свій період" },
            { value: "off", label: "Без порівняння" },
          ]} onChange={(value) => {
            const defaults = value === "custom" ? defaultCustomComparison() : [null, null];
            update({ comparison: value, compare_from: defaults[0], compare_to: defaults[1] });
          }} /></label>
        {comparisonMode === "custom" && <label><Typography.Text type="secondary" className="mb-1 block text-xs">Період порівняння</Typography.Text>
          <DatePicker.RangePicker allowClear={false} value={comparisonRange[0] && comparisonRange[1]
            ? [dayjs(comparisonRange[0]), dayjs(comparisonRange[1])] : null}
            onChange={(value: null | [Dayjs | null, Dayjs | null]) => value?.[0] && value[1] && update({
              comparison: "custom", compare_from: value[0].format("YYYY-MM-DD"), compare_to: value[1].format("YYYY-MM-DD"),
            })} /></label>}
      </div>
    </Card>
    <Tabs activeKey={view} onChange={(key) => update({ view: key,
      category_id: ["products", "penetration"].includes(key) ? search.get("category_id") : null,
      product_id: key === "products" ? search.get("product_id") : null,
      modification_id: key === "products" ? search.get("modification_id") : null,
      page: ["categories", "products"].includes(key) ? "1" : null,
    })} items={[
      { key: "overview", label: "Огляд" }, { key: "stores", label: "Магазини" },
      { key: "categories", label: "Категорії" }, { key: "products", label: "Товари" },
      { key: "penetration", label: "Проникнення" }, { key: "comparison", label: "Порівняння" },
      { key: "quality", label: "Якість даних" },
    ]} />
    {view !== "comparison" && <div className="flex justify-end"><Button icon={<DownloadOutlined />}
      href={`/api/admin/stores/analytics/export?${exportQuery}`}>Завантажити CSV</Button></div>}
    {view === "penetration" ? penetrationLoading ? <Skeleton active paragraph={{ rows: 8 }} />
      : penetrationError ? <Alert type="error" showIcon message="Проникнення недоступне"
        description={penetrationError === "store_penetration_schema_missing" ? "Потрібно застосувати міграцію 055."
          : "Не вдалося прочитати перевірену чекову аналітику."} />
      : penetrationData ? <PenetrationView data={penetrationData} stores={stores}
          onSelectCategory={(categoryId) => update({ category_id: String(categoryId) })}
          onSelectStore={(spotId) => drill({ view: "stores", spot_ids: String(spotId), category_id: null })}
          onSelectProduct={(categoryId, productId, modificationId) => drill({ view: "products",
            category_id: String(categoryId), product_id: String(productId), modification_id: String(modificationId), page: "1" })} /> : <Empty />
      : view === "comparison" ? comparisonLoading ? <Skeleton active paragraph={{ rows: 8 }} />
      : comparisonError ? <Alert type="error" showIcon message="Порівняння недоступне"
        description={comparisonError === "store_comparison_schema_missing" ? "Потрібні міграції 050–053." : "Не вдалося прочитати перевірені агрегати."} />
      : comparisonData ? <ComparisonView data={comparisonData}
        onSelectStore={(spotId) => drill({ view: "stores", spot_ids: String(spotId) })}
        onSelectCategory={(categoryId) => drill({ view: "products", category_id: categoryId, page: "1" })} /> : <Empty />
      : ["categories", "products"].includes(view) ? catalogLoading ? <Skeleton active paragraph={{ rows: 8 }} />
      : catalogError ? <Alert type="error" showIcon message="Аналітика категорій і товарів недоступна"
        description={catalogError === "store_catalog_schema_missing" ? "Потрібно застосувати міграцію 052." : "Не вдалося прочитати перевірені агрегати."} />
      : catalog ? view === "categories" ? <CategoriesView data={catalog} onSelect={(categoryId) => drill({
          view: "products", category_id: categoryId === null ? "unknown" : String(categoryId), product_id: null,
          modification_id: null, page: "1",
        })} />
        : <ProductsView data={catalog} search={search.get("search") ?? ""} categoryId={search.get("category_id")}
          productId={search.get("product_id")}
          page={Number(search.get("page") ?? 1)} pageSize={Number(search.get("page_size") ?? 25)}
          sort={search.get("sort") ?? "revenue"} direction={search.get("direction") ?? "desc"}
          onUpdate={update} onDrill={drill} /> : <Empty />
      : loading ? <Skeleton active paragraph={{ rows: 8 }} /> : error ? <Alert
      type={error === "store_analytics_comparison_length_mismatch" ? "warning" : "error"} showIcon
      message={error === "store_analytics_comparison_length_mismatch"
        ? "Періоди мають різну тривалість" : "Аналітика магазинів недоступна"}
      description={error === "store_analytics_schema_missing" ? "Потрібно застосувати міграцію 050."
        : error === "store_analytics_comparison_length_mismatch"
          ? "Для коректного порівняння оберіть період з такою самою кількістю днів або виберіть «Попередній період»."
          : "Не вдалося прочитати перевірені агрегати."} />
      : data ? view === "quality" ? <Quality data={data} stores={stores} />
        : view === "stores" ? <StoresView data={data} stores={stores} onSelectStore={(spotId) => drill({ spot_ids: String(spotId) })}
          onAllStores={() => update({ spot_ids: "all" })} />
        : <Overview data={data} onSelectStore={(spotId) => drill({ view: "stores", spot_ids: String(spotId) })} /> : <Empty />}
  </Space>;
}

function ComparisonView({ data, onSelectStore, onSelectCategory }: { data: StoreAnalyticsComparison;
  onSelectStore: (spotId: number) => void; onSelectCategory: (categoryId: string) => void }) {
  if (data.status !== "complete") {
    const reasons: Record<Exclude<StoreAnalyticsComparison["reason"], null>, string> = {
      current_incomplete: "Поточний період неповний.", comparison_missing: "Оберіть період порівняння.",
      comparison_incomplete: "Період порівняння неповний.", catalog_incomplete: "Категорії за один із періодів неповні.",
      source_mismatch: "Джерела огляду та категорій мають різний scope або asOf.",
    };
    return <Alert type="warning" showIcon message="Порівняння не розраховане"
      description={data.reason ? reasons[data.reason] : "Немає перевірених даних."} />;
  }
  const storeChart = data.storeContributions.slice(0, 12).map((row) => ({
    name: row.name, delta: Number(row.deltaRevenueMinor) / 100,
    direction: BigInt(row.deltaRevenueMinor) >= 0n ? "Зростання" : "Падіння",
  }));
  return <Space direction="vertical" size="middle" className="w-full">
    <Alert type="info" showIcon message="Це не like-for-like порівняння"
      description="Порівнюється поточний вибраний склад магазинів. Історичні інтервали роботи точок ще не підтверджені." />
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Card><Statistic title={`${data.current.from} — ${data.current.to}`} value={formatMinor(data.current.revenueMinor)} /></Card>
      <Card><Statistic title={`${data.comparison.from} — ${data.comparison.to}`} value={formatMinor(data.comparison.revenueMinor)} /></Card>
      <Card><Statistic title="Зміна виручки" value={formatMinor(data.deltaRevenueMinor)}
        valueStyle={{ color: BigInt(data.deltaRevenueMinor ?? "0") >= 0n ? "#389e0d" : "#cf1322" }} /></Card>
      <Card><Statistic title="Зміна, %" value={data.deltaRevenuePercent === null ? "—" : `${data.deltaRevenuePercent}%`} /></Card>
    </div>
    <Card size="small"><Typography.Text>
      Виручка/день: {formatMinorDecimal(data.current.revenuePerDayMinor)} проти {formatMinorDecimal(data.comparison.revenuePerDayMinor)}.
      Абсолютні підсумки та денний темп показані окремо.
    </Typography.Text></Card>
    {!data.reconciliation.storeContributionsMatch && <Alert type="error" showIcon message="Внески магазинів не сходяться з загальною зміною"
      description="Графік і таблицю внесків приховано." />}
    {data.reconciliation.storeContributionsMatch && <>
      <Card title="Найбільші внески магазинів у зміну виручки"><Bar data={storeChart} xField="delta" yField="name" colorField="direction"
        scale={{ color: { range: ["#52c41a", "#ff4d4f"] } }} height={360}
        axis={{ x: { title: "Δ, ₴" } }} tooltip={{ items: [{ field: "delta", name: "Зміна" }] }} /></Card>
      <Card title="Внески магазинів"><Table rowKey="id" dataSource={data.storeContributions} pagination={false} scroll={{ x: 900 }}
        onRow={(row) => ({ onClick: () => onSelectStore(Number(row.id)), className: "cursor-pointer" })}
        columns={[
          { title: "Магазин", dataIndex: "name", fixed: "left" as const, width: 220,
            render: (value: string, row) => <Button type="link" className="h-auto p-0" onClick={(event) => {
              event.stopPropagation(); onSelectStore(Number(row.id));
            }}>{value}</Button> },
          { title: "Поточний", dataIndex: "currentRevenueMinor", align: "right" as const, render: formatMinor },
          { title: "Попередній", dataIndex: "comparisonRevenueMinor", align: "right" as const, render: formatMinor },
          { title: "Δ", dataIndex: "deltaRevenueMinor", align: "right" as const, render: signedMinor },
          { title: "Δ%", dataIndex: "deltaRevenuePercent", align: "right" as const,
            render: (value: string | null) => value === null ? "—" : `${value}%` },
        ]} /></Card>
    </>}
    {!data.reconciliation.categoryContributionsMatch ? <Alert type="warning" showIcon
      message="Внески категорій не сходяться з загальною зміною"
      description="Категорійну декомпозицію приховано; можливі категорії лише у попередньому періоді." />
      : <Card title="Внески категорій"><Table rowKey="id" dataSource={data.categoryContributions} pagination={{ pageSize: 15 }} scroll={{ x: 900 }}
        onRow={(row) => ({ onClick: () => onSelectCategory(row.id), className: "cursor-pointer" })}
        columns={[
          { title: "Категорія", dataIndex: "name", fixed: "left" as const, width: 220,
            render: (value: string, row) => <Button type="link" className="h-auto p-0" onClick={(event) => {
              event.stopPropagation(); onSelectCategory(row.id);
            }}>{value}</Button> },
          { title: "Поточний", dataIndex: "currentRevenueMinor", align: "right" as const, render: formatMinor },
          { title: "Попередній", dataIndex: "comparisonRevenueMinor", align: "right" as const, render: formatMinor },
          { title: "Δ", dataIndex: "deltaRevenueMinor", align: "right" as const, render: signedMinor },
          { title: "Δ%", dataIndex: "deltaRevenuePercent", align: "right" as const,
            render: (value: string | null) => value === null ? "—" : `${value}%` },
        ]} /></Card>}
  </Space>;
}

function PenetrationView({ data, stores, onSelectCategory, onSelectStore, onSelectProduct }: {
  data: StorePenetrationAnalytics;
  stores: StoreRow[];
  onSelectCategory: (categoryId: number) => void;
  onSelectStore: (spotId: number) => void;
  onSelectProduct: (categoryId: number, productId: number, modificationId: number) => void;
}) {
  if (data.status === "incomplete") return <Alert type="warning" showIcon
    message="Архів чеків за період неповний"
    description={`${data.coverage.from} — ${data.coverage.to}: ${data.coverage.completedDays}/${data.coverage.expectedDays} завершених днів. ` +
      `Метрики проникнення приховано. Пропущені дати: ${data.coverage.missingDates.join(", ") || "—"}.`} />;
  if (data.status === "mapping_incomplete") return <Alert type="error" showIcon
    message="Не всі рядки чеків зіставлені з категоріями"
    description={`${data.mapping.mappedRows}/${data.mapping.bridgeRows} зв’язків зіставлено; ${data.mapping.unmappedRows} без категорії. ` +
      "Рейтинги й відсотки приховано, щоб не показувати спотворений результат."} />;

  const names = new Map(stores.map((store) => [store.id, store.name]));
  const selected = data.selectedCategoryId === null ? null
    : data.categories.find((row) => row.categoryId === data.selectedCategoryId) ?? null;
  const categoryName = selected?.categoryName ?? (data.selectedCategoryId ? `Категорія #${data.selectedCategoryId}` : null);
  const networkPercent = data.denominator.eligibleReceipts === 0 ? "—"
    : selected?.penetrationPercent ?? (data.selectedCategoryId ? "0.00" : "—");
  const usesCurrentCatalog = data.categories.some((row) => row.categoryNameSource === "current_poster_catalog");
  const maxCategoryPercent = Math.max(1, ...data.categories.map((row) => Number(row.penetrationPercent ?? 0)));
  const storeRows = [...data.stores].sort((left, right) =>
    Number(right.penetrationPercent ?? -1) - Number(left.penetrationPercent ?? -1));
  const trend = data.trend.map((row) => ({ date: row.date, penetration: row.penetrationPercent === null ? null : Number(row.penetrationPercent) }));

  return <Space direction="vertical" size="middle" className="w-full">
    <Alert type="info" showIcon message="Проникнення у чеки"
      description="Частка distinct eligible чеків, у яких є категорія або товар. Категорії перетинаються: один чек може входити в кілька категорій, тому сума відсотків може перевищувати 100%." />
    {usesCurrentCatalog && <Alert type="info" showIcon message="Назви категорій — з поточного довідника Poster"
      description="Ідентифікатори категорій, зв’язки з чеками та всі розрахунки взяті з історичних фактів і не змінені." />}
    <Card size="small"><div className="flex flex-wrap items-end gap-3">
      <label className="min-w-72"><Typography.Text type="secondary" className="mb-1 block text-xs">Категорія для магазинів і тренду</Typography.Text>
        <Select showSearch optionFilterProp="label" value={data.selectedCategoryId ?? undefined} className="w-full"
          placeholder="Оберіть категорію" options={data.categories.map((row) => ({ value: row.categoryId, label: row.categoryName }))}
          onChange={onSelectCategory} /></label>
      <Typography.Text type="secondary">{data.coverage.from} — {data.coverage.to} · {data.spotIds.length} магазинів · станом на {new Date(data.asOf).toLocaleString("uk-UA")}</Typography.Text>
    </div></Card>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card><Statistic title="Чеки у знаменнику" value={data.denominator.eligibleReceipts ?? "—"} /></Card>
      <Card><Statistic title={categoryName ? `Чеки · ${categoryName}` : "Чеки вибраної категорії"}
        value={selected?.receiptCount ?? (data.selectedCategoryId ? 0 : "—")} /></Card>
      <Card><Statistic title="Проникнення мережі" value={networkPercent}
        suffix={data.selectedCategoryId && networkPercent !== "—" ? "%" : undefined} /></Card>
      <Card><Statistic title="Магазини з категорією" value={selected?.storeCount ?? (data.selectedCategoryId ? 0 : "—")}
        suffix={data.selectedCategoryId ? `/ ${data.spotIds.length}` : undefined} /></Card>
    </div>
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Категорії за проникненням" extra={<Typography.Text type="secondary">Натисніть для деталізації</Typography.Text>}>
        <div className="space-y-2" aria-label="Категорії за проникненням">
          {data.categories.slice(0, 15).map((row) => <button key={row.categoryId} type="button"
            className="block w-full rounded-lg border border-solid border-black/10 bg-transparent p-2 text-left transition hover:border-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
            onClick={() => onSelectCategory(row.categoryId)} aria-current={row.categoryId === data.selectedCategoryId ? "true" : undefined}>
            <span className="mb-1 flex items-center justify-between gap-3 text-sm"><span className="truncate">{row.categoryName}</span>
              <strong>{row.penetrationPercent === null ? "—" : `${row.penetrationPercent}%`}</strong></span>
            <span className="block h-2 overflow-hidden rounded bg-black/10"><span className="block h-full rounded bg-blue-500"
              style={{ width: `${Math.max(0, Number(row.penetrationPercent ?? 0) / maxCategoryPercent * 100)}%` }} /></span>
            <span className="mt-1 block text-xs opacity-60">{row.receiptCount} із {data.denominator.eligibleReceipts} чеків · {row.storeCount} магазинів</span>
          </button>)}
        </div>
      </Card>
      <Card title={categoryName ? `Магазини · ${categoryName}` : "Проникнення по магазинах"}>
        {!data.selectedCategoryId ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Оберіть категорію для карти магазинів" />
          : <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5" aria-label="Проникнення по магазинах">
            {storeRows.map((row) => {
              const value = Number(row.penetrationPercent ?? 0), alpha = row.penetrationPercent === null ? 0 : 0.08 + Math.min(0.42, value / 180);
              return <button key={row.spotId} type="button" onClick={() => onSelectStore(row.spotId)}
                className="aspect-square min-h-28 rounded-lg border border-solid p-3 text-left transition hover:border-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500"
                style={{ borderColor: "rgba(22,119,255,.35)", background: `rgba(22,119,255,${alpha})` }}
                title={`${names.get(row.spotId) ?? `Магазин #${row.spotId}`}: ${row.categoryReceipts} із ${row.eligibleReceipts} чеків`}>
                <span className="block text-xs opacity-65">{names.get(row.spotId) ?? `Магазин #${row.spotId}`}</span>
                <strong className="mt-2 block text-xl">{row.penetrationPercent === null ? "—" : `${row.penetrationPercent}%`}</strong>
                <span className="mt-1 block text-xs opacity-65">{row.categoryReceipts}/{row.eligibleReceipts} чеків</span>
              </button>;
            })}
          </div>}
      </Card>
    </div>
    {data.selectedCategoryId && <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title={`Тренд · ${categoryName}`}><Line data={trend} xField="date" yField="penetration" height={300}
        axis={{ y: { title: "%" } }} tooltip={{ items: [{ field: "penetration", name: "Проникнення" }] }} /></Card>
      <Card title="Рейтинг магазинів"><Table size="small" rowKey="spotId" dataSource={storeRows} pagination={{ pageSize: 10, hideOnSinglePage: true }}
        onRow={(row) => ({ onClick: () => onSelectStore(row.spotId), className: "cursor-pointer" })}
        columns={[
          { title: "Магазин", dataIndex: "spotId", render: (spotId: number) => <Button type="link" className="h-auto p-0"
            onClick={(event) => { event.stopPropagation(); onSelectStore(spotId); }}>{names.get(spotId) ?? `#${spotId}`}</Button> },
          { title: "Чеки", align: "right" as const, render: (_, row) => `${row.categoryReceipts}/${row.eligibleReceipts}` },
          { title: "Проникнення", dataIndex: "penetrationPercent", align: "right" as const,
            render: (value: string | null) => value === null ? "—" : `${value}%` },
        ]} /></Card>
    </div>}
    <Card title={categoryName ? `Товари · ${categoryName}` : "Товари у чеках"}><Table rowKey={(row) => `${row.productId}:${row.modificationId}`}
      dataSource={data.products} pagination={{ pageSize: 15, hideOnSinglePage: true }} scroll={{ x: 820 }}
      onRow={(row) => ({ onClick: () => onSelectProduct(row.categoryId, row.productId, row.modificationId), className: "cursor-pointer" })}
      columns={[
        { title: "Товар", dataIndex: "productName", fixed: "left" as const, width: 280,
          render: (value: string, row) => <Button type="link" className="h-auto whitespace-normal p-0 text-left" onClick={(event) => {
            event.stopPropagation(); onSelectProduct(row.categoryId, row.productId, row.modificationId);
          }}>{value}{row.modificationId ? ` · мод. ${row.modificationId}` : ""}</Button> },
        { title: "Чеки", dataIndex: "receiptCount", align: "right" as const },
        { title: "Проникнення мережі", dataIndex: "penetrationPercent", align: "right" as const,
          render: (value: string | null) => value === null ? "—" : `${value}%` },
        { title: "Магазини", dataIndex: "storeCount", align: "right" as const,
          render: (value: number) => `${value}/${data.spotIds.length}` },
      ]} /></Card>
    <Typography.Text type="secondary" className="text-xs">Історичний склад мережі не підтверджено. Порівнюється поточний вибраний список магазинів; це не like-for-like cohort.</Typography.Text>
  </Space>;
}

function CategoriesView({ data, onSelect }: { data: StoreCategoryProductAnalytics; onSelect: (categoryId: number | null) => void }) {
  if (data.current.status !== "complete") return <Alert type="warning" showIcon message="Період продажів неповний"
    description={`${data.current.from} — ${data.current.to}: ${data.current.completedCells}/${data.current.expectedCells} пар дата × магазин. Частковий рейтинг не показуємо.`} />;
  const chart = data.categories.slice(0, 12).map((row) => ({ category: row.categoryName, revenue: Number(row.revenueMinor) / 100 }));
  const usesCurrentCatalog = data.categories.some((row) => row.categoryNameSource === "current_poster_catalog");
  const missingNames = data.categories.filter((row) => row.categoryNameSource === "missing").length;
  return <Space direction="vertical" size="middle" className="w-full">
    {usesCurrentCatalog && <Alert type="info" showIcon message="Назви категорій — з поточного довідника Poster"
      description="Історичні category_id, суми та групування продажів не змінені." />}
    {missingNames > 0 && <Alert type="warning" showIcon message={`Не знайдено назв категорій: ${missingNames}`}
      description="Показуємо category_id. Фінансові показники не змінені." />}
    {data.comparison?.status === "incomplete" && <Alert type="warning" showIcon message="Порівняння недоступне"
      description="Попередній період неповний; зміни не розраховані." />}
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card title="Категорії за виручкою" className="xl:col-span-2"><Bar data={chart} xField="revenue" yField="category" height={360}
        axis={{ x: { title: "₴" } }} tooltip={{ items: [{ field: "revenue", name: "Виручка" }] }} /></Card>
      <Card title="Методика"><Space direction="vertical">
        <Typography.Text>Доля — від усієї виручки вибраних магазинів.</Typography.Text>
        <Typography.Text>Охват — магазини з додатною кількістю продажу категорії.</Typography.Text>
        <Typography.Text type="secondary">Проникнення у чеки доступне в окремій вкладці «Проникнення».</Typography.Text>
      </Space></Card>
    </div>
    <Card title="Рейтинг категорій"><Table rowKey={(row) => row.categoryId ?? "unknown"} dataSource={data.categories}
      pagination={{ pageSize: 25, hideOnSinglePage: true }} scroll={{ x: 1050 }}
      onRow={(row) => ({ onClick: () => onSelect(row.categoryId), className: "cursor-pointer" })}
      columns={[
        { title: "Категорія", dataIndex: "categoryName", fixed: "left" as const, width: 220,
          render: (value: string, row) => <Button type="link" className="h-auto p-0" onClick={(event) => { event.stopPropagation(); onSelect(row.categoryId); }}>{value}</Button> },
        { title: "Виручка", dataIndex: "revenueMinor", align: "right" as const, render: formatMinor },
        { title: "Частка", dataIndex: "revenueSharePercent", align: "right" as const, render: (value: string | null) => value === null ? "—" : `${value}%` },
        { title: "Зміна", dataIndex: "deltaRevenueMinor", align: "right" as const, render: signedMinor },
        { title: "Δ частки", dataIndex: "deltaSharePoints", align: "right" as const, render: (value: string | null) => value === null ? "—" : `${Number(value) > 0 ? "+" : ""}${value} п.п.` },
        { title: "Фудкост", dataIndex: "classicFoodcostPercent", align: "right" as const, render: (value: string | null) => value === null ? "—" : <Tag color={foodcostColor(value)}>{value}%</Tag> },
        { title: "Охват", align: "right" as const, render: (_, row) => `${row.storeCoverageCount}/${row.selectedStoreCount}` },
        { title: "Товарів", dataIndex: "distinctProductCount", align: "right" as const },
      ]} /></Card>
  </Space>;
}

function ProductsView({ data, search, categoryId, productId, page, pageSize, sort, direction, onUpdate, onDrill }: {
  data: StoreCategoryProductAnalytics; search: string; categoryId: string | null; productId: string | null; page: number; pageSize: number;
  sort: string; direction: string; onUpdate: (changes: Record<string, string | null>) => void;
  onDrill: (changes: Record<string, string | null>) => void;
}) {
  if (data.current.status !== "complete") return <Alert type="warning" showIcon message="Період продажів неповний"
    description={`${data.current.from} — ${data.current.to}: ${data.current.completedCells}/${data.current.expectedCells} пар дата × магазин. Часткові товари не показуємо.`} />;
  const selectedProduct = data.products.rows.length === 1 && productId !== null ? data.products.rows[0] : null;
  const trend = data.trend.map((row) => ({ date: row.date, revenue: Number(row.revenueMinor) / 100 }));
  const usesCurrentCatalog = data.products.rows.some((row) => row.categoryNameSource === "current_poster_catalog");
  const missingNames = data.products.rows.filter((row) => row.categoryNameSource === "missing").length;
  return <Space direction="vertical" size="middle" className="w-full">
    {usesCurrentCatalog && <Alert type="info" showIcon message="Назви категорій — з поточного довідника Poster"
      description="Історичні category_id, суми та групування продажів не змінені." />}
    {missingNames > 0 && <Alert type="warning" showIcon message={`Не знайдено назв категорій у цій вибірці: ${missingNames}`}
      description="Показуємо category_id. Фінансові показники не змінені." />}
    <Card size="small"><div className="flex flex-wrap items-end gap-3">
      <label className="min-w-64 flex-1"><Typography.Text type="secondary" className="mb-1 block text-xs">Пошук товару</Typography.Text>
        <Input.Search key={search} allowClear defaultValue={search} placeholder="Назва товару" onSearch={(value) => onUpdate({ search: value.trim() || null, page: "1", product_id: null, modification_id: null })} /></label>
      <label><Typography.Text type="secondary" className="mb-1 block text-xs">Категорія</Typography.Text>
        <Select allowClear value={categoryId ?? undefined} className="min-w-56" placeholder="Усі категорії"
          options={data.categories.map((row) => ({ value: row.categoryId === null ? "unknown" : String(row.categoryId), label: row.categoryName }))}
          onChange={(value?: string) => onUpdate({ category_id: value ?? null, page: "1", product_id: null, modification_id: null })} /></label>
      <Select value={sort} options={[{ value: "revenue", label: "За виручкою" }, { value: "change", label: "За зміною" }, { value: "name", label: "За назвою" }]}
        onChange={(value) => onUpdate({ sort: value, page: "1" })} />
      <Select value={direction} options={[{ value: "desc", label: "За спаданням" }, { value: "asc", label: "За зростанням" }]}
        onChange={(value) => onUpdate({ direction: value, page: "1" })} />
    </div></Card>
    {selectedProduct && <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
      <Card title={selectedProduct.productName} extra={<Button onClick={() => onUpdate({ product_id: null, modification_id: null, page: "1" })}>До списку</Button>}><Space direction="vertical">
        <Typography.Text type="secondary">Poster ID {selectedProduct.productId} · модифікація {selectedProduct.modificationId}</Typography.Text>
        <Statistic title="Виручка" value={formatMinor(selectedProduct.revenueMinor)} />
        <Typography.Text>Кількість: {formatQuantity(selectedProduct.quantity, selectedProduct.unit)}</Typography.Text>
        <Typography.Text>Середня ціна реалізації: {formatMinorDecimal(selectedProduct.effectivePriceMinor)} / {selectedProduct.unit ?? "од."}</Typography.Text>
      </Space></Card>
      <Card title="Динаміка виручки" className="xl:col-span-2"><Line data={trend} xField="date" yField="revenue" height={250}
        axis={{ y: { title: "₴" } }} tooltip={{ items: [{ field: "revenue", name: "Виручка" }] }} /></Card>
    </div>}
    {data.comparison?.status === "incomplete" && <Alert type="warning" showIcon message="Порівняння недоступне" description="Попередній період неповний; зміни не розраховані." />}
    <Card title="Товари"><Table rowKey={(row) => `${row.productId}:${row.modificationId}:${row.categoryId ?? "unknown"}:${row.unit ?? "none"}`}
      dataSource={data.products.rows} scroll={{ x: 1400 }} pagination={{ current: page, pageSize, total: data.products.total,
        showSizeChanger: true, pageSizeOptions: [25, 50, 100], onChange: (nextPage, nextSize) => onUpdate({ page: String(nextPage), page_size: String(nextSize) }) }}
      columns={[
        { title: "Товар", dataIndex: "productName", fixed: "left" as const, width: 260,
          render: (value: string, row) => <Button type="link" className="h-auto whitespace-normal p-0 text-left" onClick={() => onDrill({
            product_id: String(row.productId), modification_id: String(row.modificationId), page: "1",
          })}>{value}{row.modificationId ? ` · мод. ${row.modificationId}` : ""}</Button> },
        { title: "Категорія", dataIndex: "categoryName", width: 180 },
        { title: "Кількість", align: "right" as const, render: (_, row) => formatQuantity(row.quantity, row.unit) },
        { title: "Виручка", dataIndex: "revenueMinor", align: "right" as const, render: formatMinor },
        { title: "Частка мережі", dataIndex: "revenueSharePercent", align: "right" as const, render: (value: string | null) => value === null ? "—" : `${value}%` },
        { title: "Зміна", dataIndex: "deltaRevenueMinor", align: "right" as const, render: signedMinor },
        { title: "Фудкост", dataIndex: "classicFoodcostPercent", align: "right" as const, render: (value: string | null) => value === null ? "—" : <Tag color={foodcostColor(value)}>{value}%</Tag> },
        { title: "Сер. ціна", dataIndex: "effectivePriceMinor", align: "right" as const, render: (value: string | null, row) => value === null ? "—" : `${formatMinorDecimal(value)} / ${row.unit ?? "од."}` },
        { title: "Охват", align: "right" as const, render: (_, row) => `${row.storeCoverageCount}/${row.selectedStoreCount}` },
      ]} /></Card>
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
