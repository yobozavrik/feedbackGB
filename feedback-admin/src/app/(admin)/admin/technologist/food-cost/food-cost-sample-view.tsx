"use client";

import { useMemo, useState } from "react";
import { Alert, Button, Card, Input, Progress, Space, Statistic, Table, Tag, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FoodCostIngredient, FoodCostSample, FoodCostStore } from "@/lib/admin/posterFoodCost";
import { formatProductUnitUk } from "@/lib/productUnits";

const numberFormat = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantityFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 3 });

function money(minor: number | null, currency: string, multiplier = 1): string {
  return minor === null ? "—" : `${numberFormat.format((minor * multiplier) / 100)} ${currency}`;
}

function percent(value: number | null): string {
  return value === null ? "—" : `${numberFormat.format(value)} %`;
}

export function FoodCostSampleView({ data }: { data: FoodCostSample }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const currency = data.currencySymbol || data.currencyCode;
  const visibleStores = useMemo(() => data.stores.filter((store) =>
    store.storeName.toLocaleLowerCase("uk").includes(search.trim().toLocaleLowerCase("uk"))), [data.stores, search]);
  const pricedStores = data.stores.filter((store) => store.visible && store.priceMinor !== null);
  const prices = [...new Set(pricedStores.map((store) => store.priceMinor))];
  const commonPrice = prices.length === 1 ? prices[0] : null;
  const commonFoodCost = pricedStores.length > 0 && pricedStores.every((store) => store.foodCostPercent === pricedStores[0].foodCostPercent)
    ? pricedStores[0].foodCostPercent : null;
  const hasProfitMismatch = data.stores.some((store) => store.priceMatchesCostAndProfit === false);

  return <Space direction="vertical" size="middle" className="w-full">
    <Alert type="info" showIcon message="Пілотний макет на одному продукті" description="Поточний прайс і собівартість — з Poster на момент відкриття. Це не фактична ціна чеків після знижок і не собівартість окремого складу. Для всіх продуктів логіку ще не вмикали." />

    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <Typography.Title level={4} className="!mb-1">{data.productName}</Typography.Title>
        <Space wrap>
          <Tag>ID {data.productId}</Tag>
          <Tag color="blue">Вагова страва · {formatProductUnitUk(data.unit) ?? "—"}</Tag>
          <Tag color="green">Poster live</Tag>
        </Space>
        <Typography.Text type="secondary" className="mt-2 block text-xs">Оновлено {new Date(data.checkedAt).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })} · валюта {data.currencyCode}</Typography.Text>
      </div>
      <Space wrap>
        <Link href={`/admin/technologist/products/item/${data.productId}`}><Button>Картка продукту</Button></Link>
        <Button onClick={() => router.refresh()}>Оновити з Poster</Button>
      </Space>
    </div>

    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card size="small"><Statistic title="Ціна продажу · 100 г" value={commonPrice === null ? prices.length ? "Різна за магазинами" : "Немає ціни" : money(commonPrice, currency)} /></Card>
      <Card size="small"><Statistic title="Собівартість Poster · 100 г" value={money(data.costMinor, currency)} /></Card>
      <Card size="small"><Statistic title="Плановий фудкост · % від ціни" value={percent(commonFoodCost)} /></Card>
      <Card size="small"><Statistic title="Валовий прибуток · 100 г" value={commonPrice === null || data.costMinor === null ? "—" : money(commonPrice - data.costMinor, currency)} /></Card>
    </div>

    <Card size="small" title="Еквівалент на 1 кг">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Statistic title="Ціна реалізації за прайсом" value={commonPrice === null ? "За магазином нижче" : money(commonPrice, currency, 10)} />
        <Statistic title="Собівартість Poster" value={money(data.costMinor, currency, 10)} />
        <Statistic title="Валовий прибуток до інших витрат" value={commonPrice === null || data.costMinor === null ? "—" : money(commonPrice - data.costMinor, currency, 10)} />
      </div>
      {commonFoodCost !== null && <div className="mt-4 max-w-xl"><Typography.Text type="secondary">Частка собівартості у прайсовій ціні</Typography.Text><Progress percent={Number(commonFoodCost.toFixed(1))} status="normal" /></div>}
    </Card>

    {hasProfitMismatch && <Alert type="warning" showIcon message="Розбіжність у даних Poster" description="Для частини магазинів поле profit не дорівнює price − cost. Плановий фудкост розраховано лише з прайсової ціни та собівартості; перевірте налаштування податків та цін." />}
    {data.costMinor === 0 && <Alert type="warning" showIcon message="Нульова собівартість" description="Poster може показувати нуль, якщо немає історії постачань. Плановий фудкост не розраховано як 0 %." />}

    <Card size="small" title="Ціна реалізації за магазинами" extra={<Typography.Text type="secondary">{pricedStores.length} із {data.stores.length} точок з ціною</Typography.Text>}>
      <Input.Search aria-label="Пошук магазину" placeholder="Знайти магазин" allowClear value={search} onChange={(event) => setSearch(event.target.value)} className="mb-3 max-w-sm" />
      <Table<FoodCostStore> rowKey="storeId" size="small" dataSource={visibleStores} pagination={{ pageSize: 10, showSizeChanger: false }} scroll={{ x: 640 }} columns={[
        { title: "Магазин", dataIndex: "storeName", key: "storeName", sorter: (a, b) => a.storeName.localeCompare(b.storeName, "uk") },
        { title: "Статус", key: "visible", render: (_, row) => row.visible ? <Tag color="green">У продажу</Tag> : <Tag>Приховано</Tag> },
        { title: "Ціна / 100 г", key: "price", align: "right", render: (_, row) => money(row.priceMinor, currency) },
        { title: "Ціна / 1 кг", key: "priceKg", align: "right", render: (_, row) => money(row.priceMinor, currency, 10) },
        { title: "Плановий фудкост", key: "foodCost", align: "right", render: (_, row) => percent(row.foodCostPercent) },
      ]} />
      <Typography.Text type="secondary" className="text-xs">Показано поточну прайсову ціну Poster. Продажі, знижки, повернення й ціна фактичних чеків у цей макет не входять.</Typography.Text>
    </Card>

    <Card size="small" title="Склад собівартості за техкартою">
      <Table<FoodCostIngredient> rowKey="key" size="small" pagination={false} scroll={{ x: 600 }} dataSource={data.ingredients} columns={[
        { title: "Компонент", key: "name", render: (_, row) => <Space wrap>{row.name}{row.kind === "prepack" && <Tag color="blue">Напівфабрикат</Tag>}</Space> },
        { title: "Брутто", key: "brutto", align: "right", render: (_, row) => row.brutto === null ? "—" : `${quantityFormat.format(row.brutto)} ${formatProductUnitUk(row.unit) ?? ""}` },
        { title: "Вартість рядка", key: "cost", align: "right", render: (_, row) => money(row.costMinor, currency) },
      ]} />
      <Typography.Text strong>Сума рядків: {money(data.ingredientTotalMinor, currency)}</Typography.Text>
      <Typography.Text type="secondary" className="ml-2">· вихід рецепта {data.recipeOutput === null ? "не вказано" : `${quantityFormat.format(data.recipeOutput)} (одиниця в API не вказана)`}</Typography.Text>
      <Alert className="mt-3" type="info" showIcon message="Рядки техкарти не є основою показника вище" description="Poster повертає окреме поле cost продукту. Суму інгредієнтів показано для контролю рецепта; її не прирівнюємо до собівартості 1 кг без підтвердженої одиниці виходу й правил перерахунку." />
    </Card>
  </Space>;
}
