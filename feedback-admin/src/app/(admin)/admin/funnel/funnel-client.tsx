"use client";

import { ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Col,
  Empty,
  Row,
  Segmented,
  Space,
  Typography,
} from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DropOffBarCard } from "@/components/admin/funnel/DropOffBarCard";
import { DropOffHeatmapCard } from "@/components/admin/funnel/DropOffHeatmapCard";
import { FunnelKpiRow } from "@/components/admin/funnel/FunnelKpiRow";
import { FunnelSankeyCard } from "@/components/admin/funnel/FunnelSankeyCard";
import { StuckNowCard } from "@/components/admin/funnel/StuckNowCard";
import { MetaText } from "@/components/admin/ui/typography";
import {
  buildDropOffBars,
  buildHeatmapCells,
  buildSankeyLinks,
  computeFunnelTotals,
} from "@/lib/funnelCharts";
import type { FunnelResponse } from "@/lib/posthog/types";

const { Text } = Typography;

type Period = "7" | "30" | "90";
const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: "7 днів", value: "7" },
  { label: "30 днів", value: "30" },
  { label: "90 днів", value: "90" },
];

interface Props {
  initial: FunnelResponse;
}

export function FunnelClient({ initial }: Props) {
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

  const sankeyLinks = useMemo(() => buildSankeyLinks(data.steps), [data.steps]);
  const dropOffBars = useMemo(() => buildDropOffBars(data.steps), [data.steps]);
  const heatmapCells = useMemo(
    () => buildHeatmapCells(data.heatmap),
    [data.heatmap],
  );
  const totals = useMemo(() => computeFunnelTotals(data.steps), [data.steps]);

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

      <FunnelKpiRow totals={totals} />

      <FunnelSankeyCard links={sankeyLinks} loading={loading} />

      <DropOffBarCard bars={dropOffBars} loading={loading} />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <DropOffHeatmapCard cells={heatmapCells} loading={loading} />
        </Col>
        <Col xs={24} lg={10}>
          <StuckNowCard stuck={data.stuck} loading={loading} />
        </Col>
      </Row>

      <MetaText>
        Оновлено {new Date(data.generatedAt).toLocaleString("uk-UA")} ·
        вікно {data.periodDays} днів
      </MetaText>
    </Space>
  );
}
