"use client";

import { ClockCircleOutlined, SendOutlined } from "@ant-design/icons";
import {
  Alert,
  Card,
  Space,
  Tooltip,
  Typography,
  theme as antdTheme,
} from "antd";
import Link from "next/link";
import { MetaText } from "@/components/admin/ui/typography";
import { describeCronUtc } from "@/lib/cronSchedule";
import { fmtAbs, fmtRel } from "@/lib/timeFormat";
import type { CronEntry } from "@/app/(admin)/admin/settings/page";

const { Text, Paragraph } = Typography;

interface Props {
  crons: CronEntry[];
  lastManualReport: { occurred_at: string } | null;
}

export function DailyReportCard({ crons, lastManualReport }: Props) {
  const { token } = antdTheme.useToken();
  const reportCrons = crons.filter(
    (c) => c.path === "/api/cron/daily-report",
  );

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <SendOutlined style={{ color: token.colorPrimary }} />
          <Text strong>Щоденний звіт у Telegram</Text>
        </Space>
      }
      extra={
        <Link href="/admin/tools" style={{ fontSize: 12 }}>
          Запустити вручну →
        </Link>
      }
    >
      {reportCrons.length > 0 ? (
        <Space direction="vertical" size={6} style={{ width: "100%" }}>
          <Space size={6}>
            <ClockCircleOutlined
              style={{ color: token.colorTextTertiary }}
            />
            <MetaText>
              {reportCrons.map((c) => describeCronUtc(c.schedule)).join(" · ")}
            </MetaText>
          </Space>
          <Paragraph
            type="secondary"
            style={{ fontSize: 12, marginBottom: 0 }}
          >
            Vercel Cron двічі викликає ендпоінт (для EET і EEST), а
            сервер сам пропускає невідповідну DST-фазу. У production
            cron захищений <code>CRON_SECRET</code>.
          </Paragraph>
          {lastManualReport ? (
            <MetaText>
              Останній{" "}
              <em>ручний</em>
              {" "}
              запуск:{" "}
              <Tooltip title={fmtAbs(lastManualReport.occurred_at)}>
                <Text>{fmtRel(lastManualReport.occurred_at)}</Text>
              </Tooltip>
            </MetaText>
          ) : (
            <MetaText>Ручних запусків ще не було.</MetaText>
          )}
        </Space>
      ) : (
        <Alert
          type="warning"
          showIcon
          message="Cron у vercel.json не знайдено"
          description="Перевір файл vercel.json — без нього щоденний звіт не запуститься автоматично."
        />
      )}
    </Card>
  );
}
