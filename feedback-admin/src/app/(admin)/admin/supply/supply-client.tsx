"use client";

import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Alert, Card, Tabs, Tag, Typography } from "antd";
import { useMemo } from "react";

const { Text } = Typography;

export interface SupplyOrderItem {
  name: string;
  quantity: number;
  unit: string;
}

export interface SupplyOrderRow {
  id: string;
  status: string;
  comment: string | null;
  createdAt: string;
  workshopName: string;
  employeeName: string;
  items: SupplyOrderItem[];
}

const UNIT_LABEL: Record<string, string> = { kg: "кг", liter: "л", piece: "шт" };

const STATUS_META: Record<string, { label: string; color: string }> = {
  new: { label: "Нова", color: "blue" },
  accepted: { label: "Прийнята", color: "cyan" },
  in_progress: { label: "В роботі", color: "gold" },
  completed: { label: "Виконана", color: "green" },
  rejected: { label: "Відхилена", color: "red" },
};

function formatItems(items: SupplyOrderItem[]): string {
  return items.map((i) => `${i.name} · ${formatQty(i.quantity)} ${UNIT_LABEL[i.unit] ?? i.unit}`).join(", ");
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

function OrdersTable({ orders, loadError }: { orders: SupplyOrderRow[]; loadError: string | null }) {
  const columns = useMemo<ProColumns<SupplyOrderRow>[]>(
    () => [
      {
        title: "Дата",
        dataIndex: "createdAt",
        width: 160,
        render: (_, row) => new Date(row.createdAt).toLocaleString("uk-UA"),
        sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        defaultSortOrder: "descend",
      },
      { title: "Цех / склад", dataIndex: "workshopName", width: 200 },
      { title: "Співробітник", dataIndex: "employeeName", width: 180 },
      {
        title: "Позиції",
        dataIndex: "items",
        render: (_, row) =>
          row.items.length === 0 ? (
            <Text type="secondary">—</Text>
          ) : (
            <Text>{formatItems(row.items)}</Text>
          ),
      },
      {
        title: "К-сть позицій",
        dataIndex: "items",
        width: 110,
        render: (_, row) => row.items.length,
      },
      {
        title: "Статус",
        dataIndex: "status",
        width: 130,
        render: (_, row) => {
          const meta = STATUS_META[row.status] ?? { label: row.status, color: "default" };
          return <Tag color={meta.color}>{meta.label}</Tag>;
        },
      },
      {
        title: "Коментар",
        dataIndex: "comment",
        render: (_, row) => row.comment ?? <Text type="secondary">—</Text>,
      },
    ],
    [],
  );

  return (
    <>
      {loadError ? <Alert type="error" showIcon message={loadError} style={{ marginBottom: 16 }} /> : null}
      <ProTable<SupplyOrderRow>
        rowKey="id"
        dataSource={orders}
        columns={columns}
        search={false}
        options={{ density: true, fullScreen: true, reload: false, setting: true }}
        pagination={{ pageSize: 50, showSizeChanger: true, showTotal: (total) => `${total} заявок` }}
        scroll={{ x: 1000 }}
      />
    </>
  );
}

function PendingMigrationCard({ title, description }: { title: string; description: string }) {
  return (
    <Card title={title} extra={<Tag color="gold">Очікує міграцію</Tag>}>
      <p>{description}</p>
      <p style={{ color: "#6b7280", marginBottom: 0 }}>
        Після подальшої роботи тут з’являться фільтри, список, history та захищені вкладення.
      </p>
    </Card>
  );
}

export function SupplyClient({ orders, loadError }: { orders: SupplyOrderRow[]; loadError: string | null }) {
  return (
    <Tabs
      defaultActiveKey="orders"
      items={[
        {
          key: "orders",
          label: "Замовлення сировини",
          children: <OrdersTable orders={orders} loadError={loadError} />,
        },
        {
          key: "defects",
          label: "Брак сировини",
          children: (
            <PendingMigrationCard
              title="Брак сировини"
              description="Акти браку, що потребують перевірки."
            />
          ),
        },
        {
          key: "incoming",
          label: "Прихідні накладні",
          children: (
            <PendingMigrationCard
              title="Прихідні накладні"
              description="Накладні та позиції приходу."
            />
          ),
        },
      ]}
    />
  );
}
