"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Descriptions, Empty, Space, Table, Tag, Typography } from "antd";
import type { ProductTechCard, TechIngredient, TechRecipe } from "@/lib/admin/posterTechCard";
import { formatProductUnitUk } from "@/lib/productUnits";

const quantityFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 4 });

function quantity(value: number | null, unit?: string | null) {
  return value === null ? "—" : `${quantityFormat.format(value)}${unit ? ` ${formatProductUnitUk(unit)}` : ""}`;
}

function hasUnavailablePrepack(recipe: TechRecipe): boolean {
  return recipe.ingredients.some((row) => row.kind === "prepack" &&
    (row.prepackStatus !== "ok" || (row.prepack !== null && hasUnavailablePrepack(row.prepack))));
}

function Recipe({ recipe, nested = false }: { recipe: TechRecipe; nested?: boolean }) {
  return <Space direction="vertical" size="small" className="w-full">
    {nested && <Typography.Text strong>{recipe.name}</Typography.Text>}
    <Descriptions size="small" column={1} items={[
      { key: "output", label: "Вихід за даними Poster", children: <>{quantity(recipe.output)} <Typography.Text type="secondary">(одиниця не вказана в API)</Typography.Text></> },
      ...(recipe.productionDescription ? [{ key: "process", label: "Технологія приготування", children: <span className="whitespace-pre-wrap">{recipe.productionDescription}</span> }] : []),
    ]} />
    {recipe.ingredients.length === 0 ? <Empty description="Техкарту не задано в Poster" /> :
      <Table<TechIngredient>
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={recipe.ingredients}
        scroll={{ x: 480 }}
        columns={[
          { title: "Інгредієнт / напівфабрикат", key: "name", render: (_, row) => <Space wrap><span>{row.name}</span>{row.kind === "prepack" && <Tag color="blue">Напівфабрикат</Tag>}</Space> },
          { title: "Брутто", key: "brutto", align: "right", render: (_, row) => quantity(row.brutto, row.unit) },
          { title: "Нетто", key: "netto", align: "right", render: (_, row) => quantity(row.netto, row.unit) },
        ]}
        expandable={{
          rowExpandable: (row) => row.kind === "prepack",
          expandedRowRender: (row) => row.prepack
            ? <Recipe recipe={row.prepack} nested />
            : <Alert type="warning" showIcon message={row.prepackStatus === "cycle" ? "Циклічне посилання на напівфабрикат" : row.prepackStatus === "depth_limit" ? "Вкладений склад перевищує межу завантаження" : "Не вдалося завантажити склад напівфабрикату з Poster"} />,
        }}
      />}
  </Space>;
}

export function ProductTechCardPanel({ productId }: { productId: number }) {
  const [data, setData] = useState<ProductTechCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((current) => current + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setErrorCode(null);
    fetch(`/api/admin/technologist/products/${productId}/tech-card`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(typeof body?.error === "string" ? body.error : "tech_card_unavailable");
        }
        return response.json() as Promise<ProductTechCard>;
      })
      .then(setData)
      .catch((error) => { if (!controller.signal.aborted) setErrorCode(error instanceof Error ? error.message : "tech_card_unavailable"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [productId, reload]);

  return <Space direction="vertical" size="middle" className="w-full">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <Typography.Title level={5} className="!mb-0">Технологічна карта</Typography.Title>
        <Typography.Text type="secondary">Напряму з Poster · {data ? `оновлено ${new Date(data.checkedAt).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}` : "очікування даних"}</Typography.Text>
      </div>
      <Button onClick={refresh} loading={loading}>Оновити зараз</Button>
    </div>
    {errorCode && <Alert type={errorCode === "product_missing_in_poster" ? "warning" : "error"} showIcon message={errorCode === "product_missing_in_poster" ? "Продукт відсутній у поточному Poster" : "Не вдалося отримати технологічну карту з Poster"} description={data ? "Нижче показано попередній замір." : undefined} />}
    {data && hasUnavailablePrepack(data.recipe) && <Alert type="warning" showIcon message="Частина вкладених карт недоступна" description="Склад напівфабрикатів, який не вдалося завантажити, не домислюється." />}
    {data ? <Recipe recipe={data.recipe} /> : loading ? <div className="py-10 text-center"><Typography.Text type="secondary">Завантаження технологічної карти…</Typography.Text></div> : !errorCode ? null : <Empty description="Дані недоступні" />}
  </Space>;
}
