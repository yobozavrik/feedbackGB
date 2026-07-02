"use client";

import { CloudUploadOutlined } from "@ant-design/icons";
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
import { mirrorToDriveNow } from "@/lib/adminToolsApi";
import { track } from "@/lib/analytics";

const { Text, Paragraph } = Typography;

type ToolStatus = "idle" | "sending" | "ok" | "error";

export function MirrorTool() {
  const { token } = antdTheme.useToken();
  const { message } = App.useApp();
  const [status, setStatus] = useState<ToolStatus>("idle");
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleMirror = useCallback(async () => {
    track("admin_mirror_drive_click");
    setStatus("sending");
    setLastResult(null);
    try {
      const result = await mirrorToDriveNow();
      if (!result.ok) {
        setStatus("error");
        setLastResult(result.error);
        message.error(result.error);
        return;
      }
      setStatus("ok");
      const { mirrored: m, failed: f } = result;
      const text =
        f > 0
          ? `Скопійовано ${m}, помилок ${f}`
          : `Скопійовано ${m}`;
      setLastResult(text);
      if (f > 0) {
        message.warning(text);
      } else {
        message.success(text);
      }
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
          <CloudUploadOutlined style={{ color: token.colorPrimary }} />
          <Text strong>Дзеркало фото у Drive</Text>
        </Space>
      }
      styles={{ body: { padding: 16 } }}
    >
      <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 12 }}>
        Скопіювати нові фото з Supabase у папку Google Drive — резервна
        копія. Той самий ендпоінт, що cron запускає вночі.
      </Paragraph>
      <Space wrap>
        <Popconfirm
          title="Скопіювати нові фото у Google Drive зараз?"
          description="Фото, яких ще нема у Drive, будуть скопійовані."
          okText="Запустити"
          cancelText="Скасувати"
          onConfirm={handleMirror}
        >
          <Button
            type="primary"
            icon={<CloudUploadOutlined />}
            loading={status === "sending"}
          >
            Запустити дзеркало
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
