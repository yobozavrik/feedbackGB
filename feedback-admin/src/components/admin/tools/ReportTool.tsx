"use client";

import { SendOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Popconfirm,
  Space,
  Typography,
  theme as antdTheme,
} from "antd";
import { useCallback, useState } from "react";
import { sendReportNow } from "@/lib/adminToolsApi";
import { track } from "@/lib/analytics";

const { Text, Paragraph } = Typography;

type ToolStatus = "idle" | "sending" | "ok" | "error";

export function ReportTool() {
  const { token } = antdTheme.useToken();
  const { message } = App.useApp();
  const [status, setStatus] = useState<ToolStatus>("idle");
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleSend = useCallback(async () => {
    track("admin_send_report_click");
    setStatus("sending");
    setLastResult(null);
    try {
      const result = await sendReportNow();
      if (!result.ok) {
        setStatus("error");
        setLastResult(result.error);
        message.error(result.error);
        return;
      }
      setStatus("ok");
      const text =
        typeof result.total === "number"
          ? `Надіслано · ${result.total} рядків`
          : "Надіслано";
      setLastResult(text);
      message.success(text);
    } catch (e) {
      setStatus("error");
      const text = e instanceof Error ? e.message : "Помилка мережі";
      setLastResult(text);
      message.error(text);
    }
  }, [message]);

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <SendOutlined style={{ color: token.colorPrimary }} />
          <Text strong>Надіслати звіт у Telegram</Text>
        </Space>
      }
      styles={{ body: { padding: 16 } }}
    >
      <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>
        Зібрати всі сьогоднішні фідбеки і надіслати у групу зараз — не
        чекаючи 21:30. Це той самий ендпоінт, що працює щодня по cron.
      </Paragraph>
      <Space wrap>
        <Popconfirm
          title="Надіслати щоденний звіт у Telegram?"
          description="Звіт піде у групу негайно з усіма сьогоднішніми фідбеками."
          okText="Надіслати"
          cancelText="Скасувати"
          onConfirm={handleSend}
        >
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={status === "sending"}
          >
            Надіслати зараз
          </Button>
        </Popconfirm>
        {lastResult ? (
          <Text
            type={status === "error" ? "danger" : "secondary"}
            style={{ fontSize: 12 }}
          >
            {lastResult}
          </Text>
        ) : null}
      </Space>
    </Card>
  );
}
