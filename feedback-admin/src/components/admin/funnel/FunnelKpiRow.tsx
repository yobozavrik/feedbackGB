"use client";

import { WarningOutlined } from "@ant-design/icons";
import { StatisticCard } from "@ant-design/pro-components";
import { Col, Row, theme as antdTheme } from "antd";
import type { FunnelTotals } from "@/lib/funnelCharts";

export function FunnelKpiRow({ totals }: { totals: FunnelTotals }) {
  const { token } = antdTheme.useToken();
  const { startCount, finishCount, overallConv, totalDropOff } = totals;

  return (
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
  );
}
