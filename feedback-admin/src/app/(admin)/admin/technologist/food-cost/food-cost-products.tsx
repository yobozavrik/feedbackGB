"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Input, Select, Space, Table, Tag, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { productHref } from "@/lib/admin/productCatalog";
import type { ProductSales, SalesMetrics } from "@/lib/admin/posterSalesMath";
import { foodcostStoreCountLabel } from "@/lib/admin/foodcostLabels";
import { FoodcostRate } from "@/components/admin/foodcost/FoodcostStatus";
import type { FoodcostPeriodDays } from "@/lib/admin/foodcostPeriod";

type ProductRow = ProductSales & { currentCatalogPresent: boolean };
type ProductResponse = {
  status: "complete" | "incomplete";
  dateFrom: string;
  dateTo: string;
  spotCount: number;
  expectedCells: number;
  completedCells: number;
  sourceFetchedAt: string | null;
  historicalRosterVerified: false;
  totalProducts: number | null;
  filteredMetrics: SalesMetrics | null;
  products: ProductRow[] | null;
  categories: { categoryId: number | null; displayName: string | null; nameSource: string | null }[] | null;
};

const amount = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function money(minor: number): string { return `${amount.format(minor / 100)} ₴`; }

export function FoodCostProducts({ spotId, initialCategoryId, days }: {
  spotId?: number; initialCategoryId?: string; days: FoodcostPeriodDays;
}) {
  const [data, setData] = useState<ProductResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [searchDraft, setSearchDraft] = useState("");
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? "all");
  const [sort, setSort] = useState("paid_desc");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), pageSize: "25", sort, categoryId,
      days: String(days) });
    if (spotId !== undefined) params.set("spot_id", String(spotId));
    if (query) params.set("q", query);
    setLoading(true);
    setError(false);
    fetch(`/api/admin/technologist/food-cost/products/recent-network?${params}`, {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("foodcost_products_unavailable");
      const body = await response.json() as ProductResponse;
      if (!["complete", "incomplete"].includes(body.status) ||
        !Number.isSafeInteger(body.expectedCells) || !Number.isSafeInteger(body.completedCells) ||
        (body.status === "complete" && (!Array.isArray(body.products) ||
          !Array.isArray(body.categories) || !Number.isSafeInteger(body.totalProducts)))) {
        throw new Error("foodcost_products_invalid_response");
      }
      setData(body);
    }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, page, sort, categoryId, query, spotId, days]);

  if (error) return <Alert type="error" showIcon message="Позиції тимчасово недоступні"
    action={<Button size="small" onClick={() => setRevision((value) => value + 1)}>Повторити</Button>} />;
  if (loading) return <Card loading className="min-h-48" />;
  if (!data) return null;
  if (data.status !== "complete" || !data.products || !data.categories) return <Alert type="warning" showIcon
    message="Знімок продажів неповний"
    description={`${data.dateFrom} — ${data.dateTo}: ${data.completedCells}/${data.expectedCells} пар дата × магазин. Часткові підсумки продуктів не показуємо. Для довшого періоду потрібна дозагрузка історії Poster.`} />;

  const categoryOptions = [
    { value: "all", label: "Усі категорії" },
    ...data.categories.map((row) => ({ value: row.categoryId === null ? "__unknown" : String(row.categoryId),
      label: row.categoryId === null ? "Без категорії" : row.displayName ?? `Категорія #${row.categoryId}` })),
    { value: "__conflict", label: "Змінювалась категорія" },
  ];

  return <Space direction="vertical" size="middle" className="w-full">
    <Alert type="info" showIcon message={`Позиції · поточна мережа, ${days} завершених днів`}
      description={`${data.dateFrom} — ${data.dateTo} · ${foodcostStoreCountLabel(data.spotCount)} · ${data.completedCells}/${data.expectedCells} знімків. Продажі та назви позицій — зі знімків Poster. Історичний склад мережі не підтверджено.`} />
    <Card size="small" title="Фудкост за продуктами" extra={<Button icon={<ReloadOutlined />}
      onClick={() => setRevision((value) => value + 1)}>Оновити</Button>}>
      <Space wrap className="mb-4">
        <Input.Search aria-label="Пошук продукту" placeholder="Назва або ID продукту"
          value={searchDraft} maxLength={80} allowClear className="w-64"
          onChange={(event) => setSearchDraft(event.target.value)}
          onSearch={(value) => { setQuery(value.trim()); setPage(1); }} />
        <Select aria-label="Категорія" value={categoryId} options={categoryOptions}
          showSearch optionFilterProp="label" className="min-w-56" onChange={(value) => {
            setCategoryId(value); setPage(1);
          }} />
        <Select aria-label="Сортування" value={sort} className="min-w-52" onChange={(value) => {
          setSort(value); setPage(1);
        }} options={[
          { value: "paid_desc", label: "За оплатою" },
          { value: "foodcost_desc", label: "За фудкостом" },
          { value: "name_asc", label: "За назвою" },
        ]} />
      </Space>
      <Typography.Paragraph type="secondary" className="mb-3 text-xs">
        Знайдено позицій: {data.totalProducts ?? 0} · Оплачено за фільтром: {data.filteredMetrics ? money(data.filteredMetrics.payedSumMinor) : "—"}
        {data.filteredMetrics && <> · За прибутком товарів: <FoodcostRate value={data.filteredMetrics.foodCostPercent} /> · Без ПДВ Poster: <FoodcostRate value={data.filteredMetrics.nettoFoodCostPercent} /></>}
      </Typography.Paragraph>
      <Table<ProductRow> rowKey="productId" size="small" loading={loading} scroll={{ x: 850 }}
        dataSource={data.products} locale={{ emptyText: "За цим фільтром продажів немає" }}
        pagination={{ current: page, pageSize: 25, total: data.totalProducts ?? 0,
          showSizeChanger: false, onChange: (value) => setPage(value) }} columns={[
          { title: "Продукт", dataIndex: "productName", render: (_value, row) => <>
            {row.currentCatalogPresent ? <Link href={`${productHref(row.productId)}?tab=foodcost&spot_id=${spotId ?? "all"}&days=${days}`}>{row.productName}</Link>
              : <Typography.Text>{row.productName}</Typography.Text>}
            <Typography.Text type="secondary" className="ml-2 text-xs">#{row.productId}</Typography.Text>
            {row.productNameConflict && <Tag color="gold" className="ml-2">Назва змінювалась</Tag>}
            {!row.currentCatalogPresent && <Tag className="ml-2">Немає в поточному каталозі</Tag>}
            {row.categoryConflict && <Tag color="gold" className="ml-2">Категорія змінювалась</Tag>}
          </> },
          { title: "Оплачено", dataIndex: "payedSumMinor", align: "right", render: (value: number) => money(value) },
          { title: "За прибутком товарів", dataIndex: "foodCostPercent", align: "right", render: (value: number | null) => <FoodcostRate value={value} /> },
          { title: "Без ПДВ Poster", dataIndex: "nettoFoodCostPercent", align: "right", render: (value: number | null) => <FoodcostRate value={value} /> },
        ]} />
      <Typography.Text type="secondary" className="text-xs">
        Виторг і період для обох методик однакові. Перший показник віднімає product_profit,
        другий — product_profit_netto, який Poster описує як прибуток без ПДВ. Тому відсотки можуть різнитися;
        це не два різні обсяги продажів і не бухгалтерськи підтверджена собівартість.
        Оплачена сума — після знижок, джерело собівартості тут не накладні постачання.
        Ставки за фільтром перераховані з грошових сум, а не усереднені з рядків. Кількість і ціна за одиницю тут не показані,
        доки їхні одиниці виміру та методика не звірені. Найстаріше отримання джерела: {data.sourceFetchedAt ?? "Н/Д"}.
      </Typography.Text>
    </Card>
  </Space>;
}
