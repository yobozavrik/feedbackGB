"use client";

import { Bar } from "@ant-design/plots";
import { Card, Empty, theme as antdTheme } from "antd";
import { MetaText } from "@/components/admin/ui/typography";
import type { DropOffBar } from "@/lib/funnelCharts";

export function DropOffBarCard({
  bars,
  loading,
}: {
  bars: DropOffBar[];
  loading: boolean;
}) {
  const { token } = antdTheme.useToken();

  return (
    <Card
      title="Drop-off на кожному кроці"
      loading={loading}
      extra={
        <MetaText>
          % користувачів, які дійшли до попереднього кроку, але далі не пішли
        </MetaText>
      }
    >
      {bars.length === 0 ? (
        <Empty description="Нема даних" />
      ) : (
        <Bar
          data={bars}
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
          height={Math.max(220, bars.length * 48)}
        />
      )}
    </Card>
  );
}
