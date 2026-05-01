"use client";

import {
  EnvironmentOutlined,
  ShopOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Line, Pie } from "@ant-design/plots";
import {
  ProTable,
  StatisticCard,
  type ProColumns,
} from "@ant-design/pro-components";
import {
  Alert,
  Card,
  Col,
  Drawer,
  Empty,
  List,
  Row,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
} from "antd";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  StoreFeedRow,
  StoreRow,
  StoreSeller,
} from "./page";

const { Text, Paragraph } = Typography;

const DAY_MS = 24 * 60 * 60 * 1000;
const KPI_WINDOW_DAYS = 30;
const TREND_WINDOW_DAYS = 30;
const TOP_PRODUCTS = 8;
const RECENT_FEEDBACK = 10;

const STATUS_LABEL: Record<string, string> = {
  new: "Нове",
  in_progress: "В роботі",
  resolved: "Закрито",
  duplicate: "Дубль",
};

const STATUS_TAG: Record<
  string,
  "default" | "processing" | "success" | "warning"
> = {
  new: "processing",
  in_progress: "warning",
  resolved: "success",
  duplicate: "default",
};

const CATEGORY_TAG_COLOR: Record<string, string> = {
  missing_item: "orange",
  overstock: "geekblue",
  defect: "red",
  supply_problem: "gold",
  store_idea: "purple",
  spotted_elsewhere: "magenta",
  tech_issue: "cyan",
  customer_voice: "blue",
};

interface Props {
  stores: StoreRow[];
  feed: StoreFeedRow[];
  sellers: StoreSeller[];
  windowDays: number;
  error: string | null;
}

interface StoreSummary {
  store: StoreRow;
  total30: number;
  prev30: number;
  defect30: number;
  ideas30: number;
  topCategoryId: string | null;
  topCategoryTitle: string | null;
  lastAt: string | null;
  activeSellers: number;
  totalSellers: number;
}

