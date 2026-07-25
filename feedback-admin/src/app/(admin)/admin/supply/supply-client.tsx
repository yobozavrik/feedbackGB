"use client";

import { ApartmentOutlined, ContainerOutlined, ShopOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Alert, Card, Drawer, Tabs, Tag, Typography } from "antd";
import { useMemo, useState } from "react";

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
  workshopCode: string;
  employeeName: string;
  items: SupplyOrderItem[];
}

const UNIT_LABEL: Record<string, string> = { kg: "кг", liter: "л", piece: "шт" };

const STATUS_META: Record<string, { label: string; bg: string; text: string }> = {
  new: { label: "Нова", bg: "#e6f1fb", text: "#0c447c" },
  accepted: { label: "Прийнята", bg: "#e1f5ee", text: "#085041" },
  in_progress: { label: "В роботі", bg: "#faeeda", text: "#633806" },
  completed: { label: "Виконана", bg: "#eaf3de", text: "#27500a" },
  rejected: { label: "Відхилена", bg: "#fcebeb", text: "#791f1f" },
};

function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

function StatusPill({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, bg: "#f1efe8", text: "#444441" };
  return (
    <span
      style={{
        background: meta.bg,
        color: meta.text,
        fontSize: 12,
        fontWeight: 500,
        padding: "3px 10px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {meta.label}
    </span>
  );
}

/** zakupki.workshops has no explicit "kind" column — the code prefix already
 * encodes it (store_* / warehouse_* / everything else is a production цех). */
function WorkshopIcon({ code }: { code: string }) {
  const Icon = code.startsWith("store_") ? ShopOutlined : code.startsWith("warehouse_") ? ContainerOutlined : ApartmentOutlined;
  return (
    <span
      style={{
        width: 26,
        height: 26,
        borderRadius: 8,
        background: "#fde7ee",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Icon style={{ fontSize: 13, color: "#d54a78" }} />
    </span>
  );
}

function ItemsSummary({ items }: { items: SupplyOrderItem[] }) {
  if (items.length === 0) return <Text type="secondary">—</Text>;
  const [first, ...rest] = items;
  return (
    <Text>
      {first.name} · {formatQty(first.quantity)} {UNIT_LABEL[first.unit] ?? first.unit}
      {rest.length > 0 ? <Text type="secondary">, +{rest.length} позицій</Text> : null}
    </Text>
  );
}

function OrderDetailDrawer({ order, onClose }: { order: SupplyOrderRow | null; onClose: () => void }) {
  return (
    <Drawer title="Заявка на сировину" open={order !== null} onClose={onClose} width={420}>
      {order ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <WorkshopIcon code={order.workshopCode} />
            <Text strong style={{ fontSize: 15 }}>
              {order.workshopName}
            </Text>
            <StatusPill status={order.status} />
          </div>
          <Text type="secondary" style={{ fontSize: 13 }}>
            {order.employeeName} · {new Date(order.createdAt).toLocaleString("uk-UA")}
          </Text>

          <div style={{ marginTop: 20, marginBottom: 8, fontSize: 13, color: "#5a4848", fontWeight: 500 }}>
            Позиції ({order.items.length})
          </div>
          <div style={{ border: "1px solid #f0e6dc", borderRadius: 12, overflow: "hidden" }}>
            {order.items.map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  borderBottom: i < order.items.length - 1 ? "1px solid #f6ece2" : "none",
                  fontSize: 13,
                }}
              >
                <span>{item.name}</span>
                <span style={{ color: "#8c7a7a" }}>
                  {formatQty(item.quantity)} {UNIT_LABEL[item.unit] ?? item.unit}
                </span>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 20, marginBottom: 8, fontSize: 13, color: "#5a4848", fontWeight: 500 }}>
            Коментар
          </div>
          <Text>{order.comment ?? <Text type="secondary">—</Text>}</Text>
        </>
      ) : null}
    </Drawer>
  );
}

function OrdersTable({ orders, loadError }: { orders: SupplyOrderRow[]; loadError: string | null }) {
  const [selected, setSelected] = useState<SupplyOrderRow | null>(null);
  const columns = useMemo<ProColumns<SupplyOrderRow>[]>(
    () => [
      {
        title: "Дата",
        dataIndex: "createdAt",
        width: 150,
        render: (_, row) => new Date(row.createdAt).toLocaleString("uk-UA"),
        sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        defaultSortOrder: "descend",
      },
      {
        title: "Цех / склад",
        dataIndex: "workshopName",
        width: 200,
        render: (_, row) => (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <WorkshopIcon code={row.workshopCode} />
            {row.workshopName}
          </span>
        ),
      },
      { title: "Співробітник", dataIndex: "employeeName", width: 170 },
      {
        title: "Позиції",
        dataIndex: "items",
        render: (_, row) => <ItemsSummary items={row.items} />,
      },
      {
        title: "Статус",
        dataIndex: "status",
        width: 130,
        render: (_, row) => <StatusPill status={row.status} />,
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
        onRow={(row) => ({
          onClick: () => setSelected(row),
          style: { cursor: "pointer" },
        })}
      />
      <OrderDetailDrawer order={selected} onClose={() => setSelected(null)} />
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
