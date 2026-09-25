"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Alert, Button, Card, Space, Table, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import { UNCATEGORIZED_ID } from "@/lib/admin/productCatalog";
import type { loadFoodcostRecentBreakdown } from "@/lib/admin/foodcostRecentNetwork";
import { foodcostStoreCountLabel } from "@/lib/admin/foodcostLabels";
import { FoodcostRate } from "@/components/admin/foodcost/FoodcostStatus";

type Breakdown = Awaited<ReturnType<typeof loadFoodcostRecentBreakdown>>;
type Category = NonNullable<Breakdown["categories"]>[number];
type Response = Omit<Breakdown, "products">;
const amount = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function money(minor: number): string { return `${amount.format(minor / 100)} ₴`; }

export function FoodCostCategories({ spotId, focusedCategoryId }: {
  spotId?: number; focusedCategoryId?: string;
}) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const params = spotId === undefined ? "" : `?spot_id=${spotId}`;
    fetch(`/api/admin/technologist/food-cost/categories/recent-network${params}`, {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("foodcost_categories_unavailable");
      const body = await response.json() as Response;
      if (!["complete", "incomplete"].includes(body.status) ||
        !Number.isSafeInteger(body.expectedCells) || !Number.isSafeInteger(body.completedCells)) {
        throw new Error("foodcost_categories_invalid_response");
      }
      setData(body);
    }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision, spotId]);

  if (error) return <Alert type="error" showIcon message="Категорії тимчасово недоступні"
    action={<Button size="small" onClick={() => setRevision((value) => value + 1)}>Повторити</Button>} />;
  if (loading) return <Card loading className="min-h-48" />;
  if (!data) return null;
  if (data.status !== "complete" || !data.categories) return <Alert type="warning" showIcon
    message="Знімок продажів неповний"
    description={`${data.completedCells}/${data.expectedCells} пар дата × магазин. Часткові підсумки категорій не показуємо.`} />;

  const rows = [...data.categories]
    .filter((row) => focusedCategoryId === undefined ||
      String(row.categoryId ?? UNCATEGORIZED_ID) === focusedCategoryId)
    .sort((a, b) => b.payedSumMinor - a.payedSumMinor);
  const allHref = `/admin/technologist/food-cost?tab=categories&spot_id=${spotId ?? "all"}`;
  return <Space direction="vertical" size="middle" className="w-full">
    <Alert type="info" showIcon message="Категорії · поточна мережа, 3 завершені дні"
      description={`${data.dateFrom} — ${data.dateTo} · ${foodcostStoreCountLabel(data.spotCount)} · ${data.completedCells}/${data.expectedCells} знімків. Суми — з історичних продажів, а назви без історичного знімка — з поточного каталогу Poster. Історичний склад мережі не підтверджено.`} />
    {!data.currentCategoryNamesAvailable && <Alert type="warning" showIcon
      message="Поточні назви категорій Poster недоступні" description="Числові ID залишено без вигаданих назв." />}
    {data.currentCategoryNamesAvailable && data.categoriesWithoutDisplayName > 0 && <Alert type="warning" showIcon
      message={`${data.categoriesWithoutDisplayName} категорій без підтвердженої назви`}
      description="Їхні суми враховано, але замість назви показано числовий ID." />}
    {focusedCategoryId !== undefined && <Typography.Text>
      {rows[0]?.displayName ?? (focusedCategoryId === UNCATEGORIZED_ID ? "Без категорії" : `Категорія #${focusedCategoryId}`)} · <Link href={allHref}>Показати всі категорії</Link>
    </Typography.Text>}
    <Card size="small" title="Фудкост за категоріями" extra={<Button icon={<ReloadOutlined />}
      onClick={() => setRevision((value) => value + 1)}>Оновити</Button>}>
      <Table<Category> rowKey={(row) => String(row.categoryId ?? UNCATEGORIZED_ID)}
        size="small" scroll={{ x: 760 }} dataSource={rows} pagination={{ pageSize: 15, showSizeChanger: false }}
        columns={[
          { title: "Категорія", dataIndex: "categoryName", render: (_value, row) => <>
            <Link href={`/admin/technologist/food-cost?tab=products&spot_id=${spotId ?? "all"}&category_id=${row.categoryId ?? UNCATEGORIZED_ID}`}>
              {row.categoryId === null ? "Без категорії" : row.displayName ?? `Категорія #${row.categoryId}`}
            </Link>
            {row.categoryNameConflict && <Typography.Text type="warning" className="ml-2 text-xs">Назви відрізнялись</Typography.Text>}
          </> },
          { title: "Продуктів", dataIndex: "distinctProducts", align: "right" },
          { title: "Оплачено", dataIndex: "payedSumMinor", align: "right", render: (value: number) => money(value) },
          { title: "За прибутком товарів", dataIndex: "foodCostPercent", align: "right", render: (value: number | null) => <FoodcostRate value={value} /> },
          { title: "Без ПДВ Poster", dataIndex: "nettoFoodCostPercent", align: "right", render: (value: number | null) => <FoodcostRate value={value} /> },
        ]} />
      <Typography.Text type="secondary" className="text-xs">
        Ставки перераховано з сум категорії, а не усереднено між магазинами. Оплачена сума — після знижок;
        обидва показники виведені з полів прибутку Poster, не з накладних постачання.
        Джерело: знімки Poster; найстаріше отримання {data.sourceFetchedAt ?? "Н/Д"}.
      </Typography.Text>
    </Card>
  </Space>;
}
