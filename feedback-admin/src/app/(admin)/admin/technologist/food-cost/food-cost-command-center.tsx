"use client";

import { Line } from "@ant-design/plots";
import { ArrowRightOutlined } from "@ant-design/icons";
import { Alert, Card, Empty, Radio, Select, Space, Statistic, Table, Tag, Tooltip, Typography, theme as antdTheme } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import { useState } from "react";
import { productHref } from "@/lib/admin/productCatalog";
import { useAdminChartTheme } from "@/lib/admin/useAdminChartTheme";
import type { CommandCenterView } from "@/lib/admin/foodcostCommandCenter";
import { foodcostStoreCountLabel } from "@/lib/admin/foodcostLabels";
import { foodcostBand } from "@/lib/admin/foodcostBands";
import type { FoodcostHeatmap, FoodcostHeatmapRow } from "@/lib/admin/foodcostHeatmap";
import { FoodcostRate, FoodcostStatusTag, formatFoodcostPercent } from "@/components/admin/foodcost/FoodcostStatus";

type Category = NonNullable<CommandCenterView["categories"]>[number];
type Product = NonNullable<CommandCenterView["products"]>[number];
type Attention = NonNullable<CommandCenterView["attention"]>;

const numberFormat = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integerFormat = new Intl.NumberFormat("uk-UA");
const dateFormat = new Intl.DateTimeFormat("uk-UA", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
const timestampFormat = new Intl.DateTimeFormat("uk-UA", {
  timeZone: "Europe/Kyiv", dateStyle: "short", timeStyle: "short",
});

function money(minor: number | null): string {
  return minor === null || !Number.isFinite(minor) ? "Н/Д" : `${numberFormat.format(minor / 100)} ₴`;
}

function difference(metrics: NonNullable<CommandCenterView["metrics"]>): number | null {
  const { foodCostPercent, nettoFoodCostPercent } = metrics;
  return foodCostPercent === null || nettoFoodCostPercent === null ? null : foodCostPercent - nettoFoodCostPercent;
}

function categoryLabel(category: Category): string {
  if (category.categoryId === null) return category.displayName ?? "Без категорії";
  return category.displayName?.trim() || `Категорія #${category.categoryId}`;
}

function categoryHref(spotId: number | null, days: number, categoryId?: number | null): string {
  const base = `/admin/technologist/food-cost?tab=categories&spot_id=${spotId ?? "all"}&days=${days}`;
  return categoryId === undefined ? base : `${base}&category_id=${categoryId ?? "__unknown"}`;
}

function productFoodCostHref(productId: number, spotId: number | null, days: number): string {
  return `${productHref(productId)}?tab=foodcost&spot_id=${spotId ?? "all"}&days=${days}`;
}

function comparePaid(a: Category, b: Category): number;
function comparePaid(a: Product, b: Product): number;
function comparePaid(a: Category | Product, b: Category | Product): number {
  const paid = b.payedSumMinor - a.payedSumMinor;
  if (paid !== 0) return paid;
  const nameA = "productName" in a ? a.productName : a.displayName ?? "";
  const nameB = "productName" in b ? b.productName : b.displayName ?? "";
  const name = nameA.localeCompare(nameB, "uk");
  if (name !== 0) return name;
  const idA = "productId" in a ? a.productId : a.categoryId ?? -1;
  const idB = "productId" in b ? b.productId : b.categoryId ?? -1;
  return idA - idB;
}

function periodLabel(date: string): string {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}

function timeLabel(value: string | null): string {
  if (!value) return "Н/Д";
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? "Н/Д" : timestampFormat.format(timestamp);
}

function deltaLabel(value: number | null, suffix: string): string {
  return value === null || !Number.isFinite(value)
    ? "Порівняння недоступне"
    : `${value > 0 ? "+" : ""}${numberFormat.format(value)} ${suffix}`;
}

function deltaStyle(value: number | null, lowerIsBetter: boolean,
  successColor: string, errorColor: string): CSSProperties | undefined {
  if (value === null || !Number.isFinite(value) || value === 0) return undefined;
  const isGood = lowerIsBetter ? value < 0 : value > 0;
  return { color: isGood ? successColor : errorColor };
}

function methodLabel(method: "profit" | "netto"): string {
  return method === "profit" ? "За прибутком" : "Без ПДВ Poster";
}

function redMethodTags(methods: ("profit" | "netto")[]) {
  return methods.map((method) => <Tag color="red" key={method}>{methodLabel(method)} · {">45 %"}</Tag>);
}

function attentionRates(row: { foodCostPercent: number | null; nettoFoodCostPercent: number | null }) {
  return <Space wrap size={[4, 4]}>
    <Typography.Text type="secondary">За прибутком: {formatFoodcostPercent(row.foodCostPercent)}</Typography.Text>
    <Typography.Text type="secondary">Без ПДВ: {formatFoodcostPercent(row.nettoFoodCostPercent)}</Typography.Text>
  </Space>;
}

function AttentionQueue({ data, periodDays, spotId, token }: { data: Attention; periodDays: number;
  spotId: number | null; token: ReturnType<typeof antdTheme.useToken>["token"] }) {
  const categories = data.categories.slice(0, 5);
  const products = data.products.slice(0, 5);
  const hasRows = categories.length > 0 || products.length > 0;
  const hasQuality = data.quality.length > 0;
  return <Card size="small" title="Що перевірити перш за все">
    <Space direction="vertical" size="middle" className="w-full">
      {hasQuality && <Space direction="vertical" size="small" className="w-full">
        <Typography.Text strong>Якість даних · пріоритет</Typography.Text>
        {data.quality.map((issue) => <Alert key={issue.code}
          type={issue.code === "netto_unavailable" ? "warning" : "info"}
          showIcon message={issue.title} description={issue.detail} />)}
      </Space>}
      {categories.length > 0 && <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Typography.Text strong>Червоні категорії · за оборотом</Typography.Text>
          <Link href={categoryHref(spotId, periodDays)}>Усі категорії <ArrowRightOutlined /></Link>
        </div>
        <Space direction="vertical" size="small" className="w-full">
          {categories.map((row) => <div key={`attention-category:${row.categoryId ?? "none"}`}
            className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-md p-2"
            style={{ background: token.colorErrorBg }}>
            <div className="min-w-0 flex-1">
              <Link href={categoryHref(spotId, periodDays, row.categoryId)}>{row.displayName?.trim() || (row.categoryId === null ? "Без категорії" : `Категорія #${row.categoryId}`)} <ArrowRightOutlined /></Link>
              <div>{attentionRates(row)}</div>
              <Space wrap size={[0, 0]}>{redMethodTags(row.redMethods)}</Space>
            </div>
            <Typography.Text strong className="whitespace-nowrap">Оплачено {money(row.payedSumMinor)}</Typography.Text>
          </div>)}
          {data.categories.length > categories.length && <Typography.Text type="secondary" className="text-xs">Ще {data.categories.length - categories.length} категорій — у повному списку.</Typography.Text>}
        </Space>
      </div>}
      {products.length > 0 && <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Typography.Text strong>Червоні товари · за оборотом</Typography.Text>
          <Link href={`/admin/technologist/food-cost?tab=products&spot_id=${spotId ?? "all"}&days=${periodDays}`}>Усі товари <ArrowRightOutlined /></Link>
        </div>
        <Space direction="vertical" size="small" className="w-full">
          {products.map((row) => <div key={`attention-product:${row.productId}`}
            className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-md p-2"
            style={{ background: token.colorErrorBg }}>
            <div className="min-w-0 flex-1">
              {row.currentCatalogPresent
                ? <Link href={productFoodCostHref(row.productId, spotId, periodDays)}>{row.productName} <ArrowRightOutlined /></Link>
                : <Space wrap><Typography.Text>{row.productName}</Typography.Text><Typography.Text type="secondary">#{row.productId}</Typography.Text><Tag>Немає в поточному каталозі</Tag></Space>}
              <div>{attentionRates(row)}</div>
              <Space wrap size={[0, 0]}>{redMethodTags(row.redMethods)}</Space>
            </div>
            <Typography.Text strong className="whitespace-nowrap">Оплачено {money(row.payedSumMinor)}</Typography.Text>
          </div>)}
          {data.productsRemaining > 0 && <Typography.Text type="secondary" className="text-xs">Ще {data.productsRemaining} товарів — у повному списку.</Typography.Text>}
        </Space>
      </div>}
      {!hasRows && !hasQuality && <Alert type="success" showIcon message="У червоній зоні позицій немає"
        description="У повному знімку не знайдено категорій або товарів із фудкостом понад 45 % за жодною методикою." />}
      {hasRows && <Typography.Text type="secondary" className="text-xs">
        Порядок — за оплаченою сумою. Категорії й товари показано окремо; суми між рівнями не додаються. Це черга перевірки, а не оцінка втраченої прибутковості.
      </Typography.Text>}
    </Space>
  </Card>;
}

function FoodcostHeatmapCard({ heatmap, periodDays, spotId, totalLabel, token }: {
  heatmap: FoodcostHeatmap; periodDays: number; spotId: number | null; totalLabel: string;
  token: ReturnType<typeof antdTheme.useToken>["token"];
}) {
  const [method, setMethod] = useState<"profit" | "netto">("profit");
  const rows: (FoodcostHeatmapRow & { isTotal?: boolean })[] = [
    { ...heatmap.total, displayName: totalLabel, isTotal: true }, ...heatmap.rows,
  ];
  const selectedRate = (cell: FoodcostHeatmapRow["cells"][number]) =>
    method === "profit" ? cell.foodCostPercent : cell.nettoFoodCostPercent;
  const bandStyle = (value: number | null): CSSProperties => {
    const band = foodcostBand(value);
    const background = band === "green" ? token.colorSuccessBg
      : band === "yellow" ? token.colorWarningBg
        : band === "red" ? token.colorErrorBg : token.colorFillTertiary;
    return { background, color: token.colorText, borderColor: token.colorBorderSecondary };
  };
  const statusLabel = (value: number | null): string => {
    const band = foodcostBand(value);
    return band === "green" ? "Норма" : band === "yellow" ? "Увага"
      : band === "red" ? "Високий" : "Н/Д";
  };
  const methodName = method === "profit" ? "За прибутком товарів" : "Без ПДВ Poster";
  return <Card size="small" title="Фудкост за категоріями · теплова карта"
    extra={<Radio.Group aria-label="Методика фудкосту для теплової карти" size="small" value={method}
      onChange={(event) => setMethod(event.target.value)} optionType="button" buttonStyle="solid">
      <Radio.Button value="profit">За прибутком</Radio.Button>
      <Radio.Button value="netto">Без ПДВ Poster</Radio.Button>
    </Radio.Group>}>
    <Space direction="vertical" size="small" className="w-full">
      <Typography.Text type="secondary" className="text-xs">
        {periodDays <= 14 ? "Показано кожен день вибраного періоду." : "Повні календарні тижні згруповано; неповні крайові тижні залишено днями."}
        {" "}Клік по комірці відкриє цю категорію за весь вибраний період — фільтр за одним днем поки не підтримується.
      </Typography.Text>
      <Space wrap size={[8, 4]} aria-label="Легенда фудкосту">
        <Tag color="green">Норма · &lt;35 %</Tag><Tag color="gold">Увага · 35–45 %</Tag>
        <Tag color="red">Високий · &gt;45 %</Tag><Tag>Н/Д · немає оплат</Tag>
      </Space>
      <div role="region" aria-label="Теплова карта фудкосту за категоріями" tabIndex={0}
        className="max-w-full overflow-x-auto rounded-md border" style={{ borderColor: token.colorBorderSecondary }}>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-40 px-3 py-2 text-left"
                style={{ background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>Категорія</th>
              {heatmap.bins.map((bin) => <th key={bin.key} scope="col" title={`${bin.from} — ${bin.to}`}
                className="min-w-24 px-2 py-2 text-center whitespace-nowrap"
                style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}>{bin.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <tr key={row.isTotal ? "heatmap:total" : `heatmap:${row.categoryId ?? "unknown"}`}>
              <th scope="row" className="sticky left-0 z-[1] px-3 py-2 text-left whitespace-nowrap"
                style={{ background: token.colorBgContainer, borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                {row.isTotal ? <Typography.Text strong>{row.displayName}</Typography.Text>
                  : <Link href={categoryHref(spotId, periodDays, row.categoryId)}>{row.displayName} <ArrowRightOutlined /></Link>}
              </th>
              {row.cells.map((cell, index) => {
                const value = selectedRate(cell);
                const band = foodcostBand(value);
                const bin = heatmap.bins[index];
                const otherRate = method === "profit" ? cell.nettoFoodCostPercent : cell.foodCostPercent;
                const title = <Space direction="vertical" size={2}>
                  <Typography.Text strong>{row.displayName} · {bin.from === bin.to ? bin.from : `${bin.from} — ${bin.to}`}</Typography.Text>
                  <Typography.Text>Оплачено: {money(cell.payedSumMinor)}</Typography.Text>
                  <Typography.Text>Унікальних товарів: {integerFormat.format(cell.distinctProducts)}</Typography.Text>
                  <Typography.Text>Покриття: {integerFormat.format(cell.completedCells)}/{integerFormat.format(cell.expectedCells)} пар дата × магазин</Typography.Text>
                  <Typography.Text>{methodName}: {formatFoodcostPercent(value)} · {statusLabel(value)}</Typography.Text>
                  <Typography.Text type="secondary">Інша методика: {formatFoodcostPercent(otherRate)}</Typography.Text>
                </Space>;
                const content = <span className="inline-flex min-w-20 flex-col items-center rounded px-2 py-1 leading-tight"
                  style={{ ...bandStyle(value), border: `1px solid ${token.colorBorderSecondary}` }}>
                  <span>{formatFoodcostPercent(value)}</span>
                  <span className="text-[10px]">{statusLabel(value)}</span>
                </span>;
                return <td key={cell.binKey} className="px-1.5 py-1 text-center"
                  style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
                  <Tooltip title={title}>
                    {row.isTotal ? content : <Link aria-label={`${row.displayName}; ${bin.from} — ${bin.to}; ${methodName} ${formatFoodcostPercent(value)}; ${statusLabel(value)}. Показати категорію за весь період`}
                      href={categoryHref(spotId, periodDays, row.categoryId)}>{content}</Link>}
                  </Tooltip>
                  {band === "unknown" && <span className="sr-only">Немає оплат для розрахунку фудкосту.</span>}
                </td>;
              })}
            </tr>)}
          </tbody>
        </table>
      </div>
    </Space>
  </Card>;
}

export function FoodCostCommandCenter({ data }: { data: CommandCenterView }) {
  const router = useRouter();
  const { token } = antdTheme.useToken();
  const chartTheme = useAdminChartTheme();
  const periodDays = data.spotCount ? data.expectedCells / data.spotCount : 7;
  const hasStoreFilter = data.stores.length > 0;
  const changeStore = (value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("spot_id", value);
    router.push(`${url.pathname}?${url.searchParams.toString()}`);
  };
  const storeFilter = hasStoreFilter && <div className="flex flex-wrap items-center justify-between gap-3">
    <Typography.Text type="secondary">Магазин</Typography.Text>
    <Select aria-label="Фільтр за магазином" className="min-w-56"
      value={data.selectedSpotId === null ? "all" : String(data.selectedSpotId)}
      onChange={changeStore}
      options={[{ value: "all", label: "Уся мережа" }, ...data.stores.map((store) => ({ value: String(store.id), label: store.name }))]} />
  </div>;

  if (data.status !== "complete") {
    return <Space direction="vertical" size="middle" className="w-full">{storeFilter}
      <Alert type="warning" showIcon message="Знімок продажів неповний"
        description={`${data.dateFrom} — ${data.dateTo}: ${integerFormat.format(data.completedCells)} із ${integerFormat.format(data.expectedCells)} пар дата × магазин. Часткові KPI, графіки та рейтинги не показуємо. Для довшого періоду потрібна дозагрузка історії Poster.`} />
    </Space>;
  }

  if (!data.metrics || !data.days || !data.categories || !data.products) {
    return <Alert type="warning" showIcon message="Огляд фудкосту поки недоступний"
      description="Для повного знімка бракує одного або кількох узгоджених блоків даних. Часткові підсумки не показуємо." />;
  }

  const metrics = data.metrics;
  const comparison = data.comparison;
  const previousIsComplete = comparison?.previous.status === "complete" && comparison.previous.metrics !== null;
  const delta = difference(metrics);
  const categories = [...data.categories].sort(comparePaid);
  const products = [...data.products].sort(comparePaid);
  const selectedStoreName = data.selectedSpotId === null ? null
    : data.stores.find((store) => store.id === data.selectedSpotId)?.name ?? null;
  const currentSpotParam = data.selectedSpotId === null ? "all" : String(data.selectedSpotId);
  const chartRows = data.days.flatMap((day) => {
    const dayMetrics = day.metrics;
    const date = periodLabel(day.businessDate);
    return [
      { date, businessDate: day.businessDate, method: "За прибутком товарів", value: dayMetrics.foodCostPercent, payedSumMinor: dayMetrics.payedSumMinor },
      { date, businessDate: day.businessDate, method: "Без ПДВ Poster", value: dayMetrics.nettoFoodCostPercent, payedSumMinor: dayMetrics.payedSumMinor },
    ].filter((row): row is typeof row & { value: number } => row.value !== null && Number.isFinite(row.value));
  });
  return <Space direction="vertical" size="middle" className="w-full">
    <Alert type="info" showIcon message={`${selectedStoreName ? `Магазин · ${selectedStoreName}` : "Поточна мережа"} · ${data.dateFrom} — ${data.dateTo}`}
      description={`${foodcostStoreCountLabel(data.spotCount)} · ${integerFormat.format(data.completedCells)}/${integerFormat.format(data.expectedCells)} пар дата × магазин · джерела від ${timeLabel(data.sourceFetchedAt)} до ${timeLabel(data.newestSourceFetchedAt)}. Історичний склад мережі не підтверджено.`} />

    {comparison && <Alert type={previousIsComplete ? "info" : "warning"} showIcon
      message={previousIsComplete
        ? `Порівняння з попередніми ${periodDays} днями · ${comparison.previous.from} — ${comparison.previous.to}`
        : comparison.previous.reasonCode === "not_evaluated"
          ? "Порівняння не оцінювали: поточний період неповний"
          : `Попередній період неповний · ${comparison.previous.from} — ${comparison.previous.to}`}
      description={previousIsComplete
        ? `${integerFormat.format(comparison.previous.completedCells)} / ${integerFormat.format(comparison.previous.expectedCells)} пар дата × магазин. Дельти показано відносно цих самих магазинів.`
        : comparison.previous.reasonCode === "not_evaluated"
          ? "Поточні показники залишаються доступними лише за повного поточного знімка. Порівняння без повної бази не розраховується."
          : `${integerFormat.format(comparison.previous.completedCells)} із ${integerFormat.format(comparison.previous.expectedCells)} пар дата × магазин. Поточні повні показники збережено; дельти не розраховуємо.`} />}

    {storeFilter}

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card size="small"><Statistic title="Оплачено" value={money(metrics.payedSumMinor)} />
        <Typography.Text type="secondary" className="text-xs">
          {deltaLabel(comparison?.paidDeltaPercent ?? null, "% до попереднього періоду")}
        </Typography.Text></Card>
      <Card size="small"><Statistic title="Фудкост · за прибутком товарів" value={formatFoodcostPercent(metrics.foodCostPercent)} />
        <FoodcostStatusTag value={metrics.foodCostPercent} />
        <div><Typography.Text type="secondary" className="text-xs" style={deltaStyle(comparison?.foodCostDeltaPoints ?? null, true, token.colorSuccess, token.colorError)}>
          {deltaLabel(comparison?.foodCostDeltaPoints ?? null, "в. п. до попереднього періоду")}
        </Typography.Text></div></Card>
      <Card size="small"><Statistic title="Фудкост · без ПДВ Poster" value={formatFoodcostPercent(metrics.nettoFoodCostPercent)} />
        <FoodcostStatusTag value={metrics.nettoFoodCostPercent} />
        <div><Typography.Text type="secondary" className="text-xs" style={deltaStyle(comparison?.nettoFoodCostDeltaPoints ?? null, true, token.colorSuccess, token.colorError)}>
          {deltaLabel(comparison?.nettoFoodCostDeltaPoints ?? null, "в. п. до попереднього періоду")}
        </Typography.Text></div></Card>
      <Card size="small"><Statistic title="Різниця методик" value={delta === null ? "Н/Д" : `${numberFormat.format(delta)} в. п.`} />
        <div><Typography.Text type="secondary" className="text-xs">
          {deltaLabel(comparison?.methodGapDeltaPoints ?? null, "в. п. зміни")}
        </Typography.Text></div></Card>
    </div>

    <Typography.Text type="secondary" className="text-xs">
      Межі для кожної методики окремо: менше 35 % — норма; 35–45 % включно — увага; понад 45 % — високий фудкост. Н/Д не має кольорового статусу.
    </Typography.Text>

    {data.attention && <AttentionQueue data={data.attention} periodDays={periodDays}
      spotId={data.selectedSpotId} token={token} />}

    <div className="grid grid-cols-1 gap-3">
      <Card size="small" title="Фудкост за днями">
        {chartRows.length ? <>
          <Line data={chartRows} xField="date" yField="value" seriesField="method" colorField="method"
            scale={{ color: { range: [token.colorPrimary, token.colorTextSecondary] } }} theme={chartTheme} smooth
            height={250} legend={{ position: "top" }}
            axis={{ y: { labelFormatter: (value: string) => `${value} %` } }}
            tooltip={{ formatter: (datum: { method: string; value: number; payedSumMinor: number }) => ({
              name: datum.method, value: `${numberFormat.format(datum.value)} % · ${money(datum.payedSumMinor)}`,
            }) }} />
          <Typography.Text type="secondary" className="text-xs">
            Порівняння двох методик на однаковій базі оплаченої суми. Кольори ліній позначають методики, а не рівень фудкосту.
          </Typography.Text>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm">Табличні значення графіка</summary>
            <Table rowKey="businessDate" size="small" pagination={false} dataSource={data.days}
              columns={[
                { title: "День", dataIndex: "businessDate", render: (value: string) => periodLabel(value) },
                { title: "Оплачено", align: "right", render: (_value, row) => money(row.metrics.payedSumMinor) },
                { title: "За прибутком товарів", align: "right", render: (_value, row) => <FoodcostRate value={row.metrics.foodCostPercent} /> },
                { title: "Без ПДВ Poster", align: "right", render: (_value, row) => <FoodcostRate value={row.metrics.nettoFoodCostPercent} /> },
              ]} />
          </details>
        </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Немає значень для графіка за днями" />}
      </Card>
    </div>

    {data.heatmap && <FoodcostHeatmapCard heatmap={data.heatmap} periodDays={periodDays}
      spotId={data.selectedSpotId} totalLabel={selectedStoreName ?? "Уся мережа"} token={token} />}

    <Card size="small" title="Категорії за сумою продажів" extra={<Link href={categoryHref(data.selectedSpotId, periodDays)}>Усі категорії <ArrowRightOutlined /></Link>}>
      <Table<Category> rowKey={(row) => String(row.categoryId ?? "uncategorized")} size="small" scroll={{ x: 760 }}
        pagination={{ pageSize: 8, showSizeChanger: false }} dataSource={categories} columns={[
          { title: "Категорія", dataIndex: "displayName", render: (_value, row) => <Link href={categoryHref(data.selectedSpotId, periodDays, row.categoryId)}>{categoryLabel(row)}</Link> },
          { title: "Оплачено", dataIndex: "payedSumMinor", align: "right", sorter: (a, b) => a.payedSumMinor - b.payedSumMinor, defaultSortOrder: "descend", render: money },
          { title: "За прибутком товарів", dataIndex: "foodCostPercent", align: "right", render: (value: number | null) => <FoodcostRate value={value} /> },
          { title: "Без ПДВ Poster", dataIndex: "nettoFoodCostPercent", align: "right", render: (value: number | null) => <FoodcostRate value={value} /> },
        ]} />
    </Card>

    <Card size="small" title="12 позицій з найбільшим оборотом" extra={<Link href={`/admin/technologist/food-cost?tab=products&spot_id=${currentSpotParam}&days=${periodDays}`}>Усі позиції <ArrowRightOutlined /></Link>}>
      <Table<Product> rowKey="productId" size="small" scroll={{ x: 800 }}
        pagination={{ pageSize: 10, showSizeChanger: false }} dataSource={products} columns={[
          { title: "Позиція", dataIndex: "productName", render: (_value, row) => <Space wrap>
            {row.currentCatalogPresent ? <Link href={productFoodCostHref(row.productId, data.selectedSpotId, periodDays)}>{row.productName}</Link>
              : <Typography.Text>{row.productName}</Typography.Text>}
            <Typography.Text type="secondary" className="text-xs">#{row.productId}</Typography.Text>
            {!row.currentCatalogPresent && <Tag>Немає в поточному каталозі</Tag>}
          </Space> },
          { title: "Оплачено", dataIndex: "payedSumMinor", align: "right", sorter: (a, b) => a.payedSumMinor - b.payedSumMinor, defaultSortOrder: "descend", render: money },
          { title: "За прибутком товарів", dataIndex: "foodCostPercent", align: "right", render: (value: number | null) => <FoodcostRate value={value} /> },
          { title: "Без ПДВ Poster", dataIndex: "nettoFoodCostPercent", align: "right", render: (value: number | null) => <FoodcostRate value={value} /> },
        ]} />
      <Typography.Text type="secondary" className="text-xs">
        Обидва фудкости розраховані з полів прибутку Poster. Це показники продажів, не собівартість закупівель.
      </Typography.Text>
    </Card>
  </Space>;
}