function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "щойно";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "щойно";
  if (m < 60) return `${m} хв тому`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} год тому`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} дн тому`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} міс тому`;
  return `${Math.floor(mo / 12)} р тому`;
}

function fmtAbs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("uk-UA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function categoryTagColor(id: string): string {
  return CATEGORY_TAG_COLOR[id] ?? "default";
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
  // Ширина Drawer-а рахується після mount, щоб не було SSR vs CSR
  // hydration mismatch на вузьких viewports (375 тощо).
  const [drawerWidth, setDrawerWidth] = useState(720);
  useEffect(() => {
    const update = () =>
      setDrawerWidth(Math.min(720, window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const sellersByStore = useMemo(() => {
    const m = new Map<number, StoreSeller[]>();
    for (const s of sellers) {
      if (s.store_id == null) continue;
      const list = m.get(s.store_id);
      if (list) list.push(s);
      else m.set(s.store_id, [s]);
    }
    return m;
  }, [sellers]);

  const summaries = useMemo<StoreSummary[]>(() => {
    const now = Date.now();
    const cutoff30 = now - (KPI_WINDOW_DAYS - 1) * DAY_MS;
    const cutoff60 = now - (2 * KPI_WINDOW_DAYS - 1) * DAY_MS;

    const total30 = new Map<number, number>();
    const prev30 = new Map<number, number>();
    const defect30 = new Map<number, number>();
    const ideas30 = new Map<number, number>();
    const cats30 = new Map<number, Map<string, number>>();
    const titles = new Map<string, string>();
    const last = new Map<number, string>();

    for (const r of feed) {
      if (r.store_id == null) continue;
      const ts = new Date(r.created_at).getTime();
      if (r.category_title) titles.set(r.category, r.category_title);
      if (ts >= cutoff30) {
        total30.set(r.store_id, (total30.get(r.store_id) ?? 0) + 1);
        if (r.category === "defect") {
          defect30.set(r.store_id, (defect30.get(r.store_id) ?? 0) + 1);
        }
        if (r.category === "store_idea") {
          ideas30.set(r.store_id, (ideas30.get(r.store_id) ?? 0) + 1);
        }
        let inner = cats30.get(r.store_id);
        if (!inner) {
          inner = new Map<string, number>();
          cats30.set(r.store_id, inner);
        }
        inner.set(r.category, (inner.get(r.category) ?? 0) + 1);
      } else if (ts >= cutoff60) {
        prev30.set(r.store_id, (prev30.get(r.store_id) ?? 0) + 1);
      }
      const prevLast = last.get(r.store_id);
      if (!prevLast || new Date(prevLast).getTime() < ts) {
        last.set(r.store_id, r.created_at);
      }
    }

    return stores.map((store) => {
      const inner = cats30.get(store.id);
      let topId: string | null = null;
      let topCount = 0;
      if (inner) {
        for (const [k, v] of inner) {
          if (v > topCount) {
            topCount = v;
            topId = k;
          }
        }
      }
      const storeSellers = sellersByStore.get(store.id) ?? [];
      return {
        store,
        total30: total30.get(store.id) ?? 0,
        prev30: prev30.get(store.id) ?? 0,
        defect30: defect30.get(store.id) ?? 0,
        ideas30: ideas30.get(store.id) ?? 0,
        topCategoryId: topId,
        topCategoryTitle: topId ? titles.get(topId) ?? topId : null,
        lastAt: last.get(store.id) ?? null,
        activeSellers: storeSellers.filter((s) => s.is_active).length,
        totalSellers: storeSellers.length,
      };
    });
  }, [stores, feed, sellersByStore]);

  const openSummary = useMemo(
    () => summaries.find((s) => s.store.id === openId) ?? null,
    [summaries, openId],
  );

  const openDetail = useMemo(() => {
    if (!openSummary) return null;
    const store = openSummary.store;
    const rows = feed.filter((r) => r.store_id === store.id);
    const cutoffTrend = Date.now() - (TREND_WINDOW_DAYS - 1) * DAY_MS;
    const trendRows = rows.filter(
      (r) => new Date(r.created_at).getTime() >= cutoffTrend,
    );

    // tренд по днях
    const buckets = new Map<string, number>();
    for (let i = TREND_WINDOW_DAYS - 1; i >= 0; i--) {
      const key = new Date(Date.now() - i * DAY_MS)
        .toISOString()
        .slice(0, 10);
      buckets.set(key, 0);
    }
    for (const r of trendRows) {
      const key = new Date(r.created_at).toISOString().slice(0, 10);
      if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const trendData = Array.from(buckets.entries()).map(([date, value]) => ({
      date,
      value,
    }));

    // розподіл по категоріях за 30 днів
    const catCount = new Map<string, number>();
    const catTitle = new Map<string, string>();
    const statusCount = new Map<string, number>();
    for (const r of trendRows) {
      catCount.set(r.category, (catCount.get(r.category) ?? 0) + 1);
      if (r.category_title) catTitle.set(r.category, r.category_title);
      statusCount.set(r.status, (statusCount.get(r.status) ?? 0) + 1);
    }
    const categoryData = Array.from(catCount.entries())
      .map(([id, value]) => ({
        type: catTitle.get(id) ?? id,
        id,
        value,
      }))
      .sort((a, b) => b.value - a.value);
    const statusData = Array.from(statusCount.entries()).map(([k, v]) => ({
      type: STATUS_LABEL[k] ?? k,
      value: v,
    }));

    // топ продукти (за весь window)
    const productCount = new Map<
      string,
      { name: string; count: number; defectCount: number }
    >();
    for (const r of rows) {
      if (r.product_id == null || !r.product_name) continue;
      const key = `${r.product_id}`;
      const cur = productCount.get(key) ?? {
        name: r.product_name,
        count: 0,
        defectCount: 0,
      };
      cur.count += 1;
      if (r.category === "defect") cur.defectCount += 1;
      productCount.set(key, cur);
    }
    const topProducts = Array.from(productCount.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, TOP_PRODUCTS);

    const recent = rows.slice(0, RECENT_FEEDBACK);

    const storeSellers = sellersByStore.get(store.id) ?? [];

    return {
      store,
      trendData,
      categoryData,
      statusData,
      topProducts,
      recent,
      sellers: storeSellers,
      total30Window: trendRows.length,
    };
  }, [openSummary, feed, sellersByStore]);

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

      <Drawer
        open={openId != null}
        onClose={() => setOpenId(null)}
        width={drawerWidth}
        title={
          openSummary ? (
            <Space size={8}>
              <ShopOutlined />
              <Text strong>{openSummary.store.name}</Text>
              {!openSummary.store.is_active ? (
                <Tag color="default" bordered={false}>
                  неактивний
                </Tag>
              ) : null}
            </Space>
          ) : null
        }
        destroyOnClose
      >
        {openSummary && openDetail ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Card size="small">
              <Space size={8} wrap>
                <EnvironmentOutlined style={{ color: token.colorTextTertiary }} />
                <Text>
                  {openSummary.store.address ?? (
                    <Text type="secondary">адресу не вказано</Text>
                  )}
                </Text>
                {openSummary.store.lat != null &&
                openSummary.store.lng != null ? (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${openSummary.store.lat},${openSummary.store.lng}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12 }}
                  >
                    показати на мапі
                  </a>
                ) : null}
              </Space>
            </Card>

            <StatisticCard.Group>
              <StatisticCard
                statistic={{
                  title: `За ${KPI_WINDOW_DAYS} днів`,
                  value: openSummary.total30,
                  suffix: "шт",
                }}
              />
              <StatisticCard.Divider />
              <StatisticCard
                statistic={{
                  title: "Дефекти",
                  value: openSummary.defect30,
                  valueStyle:
                    openSummary.defect30 > 0
                      ? { color: token.colorErrorText }
                      : undefined,
                }}
              />
              <StatisticCard.Divider />
              <StatisticCard
                statistic={{
                  title: "Ідей",
                  value: openSummary.ideas30,
                }}
              />
              <StatisticCard.Divider />
              <StatisticCard
                statistic={{
                  title: "Продавчинь",
                  value: openSummary.activeSellers,
                  description:
                    openSummary.totalSellers > openSummary.activeSellers
                      ? `всього ${openSummary.totalSellers}`
                      : undefined,
                }}
              />
            </StatisticCard.Group>

            <Card title={`Тренд за ${TREND_WINDOW_DAYS} днів`} size="small">
              {openDetail.trendData.some((d) => d.value > 0) ? (
                <div style={{ height: 200 }}>
                  <Line
                    data={openDetail.trendData}
                    xField="date"
                    yField="value"
                    smooth
                    point={{ size: 3 }}
                    axis={{
                      x: { labelAutoHide: true, title: false },
                      y: { title: false },
                    }}
                    style={{
                      stroke: token.colorPrimary,
                      lineWidth: 2,
                    }}
                  />
                </div>
              ) : (
                <Empty description="Немає фідбеку за цей період" />
              )}
            </Card>

            <Row gutter={[16, 16]}>
              <Col xs={24} md={12}>
                <Card title="Категорії" size="small">
                  {openDetail.categoryData.length > 0 ? (
                    <div style={{ height: 220 }}>
                      <Pie
                        data={openDetail.categoryData}
                        angleField="value"
                        colorField="type"
                        innerRadius={0.55}
                        legend={{
                          color: {
                            position: "right",
                            layout: { justifyContent: "center" },
                          },
                        }}
                        label={{
                          text: "value",
                          style: { fontSize: 11 },
                        }}
                        tooltip={{
                          title: "type",
                          items: [{ field: "value", name: "Кількість" }],
                        }}
                      />
                    </div>
                  ) : (
                    <Empty />
                  )}
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card title="Статуси" size="small">
                  {openDetail.statusData.length > 0 ? (
                    <div style={{ height: 220 }}>
                      <Pie
                        data={openDetail.statusData}
                        angleField="value"
                        colorField="type"
                        legend={{
                          color: {
                            position: "right",
                            layout: { justifyContent: "center" },
                          },
                        }}
                        label={{
                          text: (d: { value: number }) => `${d.value}`,
                          style: { fontSize: 11 },
                        }}
                        tooltip={{
                          title: "type",
                          items: [{ field: "value", name: "Кількість" }],
                        }}
                      />
                    </div>
                  ) : (
                    <Empty />
                  )}
                </Card>
              </Col>
            </Row>

            <Card title="Топ товари (за вікно)" size="small">
              {openDetail.topProducts.length > 0 ? (
                <Table
                  size="small"
                  pagination={false}
                  rowKey={(r) => r.name}
                  dataSource={openDetail.topProducts}
                  columns={[
                    {
                      title: "Товар",
                      dataIndex: "name",
                      ellipsis: true,
                    },
                    {
                      title: "Згадок",
                      dataIndex: "count",
                      width: 100,
                      align: "right",
                    },
                    {
                      title: "Дефекти",
                      dataIndex: "defectCount",
                      width: 100,
                      align: "right",
                      render: (v: number) =>
                        v > 0 ? (
                          <Tag color="red" bordered={false}>
                            {v}
                          </Tag>
                        ) : (
                          <Text type="secondary">0</Text>
                        ),
                    },
                  ]}
                />
              ) : (
                <Empty description="Немає товарів у фідбеці" />
              )}
            </Card>

            <Card title="Продавчині" size="small">
              {openDetail.sellers.length > 0 ? (
                <List
                  size="small"
                  dataSource={openDetail.sellers}
                  renderItem={(s) => (
                    <List.Item
                      actions={[
                        <Link
                          key="users"
                          href="/admin/users"
                          style={{ fontSize: 12 }}
                        >
                          відкрити в Користувачах →
                        </Link>,
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space size={6}>
                            <Text>{s.full_name}</Text>
                            {!s.is_active ? (
                              <Tag color="default" bordered={false}>
                                неактивна
                              </Tag>
                            ) : null}
                            {!s.has_pin ? (
                              <Tag color="orange" bordered={false}>
                                без PIN
                              </Tag>
                            ) : null}
                          </Space>
                        }
                        description={
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            Останній вхід: {fmtRel(s.last_login)}
                          </Text>
                        }
                      />
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description="До магазину ще нікого не привʼязано" />
              )}
            </Card>

            <Card
              title={`Останні фідбеки`}
              size="small"
              extra={
                <Link href="/admin" style={{ fontSize: 12 }}>
                  Уся стрічка →
                </Link>
              }
            >
              {openDetail.recent.length > 0 ? (
                <List
                  size="small"
                  dataSource={openDetail.recent}
                  renderItem={(r) => (
                    <List.Item>
                      <Space
                        direction="vertical"
                        size={2}
                        style={{ width: "100%" }}
                      >
                        <Space size={6} wrap>
                          <Tag
                            color={categoryTagColor(r.category)}
                            bordered={false}
                          >
                            {r.category_emoji ?? ""}{" "}
                            {r.category_title ?? r.category}
                          </Tag>
                          <Tag
                            color={STATUS_TAG[r.status] ?? "default"}
                            bordered={false}
                          >
                            {STATUS_LABEL[r.status] ?? r.status}
                          </Tag>
                          <Text
                            type="secondary"
                            style={{ fontSize: 12 }}
                          >
                            {fmtRel(r.created_at)} ·{" "}
                            {r.user_full_name ?? "—"}
                          </Text>
                        </Space>
                        {r.summary ? (
                          <Paragraph
                            style={{
                              marginBottom: 0,
                              fontSize: 13,
                              color: token.colorText,
                            }}
                            ellipsis={{ rows: 2 }}
                          >
                            {r.summary}
                          </Paragraph>
                        ) : null}
                        {r.product_name ? (
                          <Text
                            type="secondary"
                            style={{ fontSize: 12 }}
                          >
                            Товар: {r.product_name}
                          </Text>
                        ) : null}
                      </Space>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty description="Немає фідбеку" />
              )}
            </Card>
          </Space>
        ) : null}
      </Drawer>
    </>
  );
}
