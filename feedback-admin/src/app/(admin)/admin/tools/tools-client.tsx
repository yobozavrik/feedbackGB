"use client";

import {
  CloudUploadOutlined,
  DownloadOutlined,
  FileTextOutlined,
  SendOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Popconfirm,
  Row,
  Col,
  Space,
  Typography,
  theme as antdTheme,
} from "antd";
import { useCallback, useState } from "react";
import { track } from "@/lib/analytics";

const { Text, Paragraph } = Typography;

type ToolStatus = "idle" | "sending" | "ok" | "error";

export function ToolsClient() {
  const { token } = antdTheme.useToken();

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={12}>
        <ReportTool />
      </Col>
      <Col xs={24} md={12}>
        <MirrorTool />
      </Col>
      <Col xs={24}>
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
      </Col>
    </Row>
  );
}

function ReportTool() {
  const { token } = antdTheme.useToken();
  const { message } = App.useApp();
  const [status, setStatus] = useState<ToolStatus>("idle");
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleSend = useCallback(async () => {
    track("admin_send_report_click");
    setStatus("sending");
    setLastResult(null);
    try {
      const res = await fetch("/api/admin/send-report-now", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        total?: number;
      };
      if (!res.ok) {
        setStatus("error");
        const text = data.error ?? `Помилка ${res.status}`;
        setLastResult(text);
        message.error(text);
        return;
      }
      setStatus("ok");
      const text =
        typeof data.total === "number"
          ? `Надіслано · ${data.total} рядків`
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

function MirrorTool() {
  const { token } = antdTheme.useToken();
  const { message } = App.useApp();
  const [status, setStatus] = useState<ToolStatus>("idle");
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleMirror = useCallback(async () => {
    track("admin_mirror_drive_click");
    setStatus("sending");
    setLastResult(null);
    try {
      const res = await fetch("/api/admin/mirror-to-drive-now", {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        mirrored?: number;
        failed?: number;
        skipped?: number;
      };
      if (!res.ok) {
        setStatus("error");
        const text = data.error ?? `Помилка ${res.status}`;
        setLastResult(text);
        message.error(text);
        return;
      }
      setStatus("ok");
      const m = data.mirrored ?? 0;
      const f = data.failed ?? 0;
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
