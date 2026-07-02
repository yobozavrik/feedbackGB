"use client";

import { CloudUploadOutlined } from "@ant-design/icons";
import {
  Card,
  Space,
  Tooltip,
  Typography,
  theme as antdTheme,
} from "antd";
import Link from "next/link";
import { MetaText } from "@/components/admin/ui/typography";
import { fmtAbs, fmtRel } from "@/lib/timeFormat";

const { Text, Paragraph } = Typography;

interface Props {
  lastManualMirror: { occurred_at: string } | null;
}

export function MirrorCard({ lastManualMirror }: Props) {
  const { token } = antdTheme.useToken();

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <CloudUploadOutlined style={{ color: token.colorPrimary }} />
          <Text strong>Дзеркало в Google Drive</Text>
        </Space>
      }
      extra={
        <Link href="/admin/tools" style={{ fontSize: 12 }}>
          Запустити вручну →
        </Link>
      }
    >
      <Space direction="vertical" size={6} style={{ width: "100%" }}>
        <Paragraph
          type="secondary"
          style={{ fontSize: 12, marginBottom: 0 }}
        >
          Окремого cron-а немає — копіювання запускається{" "}
          <em>автоматично</em> після успішного щоденного звіту.
          Безпечне до повторних викликів (idempotent).
        </Paragraph>
        {lastManualMirror ? (
          <MetaText>
            Останній <em>ручний</em> запуск:{" "}
            <Tooltip title={fmtAbs(lastManualMirror.occurred_at)}>
              <Text>{fmtRel(lastManualMirror.occurred_at)}</Text>
            </Tooltip>
          </MetaText>
        ) : (
          <MetaText>Ручних запусків ще не було.</MetaText>
        )}
      </Space>
    </Card>
  );
}
