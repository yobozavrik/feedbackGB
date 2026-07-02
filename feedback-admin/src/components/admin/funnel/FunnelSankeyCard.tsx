"use client";

import { Sankey } from "@ant-design/plots";
import { Card, Empty } from "antd";
import type { SankeyLink } from "@/lib/funnelCharts";

export function FunnelSankeyCard({
  links,
  loading,
}: {
  links: SankeyLink[];
  loading: boolean;
}) {
  return (
    <Card title="Воронка" loading={loading}>
      {links.length === 0 ? (
        <Empty description="Поки що нема подій у вибраному вікні" />
      ) : (
        <Sankey
          data={links}
          sourceField="source"
          targetField="target"
          weightField="value"
          nodeWidthRatio={0.012}
          nodePaddingRatio={0.04}
          height={420}
        />
      )}
    </Card>
  );
}
