"use client";

import { Line } from "@ant-design/plots";
import { ArrowRightOutlined } from "@ant-design/icons";
import { Alert, Card, Empty, Select, Space, Statistic, Table, Tag, Typography, theme as antdTheme } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { productHref } from "@/lib/admin/productCatalog";
import { useAdminChartTheme } from "@/lib/admin/useAdminChartTheme";
import type { CommandCenterView } from "@/lib/admin/foodcostCommandCenter";
import { foodcostStoreCountLabel } from "@/lib/admin/foodcostLabels";
import { FoodcostRate, FoodcostStatusTag, formatFoodcostPercent } from "@/components/admin/foodcost/FoodcostStatus";

type Category = NonNullable<CommandCenterView["categories"]>[number];
type Product = NonNullable<CommandCenterView["products"]>[number];

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

function categoryHref(spotId: number | null, categoryId?: number | null): string {
  const base = `/admin/technologist/food-cost?tab=categories&spot_id=${spotId ?? "all"}`;
  return categoryId === undefined ? base : `${base}&category_id=${categoryId ?? "__unknown"}`;
}

function productFoodCostHref(productId: number, spotId: number | null): string {
  return `${productHref(productId)}?tab=foodcost&spot_id=${spotId ?? "all"}`;
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

export function FoodCostCommandCenter({ data }: { data: CommandCenterView }) {
  const router = useRouter();
  const { token } = antdTheme.useToken();
  const chartTheme = useAdminChartTheme();

  if (data.status !== "complete") {
    return <Alert type="warning" showIcon message="Знімок продажів неповний"
      description={`${integerFormat.format(data.completedCells)} із ${integerFormat.format(data.expectedCells)} пар дата × магазин. Часткові KPI, графіки та рейтинги не показуємо.`} />;
  }

  if (!data.metrics || !data.days || !data.categories || !data.products) {
    return <Alert type="warning" showIcon message="Огляд фудкосту поки недоступний"
      description="Для повного знімка бракує одного або кількох узгоджених блоків даних. Часткові підсумки не показуємо." />;
  }

  const metrics = data.metrics;
  const delta = difference(metrics);
  const categories = [...data.categories].sort(comparePaid);
  const products = [...data.products].sort(comparePaid);
  const selectedStoreName = data.selectedSpotId === null ? null
    : data.stores.find((store) => store.id === data.selectedSpotId)?.name ?? null;
  const topCategories = categories.slice(0, 3);
  const topProducts = products.slice(0, 3);
  const maxCategoryPaid = Math.max(1, ...topCategories.map((row) => row.payedSumMinor));
  const maxProductPaid = Math.max(1, ...topProducts.map((row) => row.payedSumMinor));
  const currentSpotParam = data.selectedSpotId === null ? "all" : String(data.selectedSpotId);
  const chartRows = data.days.flatMap((day) => {
    const dayMetrics = day.metrics;
    const date = periodLabel(day.businessDate);
    return [
      { date, businessDate: day.businessDate, method: "За прибутком товарів", value: dayMetrics.foodCostPercent, payedSumMinor: dayMetrics.payedSumMinor },
      { date, businessDate: day.businessDate, method: "Без ПДВ Poster", value: dayMetrics.nettoFoodCostPercent, payedSumMinor: dayMetrics.payedSumMinor },
    ].filter((row): row is typeof row & { value: number } => row.value !== null && Number.isFinite(row.value));
  });
  const hasStoreFilter = data.stores.length > 0;
  const changeStore = (value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("spot_id", value);
    router.push(`${url.pathname}?${url.searchParams.toString()}`);
  };

  return <Space direction="vertical" size="middle" className="w-full">
    <Alert type="info" showIcon message={`${selectedStoreName ? `Магазин · ${selectedStoreName}` : "Поточна мережа"} · ${data.dateFrom} — ${data.dateTo}`}
      description={`${foodcostStoreCountLabel(data.spotCount)} · ${integerFormat.format(data.completedCells)}/${integerFormat.format(data.expectedCells)} пар дата × магазин · джерела від ${timeLabel(data.sourceFetchedAt)} до ${timeLabel(data.newestSourceFetchedAt)}. Історичний склад мережі не підтверджено.`} />

    {hasStoreFilter && <div className="flex flex-wrap items-center justify-between gap-3">
      <Typography.Text type="secondary">Магазин</Typography.Text>
      <Select aria-label="Фільтр за магазином" className="min-w-56"
        value={data.selectedSpotId === null ? "all" : String(data.selectedSpotId)}
        onChange={changeStore}
        options={[{ value: "all", label: "Уся мережа" }, ...data.stores.map((store) => ({ value: String(store.id), label: store.name }))]} />
    </div>}

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card size="small"><Statistic title="Оплачено" value={money(metrics.payedSumMinor)} /></Card>
      <Card size="small"><Statistic title="Фудкост · за прибутком товарів" value={formatFoodcostPercent(metrics.foodCostPercent)} />
        <FoodcostStatusTag value={metrics.foodCostPercent} /></Card>
      <Card size="small"><Statistic title="Фудкост · без ПДВ Poster" value={formatFoodcostPercent(metrics.nettoFoodCostPercent)} />
        <FoodcostStatusTag value={metrics.nettoFoodCostPercent} /></Card>
      <Card size="small"><Statistic title="Різниця методик" value={delta === null ? "Н/Д" : `${numberFormat.format(delta)} в. п.`} /></Card>
    </div>

    <Typography.Text type="secondary" className="text-xs">
      Межі для кожної методики окремо: менше 35 % — норма; 35–45 % включно — увага; понад 45 % — високий фудкост. Н/Д не має кольорового статусу.
    </Typography.Text>

    <div className="grid grid-cols-1 gap-3 xl:grid-cols-5">
      <Card size="small" className="xl:col-span-3" title="Фудкост за днями">
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

      <Card size="small" className="xl:col-span-2" title="Найбільший оборот для перевірки">
        {topCategories.length || topProducts.length ? <Space direction="vertical" size="middle" className="w-full">
          <div>
            <Typography.Text strong className="mb-2 block">Категорії</Typography.Text>
            <Space direction="vertical" size="small" className="w-full">
              {topCategories.map((row) => <div key={`category:${row.categoryId ?? "none"}`}>
                <div className="mb-1 flex items-start justify-between gap-3">
                  <Link href={categoryHref(data.selectedSpotId, row.categoryId)}>{categoryLabel(row)}<ArrowRightOutlined className="ml-1" /></Link>
                  <Typography.Text strong className="whitespace-nowrap">{money(row.payedSumMinor)}</Typography.Text>
                </div>
                <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full" style={{ background: token.colorFillSecondary }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(3, row.payedSumMinor / maxCategoryPaid * 100)}%`, background: token.colorPrimary }} />
                </div>
              </div>)}
              {!topCategories.length && <Typography.Text type="secondary">Немає категорій з продажами</Typography.Text>}
            </Space>
          </div>
          <div>
            <Typography.Text strong className="mb-2 block">Позиції</Typography.Text>
            <Space direction="vertical" size="small" className="w-full">
              {topProducts.map((row) => <div key={`product:${row.productId}`}>
                <div className="mb-1 flex items-start justify-between gap-3">
                  {row.currentCatalogPresent
                    ? <Link href={productFoodCostHref(row.productId, data.selectedSpotId)}>{row.productName}<ArrowRightOutlined className="ml-1" /></Link>
                    : <Typography.Text>{row.productName}<Tag className="ml-2">Немає в поточному каталозі</Tag></Typography.Text>}
                  <Typography.Text strong className="whitespace-nowrap">{money(row.payedSumMinor)}</Typography.Text>
                </div>
                <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full" style={{ background: token.colorFillSecondary }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(3, row.payedSumMinor / maxProductPaid * 100)}%`, background: token.colorTextSecondary }} />
                </div>
              </div>)}
              {!topProducts.length && <Typography.Text type="secondary">Немає позицій з продажами</Typography.Text>}
            </Space>
          </div>
        </Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Продажів у вибраному періоді немає" />}
        <Typography.Paragraph type="secondary" className="mb-0 mt-3 text-xs">
          Категорії та товари показано окремо, без сумування між рівнями. Порядок визначає оплачена сума, а не кольоровий статус.
        </Typography.Paragraph>
      </Card>
    </div>

    <Card size="small" title="Категорії за сумою продажів" extra={<Link href={categoryHref(data.selectedSpotId)}>Усі категорії <ArrowRightOutlined /></Link>}>
      <Table<Category> rowKey={(row) => String(row.categoryId ?? "uncategorized")} size="small" scroll={{ x: 760 }}
        pagination={{ pageSize: 8, showSizeChanger: false }} dataSource={categories} columns={[
          { title: "Категорія", dataIndex: "displayName", render: (_value, row) => <Link href={categoryHref(data.selectedSpotId, row.categoryId)}>{categoryLabel(row)}</Link> },
          { title: "Оплачено", dataIndex: "payedSumMinor", align: "right", sorter: (a, b) => a.payedSumMinor - b.payedSumMinor, defaultSortOrder: "descend", render: money },
          { title: "За прибутком товарів", dataIndex: "foodCostPercent", align: "right", render: (value: number | null) => <FoodcostRate value={value} /> },
          { title: "Без ПДВ Poster", dataIndex: "nettoFoodCostPercent", align: "right", render: (value: number | null) => <FoodcostRate value={value} /> },
        ]} />
    </Card>

    <Card size="small" title="12 позицій з найбільшим оборотом" extra={<Link href={`/admin/technologist/food-cost?tab=products&spot_id=${currentSpotParam}`}>Усі позиції <ArrowRightOutlined /></Link>}>
      <Table<Product> rowKey="productId" size="small" scroll={{ x: 800 }}
        pagination={{ pageSize: 10, showSizeChanger: false }} dataSource={products} columns={[
          { title: "Позиція", dataIndex: "productName", render: (_value, row) => <Space wrap>
            {row.currentCatalogPresent ? <Link href={productFoodCostHref(row.productId, data.selectedSpotId)}>{row.productName}</Link>
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
