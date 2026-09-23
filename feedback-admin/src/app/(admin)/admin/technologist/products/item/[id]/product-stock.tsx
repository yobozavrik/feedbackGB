"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Space, Table, Tag, Typography } from "antd";
import type { ProductStock, StoreStock } from "@/lib/admin/posterStock";

const quantityFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 4 });

export function ProductStockPanel({ productId }: { productId: number }) {
  const [data, setData] = useState<ProductStock | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const refresh = useCallback(() => setReload((current) => current + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setErrorCode(null);
    fetch(`/api/admin/technologist/products/${productId}/stock`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(typeof body?.error === "string" ? body.error : "stock_unavailable");
        }
        return response.json() as Promise<ProductStock>;
      })
      .then((result) => setData(result))
      .catch((error) => { if (!controller.signal.aborted) setErrorCode(error instanceof Error ? error.message : "stock_unavailable"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [productId, reload]);

  const hasGaps = data?.stores.some((row) => row.status !== "available") ?? false;
  const missingInPoster = errorCode === "product_missing_in_poster";
  return <Space direction="vertical" size="middle" className="w-full">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <Typography.Title level={5} className="!mb-0">Залишки по магазинах</Typography.Title>
        <Typography.Text type="secondary">
          Напряму з Poster · {data ? `оновлено ${new Date(data.checkedAt).toLocaleString("uk-UA", { timeZone: "Europe/Kyiv" })}` : "очікування даних"}
        </Typography.Text>
      </div>
      <Button onClick={refresh} loading={loading}>Оновити зараз</Button>
    </div>
    {errorCode && <Alert type={missingInPoster ? "warning" : "error"} showIcon message={missingInPoster ? "Продукт відсутній у поточному Poster" : "Не вдалося отримати актуальні залишки з Poster"} description={data ? "Нижче показано попередній замір. Натисніть «Оновити зараз» для повторної спроби." : undefined} />}
    {data?.status === "product_without_stock_id" && <Alert type="info" showIcon message="У Poster немає складського ID цього продукту" description="Технологічна карта може існувати, але залишок готового продукту за магазинами отримати неможливо." />}
    {hasGaps && <Alert type="warning" showIcon message="Частина магазинів без підтверджених даних" description="Позначка «Немає даних» не означає нульовий залишок." />}
    {data?.status !== "product_without_stock_id" && <Table<StoreStock>
      rowKey="storeId"
      size="small"
      loading={loading && !data}
      dataSource={data?.stores ?? []}
      pagination={{ pageSize: 30, hideOnSinglePage: true }}
      locale={{ emptyText: errorCode ? "Дані недоступні" : "Завантаження…" }}
      columns={[
        { title: "Магазин", dataIndex: "storeName", key: "storeName", sorter: (a, b) => a.storeName.localeCompare(b.storeName, "uk") },
        { title: "Залишок", key: "quantity", align: "right", render: (_, row) => row.status === "available" && row.quantity !== null
          ? <Typography.Text strong={row.quantity > 0} type={row.quantity < 0 ? "danger" : undefined}>{quantityFormat.format(row.quantity)} {data?.unit ?? ""}</Typography.Text>
          : <Tag color="default">{row.status === "storage_mapping_missing_or_ambiguous" ? "Склад не визначено" : row.status === "poster_unavailable" ? "Poster недоступний" : "Немає складського запису"}</Tag> },
      ]}
    />}
    {data?.status === "available" && <Typography.Text type="secondary">Підтверджено: {data.stores.filter((row) => row.status === "available").length} із {data.stores.length} магазинів. Від’ємні залишки показано без корекції.</Typography.Text>}
  </Space>;
}
