"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Space, Table, Tag, Typography } from "antd";
import type { ProductStock, StoreStock } from "@/lib/admin/posterStock";

const quantityFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 4 });

export function ProductStockPanel({ productId }: { productId: number }) {
  const [data, setData] = useState<ProductStock | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);

  const refresh = useCallback(() => setReload((current) => current + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    fetch(`/api/admin/technologist/products/${productId}/stock`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("stock_unavailable");
        return response.json() as Promise<ProductStock>;
      })
      .then((result) => setData(result))
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [productId, reload]);

  const hasGaps = data?.stores.some((row) => row.status !== "ok") ?? false;
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
    {error && <Alert type="error" showIcon message="Не вдалося отримати актуальні залишки з Poster" description={data ? "Нижче показано попередній замір. Натисніть «Оновити зараз» для повторної спроби." : undefined} />}
    {hasGaps && <Alert type="warning" showIcon message="Частина магазинів без підтверджених даних" description="Позначка «Немає даних» не означає нульовий залишок." />}
    <Table<StoreStock>
      rowKey="storeId"
      size="small"
      loading={loading && !data}
      dataSource={data?.stores ?? []}
      pagination={{ pageSize: 30, hideOnSinglePage: true }}
      locale={{ emptyText: error ? "Дані недоступні" : "Завантаження…" }}
      columns={[
        { title: "Магазин", dataIndex: "storeName", key: "storeName", sorter: (a, b) => a.storeName.localeCompare(b.storeName, "uk") },
        { title: "Залишок", key: "quantity", align: "right", render: (_, row) => row.status === "ok" && row.quantity !== null
          ? <Typography.Text strong={row.quantity > 0} type={row.quantity < 0 ? "danger" : undefined}>{quantityFormat.format(row.quantity)} {data?.unit ?? ""}</Typography.Text>
          : <Tag color="default">Немає даних</Tag> },
      ]}
    />
    {data && <Typography.Text type="secondary">Підтверджено: {data.stores.filter((row) => row.status === "ok").length} із {data.stores.length} магазинів. Від’ємні залишки показано без корекції.</Typography.Text>}
  </Space>;
}
