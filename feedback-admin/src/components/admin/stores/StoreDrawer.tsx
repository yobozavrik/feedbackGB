"use client";

import { EnvironmentOutlined, ShopOutlined } from "@ant-design/icons";
import { Line, Pie } from "@ant-design/plots";
import { StatisticCard } from "@ant-design/pro-components";
import {
  Card,
  Col,
  Drawer,
  Empty,
  List,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MetaText } from "@/components/admin/ui/typography";
import {
  categoryTagColor,
  fmtRel,
  KPI_WINDOW_DAYS,
  STATUS_TAG,
  statusLabel,
  TREND_WINDOW_DAYS,
  type StoreDetail,
  type StoreSummary,
} from "@/lib/storeStats";

const { Text, Paragraph } = Typography;

interface Props {
  summary: StoreSummary | null;
  detail: StoreDetail | null;
  onClose: () => void;
}

export function StoreDrawer({ summary, detail, onClose }: Props) {
  const { token } = antdTheme.useToken();
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

  return (
    <Drawer
      className="admin-store-drawer"
      open={summary != null}
      onClose={onClose}
      width={drawerWidth}
      title={
        summary ? (
          <Space size={8}>
            <ShopOutlined />
            <Text strong>{summary.store.name}</Text>
            {!summary.store.is_active ? (
              <Tag color="default" bordered={false}>
                неактивний
              </Tag>
            ) : null}
          </Space>
        ) : null
      }
      destroyOnClose
    >
      {summary && detail ? (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Card size="small">
            <Space size={8} wrap>
              <EnvironmentOutlined style={{ color: token.colorTextTertiary }} />
              <Text>
                {summary.store.address ?? (
                  <Text type="secondary">адресу не вказано</Text>
                )}
              </Text>
              {summary.store.lat != null &&
              summary.store.lng != null ? (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${summary.store.lat},${summary.store.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: 12 }}
                >
                  показати на мапі
                </a>
              ) : null}
            </Space>
          </Card>

          <StatisticCard.Group className="admin-store-kpi-grid">
            <StatisticCard
              statistic={{
                title: `За ${KPI_WINDOW_DAYS} днів`,
                value: summary.total30,
                suffix: "шт",
              }}
            />
            <StatisticCard.Divider />
            <StatisticCard
              statistic={{
                title: "Дефекти",
                value: summary.defect30,
                valueStyle:
                  summary.defect30 > 0
                    ? { color: token.colorErrorText }
                    : undefined,
              }}
            />
            <StatisticCard.Divider />
            <StatisticCard
              statistic={{
                title: "Ідей",
                value: summary.ideas30,
              }}
            />
            <StatisticCard.Divider />
            <StatisticCard
              statistic={{
                title: "Продавчинь",
                value: summary.activeSellers,
                description:
                  summary.totalSellers > summary.activeSellers
                    ? `всього ${summary.totalSellers}`
                    : undefined,
              }}
            />
          </StatisticCard.Group>

          <Card title={`Тренд за ${TREND_WINDOW_DAYS} днів`} size="small">
            {detail.trendData.some((d) => d.value > 0) ? (
              <div style={{ height: 200 }}>
                <Line
                  data={detail.trendData}
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
                {detail.categoryData.length > 0 ? (
                  <div style={{ height: 220 }}>
                    <Pie
                      data={detail.categoryData}
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
                {detail.statusData.length > 0 ? (
                  <div style={{ height: 220 }}>
                    <Pie
                      data={detail.statusData}
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
            {detail.topProducts.length > 0 ? (
              <Table
                size="small"
                pagination={false}
                rowKey={(r) => r.name}
                dataSource={detail.topProducts}
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
            {detail.sellers.length > 0 ? (
              <List
                size="small"
                dataSource={detail.sellers}
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
                        <MetaText>Останній вхід: {fmtRel(s.last_login)}</MetaText>
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
            {detail.recent.length > 0 ? (
              <List
                size="small"
                dataSource={detail.recent}
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
                          {statusLabel(r.status)}
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
  );
}
