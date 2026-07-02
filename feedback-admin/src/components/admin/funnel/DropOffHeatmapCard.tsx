"use client";

import { Heatmap } from "@ant-design/plots";
import { Card, Empty, theme as antdTheme } from "antd";
import { MetaText } from "@/components/admin/ui/typography";
import {
  DAY_LABELS_UA,
  formatPct,
  type HeatmapCell,
} from "@/lib/funnelCharts";

export function DropOffHeatmapCard({
  cells,
  loading,
}: {
  cells: HeatmapCell[];
  loading: boolean;
}) {
  const { token } = antdTheme.useToken();

  return (
    <Card
      title="Drop-off heatmap (година × день тижня)"
      loading={loading}
      extra={
        <MetaText>% сесій, що стартують у цей час і не завершуються</MetaText>
      }
    >
      {cells.length === 0 ? (
        <Empty description="Нема даних" />
      ) : (
        <Heatmap
          data={cells}
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
  );
}
