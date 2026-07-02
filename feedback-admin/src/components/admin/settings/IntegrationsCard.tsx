"use client";

import {
  CheckCircleFilled,
  MinusCircleFilled,
  TeamOutlined,
} from "@ant-design/icons";
import {
  Card,
  Space,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import type { IntegrationStatus } from "@/app/(admin)/admin/settings/page";

const { Text, Paragraph } = Typography;

interface Props {
  integrations: IntegrationStatus[];
}

export function IntegrationsCard({ integrations }: Props) {
  const { token } = antdTheme.useToken();

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <TeamOutlined style={{ color: token.colorPrimary }} />
          <Text strong>Інтеграції</Text>
        </Space>
      }
    >
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        {integrations.map((it) => (
          <div
            key={it.key}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "6px 0",
            }}
          >
            {it.set ? (
              <CheckCircleFilled
                style={{ color: token.colorSuccess, fontSize: 16 }}
              />
            ) : (
              <MinusCircleFilled
                style={{ color: token.colorTextTertiary, fontSize: 16 }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text strong style={{ fontSize: 13 }}>
                {it.label}
              </Text>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {it.description}
                </Text>
              </div>
            </div>
            <Tag
              color={it.set ? "green" : "default"}
              bordered={false}
              style={{ marginInlineEnd: 0 }}
            >
              {it.set ? "ok" : "не задано"}
            </Tag>
          </div>
        ))}
      </Space>
      <Paragraph
        type="secondary"
        style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
      >
        Значення секретів не відображаються — лише чи задано змінну в
        оточенні. Редагувати їх можна тільки в Vercel Dashboard.
      </Paragraph>
    </Card>
  );
}
