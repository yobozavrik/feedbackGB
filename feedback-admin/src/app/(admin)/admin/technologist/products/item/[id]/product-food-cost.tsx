"use client";

import { useEffect, useState } from "react";
import { Alert, Button, Card, Space, Table, Typography } from "antd";
import type { ProductFact } from "@/lib/admin/foodcostProductDetail";
import { foodcostStoreCountLabel } from "@/lib/admin/foodcostLabels";
import { FoodcostRate, FoodcostStatusTag, formatFoodcostPercent } from "@/components/admin/foodcost/FoodcostStatus";

type Response = {
  status: "complete" | "incomplete";
  dateFrom: string;
  dateTo: string;
  spotCount: number;
  expectedCells: number;
  completedCells: number;
  sourceFetchedAt: string | null;
  product: { productName: string; productNameConflict: boolean; fact: ProductFact | null } | null;
  stores: { spotId: number; storeName: string; fact: ProductFact | null }[] | null;
  days: { businessDate: string; fact: ProductFact | null }[] | null;
};

const amount = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function money(minor: number | null): string { return minor === null ? "Н/Д" : `${amount.format(minor / 100)} ₴`; }
function paid(value: ProductFact | null): string { return value ? money(value.payedSumMinor) : "Не продавався"; }

export function ProductFoodCostPanel({ productId, spotId, onOpenTech }: {
  productId: number; spotId?: number; onOpenTech: () => void;
}) {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const scope = spotId === undefined ? "" : `?spot_id=${spotId}`;
    fetch(`/api/admin/technologist/products/${productId}/food-cost${scope}`, {
      cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("foodcost_product_unavailable");
      const body = await response.json() as Response;
      if (!["complete", "incomplete"].includes(body.status) ||
        !Number.isSafeInteger(body.expectedCells) || !Number.isSafeInteger(body.completedCells) ||
        (body.status === "complete" && (!Array.isArray(body.stores) || !Array.isArray(body.days)))) {
        throw new Error("foodcost_product_invalid_response");
      }
      setData(body);
    }).catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [productId, spotId, revision]);

  if (error) return <Alert type="error" showIcon message="Фудкост продукту тимчасово недоступний"
    action={<Button size="small" onClick={() => setRevision((value) => value + 1)}>Повторити</Button>} />;
  if (loading && !data) return <Card loading className="min-h-48" />;
  if (!data) return null;
  if (data.status !== "complete" || !data.stores || !data.days) return <Alert type="warning" showIcon
    message="Знімок продажів неповний"
    description={`${data.completedCells}/${data.expectedCells} пар дата × магазин. Частковий фудкост продукту не показуємо.`} />;

  const fact = data.product?.fact ?? null;
  return <Space direction="vertical" size="middle" className="w-full">
    <Alert type="info" showIcon message={`Фактичні продажі Poster · ${spotId === undefined ? "поточна мережа" : data.stores[0]?.storeName ?? `магазин #${spotId}`}, 3 завершені дні`}
      description={`${data.dateFrom} — ${data.dateTo} · ${foodcostStoreCountLabel(data.spotCount)} · ${data.completedCells}/${data.expectedCells} знімків. Історичний склад мережі не підтверджено.`} />
    {data.product?.productNameConflict && <Alert type="warning" showIcon
      message="Назва продукту змінювалась у знімках продажів" description="Показано одну історичну назву; суми об’єднано за ID продукту." />}
    {fact ? <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card size="small"><Typography.Text type="secondary">Оплачено після знижок</Typography.Text>
        <Typography.Title level={4} className="!mb-0">{money(fact.payedSumMinor)}</Typography.Title></Card>
      <Card size="small"><Typography.Text type="secondary">За прибутком товарів</Typography.Text>
        <Typography.Title level={4} className="!mb-1">{formatFoodcostPercent(fact.foodCostPercent)}</Typography.Title>
        <FoodcostStatusTag value={fact.foodCostPercent} /></Card>
      <Card size="small"><Typography.Text type="secondary">Без ПДВ Poster</Typography.Text>
        <Typography.Title level={4} className="!mb-1">{formatFoodcostPercent(fact.nettoFoodCostPercent)}</Typography.Title>
        <FoodcostStatusTag value={fact.nettoFoodCostPercent} /></Card>
    </div> : <Alert type="info" showIcon message="Продукт не продавався у вибраному вікні"
      description="Фудкост не дорівнює 0 %: для нього немає знаменника — оплаченої суми." />}
    <Typography.Text type="secondary" className="text-xs">
      Межі для кожної методики окремо: менше 35 % — норма; 35–45 % включно — увага; понад 45 % — високий фудкост.
    </Typography.Text>
    <Card size="small" title="За днями">
      <Table rowKey="businessDate" size="small" pagination={false} scroll={{ x: 560 }}
        dataSource={data.days} columns={[
          { title: "Дата", dataIndex: "businessDate" },
          { title: "Оплачено", align: "right", render: (_value, row) => paid(row.fact) },
          { title: "За прибутком товарів", align: "right", render: (_value, row) => <FoodcostRate value={row.fact?.foodCostPercent ?? null} /> },
          { title: "Без ПДВ Poster", align: "right", render: (_value, row) => <FoodcostRate value={row.fact?.nettoFoodCostPercent ?? null} /> },
        ]} />
    </Card>
    <Card size="small" title="За магазинами">
      <Table rowKey="spotId" size="small" scroll={{ x: 600 }}
        dataSource={data.stores} pagination={{ pageSize: 13, showSizeChanger: false }} columns={[
          { title: "Магазин", dataIndex: "storeName" },
          { title: "Оплачено", align: "right", render: (_value, row) => paid(row.fact) },
          { title: "За прибутком товарів", align: "right", render: (_value, row) => <FoodcostRate value={row.fact?.foodCostPercent ?? null} /> },
          { title: "Без ПДВ Poster", align: "right", render: (_value, row) => <FoodcostRate value={row.fact?.nettoFoodCostPercent ?? null} /> },
        ]} />
    </Card>
    <Alert type="info" showIcon message="Чому два різні відсотки?"
      description="Оплачена сума й період однакові. Перший показник віднімає product_profit, другий — product_profit_netto (Poster описує його як прибуток без ПДВ). Різниця не є окремим обсягом продажів або підтвердженою бухгалтерською собівартістю." />
    <Card size="small" title="Поточні дані — окремо від факту продажів">
      <Space direction="vertical">
        <Typography.Text type="secondary">Поточна собівартість із каталогу POS показана в боковій картці. Її не змішуємо з історичним фудкостом чеків.</Typography.Text>
        <Typography.Text type="secondary">Технологічна карта доступна в сусідній вкладці. Прайс за магазинами й порівняння з 30-денними накладними для всіх продуктів ще не підключені.</Typography.Text>
        <Button onClick={onOpenTech}>Відкрити технологічну карту</Button>
      </Space>
    </Card>
    <Typography.Text type="secondary" className="text-xs">Джерело: завершені знімки продажів Poster. Найстаріше отримання: {data.sourceFetchedAt ?? "Н/Д"}. Продукт, день або магазин без продажів позначено «Не продавався», не 0 %.</Typography.Text>
  </Space>;
}
