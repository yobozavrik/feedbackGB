"use client";

import {
  Alert,
  Card,
  Space,
  Table,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import type { InteractionStats } from "@/lib/interactionStats";

const { Text } = Typography;

export function TopElementsCard({ stats }: { stats: InteractionStats }) {
  const { token } = antdTheme.useToken();

  return (
    <Card title="Популярні елементи для натискання" bordered={false} className="shadow-soft">
      {stats.total === 0 ? (
        <Alert
          message="Немає даних"
          description="За вказаними фільтрами не знайдено зафіксованих кліків."
          type="info"
          showIcon
        />
      ) : (
        <Table
          dataSource={stats.topElements.map((item, idx) => ({ ...item, key: idx }))}
          pagination={false}
          size="small"
          columns={[
            {
              title: "Елемент",
              dataIndex: "text",
              render: (text, row) => (
                <Space>
                  <Tag color="cyan">{row.tag}</Tag>
                  <Text strong>{text}</Text>
                </Space>
              ),
            },
            {
              title: "Кількість натискань",
              dataIndex: "count",
              align: "right",
              width: 180,
              render: (count) => (
                <Text strong style={{ color: token.colorPrimary }}>
                  {count}
                </Text>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}
