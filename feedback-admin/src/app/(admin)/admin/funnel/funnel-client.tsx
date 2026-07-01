"use client";

import {
  ClockCircleOutlined,
  ReloadOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Bar, Heatmap, Sankey } from "@ant-design/plots";
import {
  ProTable,
  StatisticCard,
  type ProColumns,
} from "@ant-design/pro-components";
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Segmented,
  Space,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FunnelResponse } from "@/lib/posthog/types";

const { Text } = Typography;

type Period = "7" | "30" | "90";
const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: "7 днів", value: "7" },
  { label: "30 днів", value: "30" },
  { label: "90 днів", value: "90" },
];

const DAY_LABELS_UA = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];

interface Props {
  initial: FunnelResponse;
}

function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function formatHoursAgo(hours: number): string {
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `${minutes} хв тому`;
  }
  if (hours < 24) return `${hours.toFixed(1)} год тому`;
  return `${Math.round(hours / 24)} дн тому`;
}

export function FunnelClient({ initial }: Props) {
  const { token } = antdTheme.useToken();
  const [period, setPeriod] = useState<Period>(
    String(initial.periodDays) as Period,
  );
  const [data, setData] = useState<FunnelResponse>(initial);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchPeriod = useCallback(async (next: Period) => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/admin/funnel?period=${next}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as FunnelResponse;
      setData(json);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (period === String(data.periodDays)) return;
    void fetchPeriod(period);
  }, [period, data.periodDays, fetchPeriod]);

  const sankeyData = useMemo(() => {
    const links: { source: string; target: string; value: number }[] = [];
    for (let i = 0; i < data.steps.length - 1; i += 1) {
      const from = data.steps[i];
      const to = data.steps[i + 1];
      if (to.count > 0) {
        links.push({
          source: from.label,
          target: to.label,
          value: to.count,
        });
      }
      if (from.dropOffCount > 0 && i > 0) {
        // Render drop-off out of step i: phantom "Відвалились" lane.
        links.push({
          source: from.label,
          target: `Відвалились після ${from.label}`,
          value: from.dropOffCount,
        });
      }
    }
    return links;
  }, [data.steps]);

  const dropOffBarData = useMemo(
    () =>
      data.steps
        .slice(1)
        .map((step) => ({
          step: step.label,
          dropOff: step.dropOffPct,
          dropOffCount: step.dropOffCount,
        }))
        .reverse(),
    [data.steps],
  );

  const heatmapData = useMemo(
    () =>
      data.heatmap.map((cell) => ({
        day: DAY_LABELS_UA[cell.dayOfWeek] ?? String(cell.dayOfWeek),
        hour: `${String(cell.hour).padStart(2, "0")}:00`,
        starts: cell.starts,
        completes: cell.completes,
        dropOff: cell.dropOffPct,
      })),
    [data.heatmap],
  );

  const stuckColumns: ProColumns<FunnelResponse["stuck"][number]>[] = [
    {
      title: "Користувач",
      dataIndex: "label",
      render: (_, row) => row.label || row.distinctId,
    },
    {
      title: "Останній крок",
      dataIndex: "lastEvent",
      render: (_, row) => <Tag color="orange">{row.lastEvent}</Tag>,
    },
    {
      title: "Коли",
      dataIndex: "hoursAgo",
      width: 140,
      render: (_, row) => formatHoursAgo(row.hoursAgo),
    },
  ];

  const startCount = data.steps[0]?.count ?? 0;
  const finishCount = data.steps[data.steps.length - 1]?.count ?? 0;
  const overallConv =
    startCount > 0 ? (finishCount / startCount) * 100 : 0;
  const totalDropOff = startCount - finishCount;

  if (data.steps.length === 0 && data.error) {
    return (
      <Empty
        description={
          <Space direction="vertical" size={4}>
            <Text>PostHog недоступний</Text>
            <Text type="secondary">{data.error}</Text>
          </Space>
        }
      />
    );
  }

  return (
    <Space
      className="admin-funnel-page"
      direction="vertical"
      size="large"
      style={{ width: "100%" }}
    >
      {data.error ? (
        <Alert
          type="warning"
          showIcon
          message="Деякі запити до PostHog впали — показуємо доступні дані"
          description={data.error}
        />
      ) : null}
      {fetchError ? (
        <Alert
          type="error"
          showIcon
          message="Не вдалось оновити дані"
          description={fetchError}
        />
      ) : null}

      <Row gutter={[16, 16]} align="middle">
        <Col flex="auto">
          <Segmented
            options={PERIOD_OPTIONS}
            value={period}
            onChange={(v) => setPeriod(v as Period)}
          />
        </Col>
        <Col>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => fetchPeriod(period)}
            loading={loading}
          >
            Оновити
          </Button>
        </Col>
      </Row>

      <Row className="admin-funnel-kpi-row" gutter={[16, 16]}>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            statistic={{
              title: "Стартували",
              value: startCount,
              suffix: "сесій",
            }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            statistic={{
              title: "Дійшли до кінця",
              value: finishCount,
              suffix: "фідбеків",
              valueStyle: { color: token.colorSuccess },
            }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            statistic={{
              title: "Загальна конверсія",
              value: overallConv,
              precision: 1,
              suffix: "%",
              valueStyle: {
                color:
                  overallConv >= 60
                    ? token.colorSuccess
                    : overallConv >= 30
                      ? token.colorWarning
                      : token.colorError,
              },
            }}
          />
        </Col>
        <Col xs={24} sm={12} md={6}>
          <StatisticCard
            statistic={{
              title: "Втратили",
              value: totalDropOff,
              prefix: <WarningOutlined />,
              valueStyle: { color: token.colorError },
            }}
          />
        </Col>
      </Row>

      <Card title="Воронка" loading={loading}>
        {sankeyData.length === 0 ? (
          <Empty description="Поки що нема подій у вибраному вікні" />
        ) : (
          <Sankey
            data={sankeyData}
            sourceField="source"
            targetField="target"
            weightField="value"
            nodeWidthRatio={0.012}
            nodePaddingRatio={0.04}
            height={420}
          />
        )}
      </Card>

      <Card
        title="Drop-off на кожному кроці"
        loading={loading}
        extra={
          <Text type="secondary">
            % користувачів, які дійшли до попереднього кроку, але далі не пішли
          </Text>
        }
      >
        {dropOffBarData.length === 0 ? (
          <Empty description="Нема даних" />
        ) : (
          <Bar
            data={dropOffBarData}
            xField="dropOff"
            yField="step"
            seriesField="step"
            legend={false}
            label={{
              position: "right",
              formatter: (datum: { dropOff: number; dropOffCount: number }) =>
                `${datum.dropOff.toFixed(1)}% (${datum.dropOffCount})`,
            }}
            color={(datum: { dropOff: number }) => {
              if (datum.dropOff <= 5) return token.colorSuccess;
              if (datum.dropOff <= 15) return token.colorWarning;
              return token.colorError;
            }}
            height={Math.max(220, dropOffBarData.length * 48)}
          />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card
            title="Drop-off heatmap (година × день тижня)"
            loading={loading}
            extra={
              <Text type="secondary">
                % сесій, що стартують у цей час і не завершуються
              </Text>
            }
          >
            {heatmapData.length === 0 ? (
              <Empty description="Нема даних" />
            ) : (
              <Heatmap
                data={heatmapData}
                xField="hour"
                yField="day"
                colorField="dropOff"
                color={[
                  token.colorSuccess,
                  token.colorWarning,
                  token.colorError,
                ]}
                tooltip={{
                  formatter: (datum: {
                    day: string;
                    hour: string;
                    starts: number;
                    completes: number;
                    dropOff: number;
                  }) => ({
                    name: `${datum.day} ${datum.hour}`,
                    value: `${formatPct(datum.dropOff)} drop-off (${datum.completes}/${datum.starts})`,
                  }),
                }}
                meta={{
                  hour: { type: "cat" },
                  day: { type: "cat", values: DAY_LABELS_UA },
                }}
                height={320}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card
            title={
              <Space>
                <ClockCircleOutlined />
                Хто застряг прямо зараз
              </Space>
            }
            loading={loading}
          >
            <ProTable<FunnelResponse["stuck"][number]>
              className="admin-funnel-stuck-table"
              dataSource={data.stuck}
              columns={stuckColumns}
              rowKey="distinctId"
              search={false}
              toolBarRender={false}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              size="small"
              locale={{
                emptyText: (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="Зараз ніхто не висне"
                  />
                ),
              }}
            />
          </Card>
        </Col>
      </Row>

      <Text type="secondary" style={{ fontSize: 12 }}>
        Оновлено {new Date(data.generatedAt).toLocaleString("uk-UA")} ·
        вікно {data.periodDays} днів
      </Text>
    </Space>
  );
}
