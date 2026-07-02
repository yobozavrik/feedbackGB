"use client";

import { DownloadOutlined, FileTextOutlined } from "@ant-design/icons";
import {
  Button,
  Card,
  Space,
  Typography,
  theme as antdTheme,
} from "antd";
import { track } from "@/lib/analytics";

const { Text, Paragraph } = Typography;

export function ExportCard() {
  const { token } = antdTheme.useToken();

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <DownloadOutlined style={{ color: token.colorPrimary }} />
          <Text strong>Експорт фідбеків</Text>
        </Space>
      }
      styles={{ body: { padding: 16 } }}
    >
      <Paragraph
        type="secondary"
        style={{ fontSize: 13, marginBottom: 12 }}
      >
        Завантажити поточну стрічку у вигляді JSON або CSV для роботи в
        Excel / Google Sheets. Фільтрація на сервері відсутня — береться
        повний обсяг.
      </Paragraph>
      <Space wrap>
        <Button
          icon={<FileTextOutlined />}
          href="/api/feedback?format=json"
          onClick={() => track("admin_export_click", { format: "json" })}
        >
          JSON
        </Button>
        <Button
          icon={<FileTextOutlined />}
          href="/api/feedback?format=csv"
          onClick={() => track("admin_export_click", { format: "csv" })}
        >
          CSV
        </Button>
      </Space>
    </Card>
  );
}
