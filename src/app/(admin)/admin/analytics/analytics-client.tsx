"use client";

import { Bar, Column, Line, Pie } from "@ant-design/plots";
import { StatisticCard } from "@ant-design/pro-components";
import {
  Alert,
  Card,
  Col,
  Empty,
  Row,
  Segmented,
  Space,
  Typography,
  theme as antdTheme,
} from "antd";
import { useMemo, useState } from "react";

const { Text } = Typography;

export interface AnalyticsRow {
  created_at: string;
  category: string;
  category_title: string | null;
  store_name: string | null;
  status: string;
}

type Period = "7" | "30" | "90";

const PERIOD_OPTIONS: { label: string; value: Period; days: number }[] = [
  { label: "7 днів", value: "7", days: 7 },
  { label: "30 днів", value: "30", days: 30 },
  { label: "90 днів", value: "90", days: 90 },
];

const STATUS_LABEL: Record<string, string> = {
  new: "Нове",
  in_progress: "В роботі",
  resolved: "Закрито",
  duplicate: "Дубль",
};

const DAY_MS = 24 * 60 * 60 * 1000;

interface Props {
  rows: AnalyticsRow[];
  error: string | null;
}

export function AnalyticsClient({ rows, error }: Props) {
  const { token } = antdTheme.useToken();
  const [period, setPeriod] = useState<Period>("30");

  const periodConfig = PERIOD_OPTIONS.find((p) => p.value === period)!;

  const filtered = useMemo(() => {
    // Align cutoff with bucket loop: include items whose date is within the
    // last `days` calendar days (today + (days - 1) previous days). Using
    // `days - 1` here keeps stats.total in sync with what the trend charts
    // actually plot.
    const cutoff = Date.now() - (periodConfig.days - 1) * DAY_MS;
    return rows.filter((r) => new Date(r.created_at).getTime() >= cutoff);
  }, [rows, periodConfig.days]);

  const stats = useMemo(() => {
    const total = filtered.length;
    const avgPerDay = total / periodConfig.days;

    const byCategory = new Map<string, number>();
    const byCategoryTitle = new Map<string, string>();
    for (const r of filtered) {
      byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + 1);
      if (r.category_title) {
        byCategoryTitle.set(r.category, r.category_title);
      }
    }

    const byStore = new Map<string, number>();
    for (const r of filtered) {
      const s = r.store_name ?? "(без магазину)";
      byStore.set(s, (byStore.get(s) ?? 0) + 1);
    }

    const byStatus = new Map<string, number>();
    for (const r of filtered) {
      byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    }

    const topCategoryEntry = Array.from(byCategory.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0];
    const topStoreEntry = Array.from(byStore.entries()).sort(
      (a, b) => b[1] - a[1],
    )[0];

    return {
      total,
      avgPerDay,
      byCategory,
      byCategoryTitle,
      byStore,
      byStatus,
      topCategoryKey: topCategoryEntry?.[0] ?? null,
      topCategoryCount: topCategoryEntry?.[1] ?? 0,
      topStoreKey: topStoreEntry?.[0] ?? null,
      topStoreCount: topStoreEntry?.[1] ?? 0,
    };
  }, [filtered, periodConfig.days]);

  const categoryData = useMemo(() => {
    return Array.from(stats.byCategory.entries())
      .map(([key, count]) => ({
        type: stats.byCategoryTitle.get(key) ?? key,
        value: count,
      }))
      .sort((a, b) => b.value - a.value);
  }, [stats]);

  const trendData = useMemo(() => {
    const buckets = new Map<string, number>();
    for (let i = periodConfig.days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, 0);
    }
    for (const r of filtered) {
      const key = new Date(r.created_at).toISOString().slice(0, 10);
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }
    return Array.from(buckets.entries()).map(([date, value]) => ({
      date,
      value,
    }));
  }, [filtered, periodConfig.days]);

  const trendByCategoryData = useMemo(() => {
    const top4 = categoryData.slice(0, 4).map((c) => c.type);
    if (top4.length === 0) return [];
    const buckets = new Map<string, Map<string, number>>();
    for (let i = periodConfig.days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * DAY_MS);
      const key = d.toISOString().slice(0, 10);
      const inner = new Map<string, number>();
      for (const c of top4) inner.set(c, 0);
      buckets.set(key, inner);
    }
    for (const r of filtered) {
      const key = new Date(r.created_at).toISOString().slice(0, 10);
      const title = stats.byCategoryTitle.get(r.category) ?? r.category;
      const inner = buckets.get(key);
      if (inner && inner.has(title)) {
        inner.set(title, (inner.get(title) ?? 0) + 1);
      }
    }
    const out: { date: string; category: string; value: number }[] = [];
    for (const [date, inner] of buckets) {
      for (const [category, value] of inner) {
        out.push({ date, category, value });
      }
    }
    return out;
  }, [filtered, categoryData, periodConfig.days, stats.byCategoryTitle]);

  const topStoresData = useMemo(() => {
    return Array.from(stats.byStore.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([store, value]) => ({ store, value }))
      .reverse();
  }, [stats]);

  const statusData = useMemo(() => {
    return Array.from(stats.byStatus.entries()).map(([key, value]) => ({
      type: STATUS_LABEL[key] ?? key,
      value,
    }));
  }, [stats]);

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

  if (rows.length === 0) {
    return (
      <Card>
        <Empty description="Поки що немає фідбеків за останні 90 днів" />
      </Card>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Space size={12} align="center">
        <Text type="secondary">Період:</Text>
        <Segmented<Period>
          value={period}
          onChange={(v) => setPeriod(v as Period)}
          options={PERIOD_OPTIONS.map((p) => ({
            label: p.label,
            value: p.value,
          }))}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          {filtered.length} фідбеків за {periodConfig.days} днів
        </Text>
      </Space>

      <StatisticCard.Group>
        <StatisticCard
          statistic={{
            title: "Всього за період",
            value: stats.total,
            suffix: "шт",
          }}
        />
        <StatisticCard.Divider />
        <StatisticCard
          statistic={{
            title: "У середньому за день",
            value: Number(stats.avgPerDay.toFixed(1)),
            suffix: "шт/день",
          }}
        />
        <StatisticCard.Divider />
        <StatisticCard
          statistic={{
            title: "Топ-категорія",
            value:
              stats.topCategoryKey
                ? stats.byCategoryTitle.get(stats.topCategoryKey) ??
                  stats.topCategoryKey
                : "—",
            description:
              stats.topCategoryCount > 0
                ? `${stats.topCategoryCount} фідбеків`
                : undefined,
          }}
        />
        <StatisticCard.Divider />
        <StatisticCard
          statistic={{
            title: "Топ-магазин",
            value: stats.topStoreKey ?? "—",
            description:
              stats.topStoreCount > 0
                ? `${stats.topStoreCount} фідбеків`
                : undefined,
          }}
        />
      </StatisticCard.Group>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="Розподіл за категоріями" size="small">
            {categoryData.length > 0 ? (
              <div style={{ height: 320 }}>
                <Pie
                  data={categoryData}
                  angleField="value"
                  colorField="type"
                  innerRadius={0.55}
                  legend={{
                    color: { position: "right", layout: { justifyContent: "center" } },
                  }}
                  label={{
                    text: "value",
                    position: "spider",
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
        <Col xs={24} lg={12}>
          <Card title="Розподіл за статусами" size="small">
            {statusData.length > 0 ? (
              <div style={{ height: 320 }}>
                <Pie
                  data={statusData}
                  angleField="value"
                  colorField="type"
                  legend={{
                    color: { position: "right", layout: { justifyContent: "center" } },
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
        <Col xs={24}>
          <Card title="Тренд по днях" size="small">
            {trendData.length > 0 ? (
              <div style={{ height: 280 }}>
                <Line
                  data={trendData}
                  xField="date"
                  yField="value"
                  smooth
                  point={{ size: 3 }}
                  axis={{
                    x: { labelAutoHide: true, title: false },
                    y: { title: "Фідбеків" },
                  }}
                  style={{
                    stroke: token.colorPrimary,
                    lineWidth: 2,
                  }}
                  tooltip={{
                    title: "date",
                    items: [{ field: "value", name: "Кількість" }],
                  }}
                />
              </div>
            ) : (
              <Empty />
            )}
          </Card>
        </Col>
        {trendByCategoryData.length > 0 ? (
          <Col xs={24}>
            <Card
              title="Тренд по днях — топ-4 категорії"
              size="small"
              extra={
                <Text type="secondary" style={{ fontSize: 12 }}>
                  стек по днях
                </Text>
              }
            >
              <div style={{ height: 280 }}>
                <Column
                  data={trendByCategoryData}
                  xField="date"
                  yField="value"
                  colorField="category"
                  stack
                  axis={{
                    x: { labelAutoHide: true, title: false },
                    y: { title: "Фідбеків" },
                  }}
                  tooltip={{
                    title: "date",
                    items: [
                      { field: "category", name: "Категорія" },
                      { field: "value", name: "Кількість" },
                    ],
                  }}
                />
              </div>
            </Card>
          </Col>
        ) : null}
        <Col xs={24}>
          <Card title="Топ-10 магазинів" size="small">
            {topStoresData.length > 0 ? (
              <div
                style={{
                  height: Math.max(280, topStoresData.length * 32),
                }}
              >
                <Bar
                  data={topStoresData}
                  xField="value"
                  yField="store"
                  sort={{ reverse: true, by: "x" }}
                  label={{
                    text: "value",
                    position: "right",
                    style: { fontSize: 11 },
                  }}
                  axis={{
                    y: { title: false },
                    x: { title: "Кількість фідбеків" },
                  }}
                  style={{ fill: token.colorPrimary }}
                  tooltip={{
                    title: "store",
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
    </Space>
  );
}
