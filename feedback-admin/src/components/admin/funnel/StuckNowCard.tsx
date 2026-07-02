"use client";

import { ClockCircleOutlined } from "@ant-design/icons";
import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Card, Empty, Space, Tag } from "antd";
import { formatHoursAgo } from "@/lib/funnelCharts";
import type { FunnelResponse } from "@/lib/posthog/types";

type StuckRow = FunnelResponse["stuck"][number];

const columns: ProColumns<StuckRow>[] = [
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

export function StuckNowCard({
  stuck,
  loading,
}: {
  stuck: StuckRow[];
  loading: boolean;
}) {
  return (
    <Card
      title={
        <Space>
          <ClockCircleOutlined />
          Хто застряг прямо зараз
        </Space>
      }
      loading={loading}
    >
      <ProTable<StuckRow>
        className="admin-funnel-stuck-table"
        dataSource={stuck}
        columns={columns}
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
  );
}
