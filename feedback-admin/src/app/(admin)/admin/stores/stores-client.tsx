"use client";

import {
  ShopOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import {
  Alert,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
} from "antd";
import { useMemo, useState } from "react";
import { StoreDrawer } from "@/components/admin/stores/StoreDrawer";
import {
  buildStoreDetail,
  buildStoreSummaries,
  categoryTagColor,
  fmtAbs,
  fmtRel,
  groupSellersByStore,
  KPI_WINDOW_DAYS,
  type StoreSummary,
} from "@/lib/storeStats";
import type {
  StoreFeedRow,
  StoreRow,
  StoreSeller,
} from "./page";

const { Text } = Typography;

interface Props {
  stores: StoreRow[];
  feed: StoreFeedRow[];
  sellers: StoreSeller[];
  windowDays: number;
  error: string | null;
}

export function StoresClient({
  stores,
  feed,
  sellers,
  windowDays,
  error,
}: Props) {
  const { token } = antdTheme.useToken();
  const [openId, setOpenId] = useState<number | null>(null);

  const sellersByStore = useMemo(
    () => groupSellersByStore(sellers),
    [sellers],
  );

  const summaries = useMemo(
    () => buildStoreSummaries(stores, feed, sellersByStore),
    [stores, feed, sellersByStore],
  );

  const openSummary = useMemo(
    () => summaries.find((s) => s.store.id === openId) ?? null,
    [summaries, openId],
  );

  const openDetail = useMemo(
    () =>
      openSummary
        ? buildStoreDetail(openSummary, feed, sellersByStore)
        : null,
    [openSummary, feed, sellersByStore],
  );

  const columns: ProColumns<StoreSummary>[] = useMemo(
    () => [
      {
        title: "Магазин",
        dataIndex: ["store", "name"],
        fixed: "left",
        ellipsis: true,
        sorter: (a, b) =>
          a.store.name.localeCompare(b.store.name, "uk"),
        render: (_, row) => (
          <Space size={4} direction="vertical" style={{ rowGap: 0 }}>
            <Space size={6}>
              <ShopOutlined style={{ color: token.colorTextTertiary }} />
              <Text strong>{row.store.name}</Text>
              {!row.store.is_active ? (
                <Tag color="default" bordered={false}>
                  неактивний
                </Tag>
              ) : null}
            </Space>
            {row.store.address ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {row.store.address}
              </Text>
            ) : null}
          </Space>
        ),
      },
      {
        title: "30д",
        dataIndex: "total30",
        width: 110,
        align: "right",
        sorter: (a, b) => a.total30 - b.total30,
        render: (_, row) => {
          const delta = row.total30 - row.prev30;
          const color =
            delta > 0
              ? token.colorWarningText
              : delta < 0
                ? token.colorSuccessText
                : token.colorTextTertiary;
          return (
            <Space size={6}>
              <Text strong>{row.total30}</Text>
              {row.prev30 > 0 || row.total30 > 0 ? (
                <Tooltip
                  title={`Попередні ${KPI_WINDOW_DAYS} дн: ${row.prev30}`}
                >
                  <Text style={{ color, fontSize: 11 }}>
                    {delta > 0 ? "▲" : delta < 0 ? "▼" : "•"}
                    {Math.abs(delta)}
                  </Text>
                </Tooltip>
              ) : null}
            </Space>
          );
        },
      },
      {
        title: "Дефекти",
        dataIndex: "defect30",
        width: 110,
        align: "right",
        sorter: (a, b) => a.defect30 - b.defect30,
        render: (_, row) =>
          row.defect30 > 0 ? (
            <Tag color="red" bordered={false}>
              {row.defect30}
            </Tag>
          ) : (
            <Text type="secondary">0</Text>
          ),
      },
      {
        title: "Ідей",
        dataIndex: "ideas30",
        width: 90,
        align: "right",
        sorter: (a, b) => a.ideas30 - b.ideas30,
        render: (_, row) =>
          row.ideas30 > 0 ? (
            <Tag color="purple" bordered={false}>
              {row.ideas30}
            </Tag>
          ) : (
            <Text type="secondary">0</Text>
          ),
      },
      {
        title: "Топ-категорія",
        dataIndex: "topCategoryId",
        ellipsis: true,
        render: (_, row) =>
          row.topCategoryId ? (
            <Tag
              color={categoryTagColor(row.topCategoryId)}
              bordered={false}
            >
              {row.topCategoryTitle ?? row.topCategoryId}
            </Tag>
          ) : (
            <Text type="secondary">—</Text>
          ),
      },
      {
        title: "Продавчинь",
        dataIndex: "activeSellers",
        width: 130,
        align: "right",
        sorter: (a, b) => a.activeSellers - b.activeSellers,
        render: (_, row) => (
          <Space size={6}>
            <TeamOutlined style={{ color: token.colorTextTertiary }} />
            <Text>{row.activeSellers}</Text>
            {row.totalSellers > row.activeSellers ? (
              <Text type="secondary" style={{ fontSize: 11 }}>
                / {row.totalSellers}
              </Text>
            ) : null}
          </Space>
        ),
      },
      {
        title: "Останній фідбек",
        dataIndex: "lastAt",
        width: 160,
        sorter: (a, b) =>
          new Date(a.lastAt ?? 0).getTime() -
          new Date(b.lastAt ?? 0).getTime(),
        render: (_, row) => (
          <Tooltip title={fmtAbs(row.lastAt)}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {fmtRel(row.lastAt)}
            </Text>
          </Tooltip>
        ),
      },
    ],
    [token],
  );

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        message="Не вдалось завантажити дані"
        description={error}
      />
    );
  }

  return (
    <>
      <ProTable<StoreSummary>
        className="admin-stores-table"
        rowKey={(row) => `${row.store.id}`}
        dataSource={summaries}
        columns={columns}
        search={false}
        pagination={{ pageSize: 20, showSizeChanger: true }}
        options={{ density: true, fullScreen: true, reload: false, setting: true }}
        toolBarRender={() => [
          <Text key="hint" type="secondary" style={{ fontSize: 12 }}>
            Період метрик: {KPI_WINDOW_DAYS} днів. Вікно даних: {windowDays} днів.
          </Text>,
        ]}
        onRow={(row) => ({
          onClick: () => setOpenId(row.store.id),
          style: { cursor: "pointer" },
        })}
        scroll={{ x: 960 }}
      />

      <StoreDrawer
        summary={openSummary}
        detail={openDetail}
        onClose={() => setOpenId(null)}
      />
    </>
  );
}
