"use client";

import {
  CheckCircleFilled,
  ClockCircleOutlined,
  CloudUploadOutlined,
  KeyOutlined,
  MinusCircleFilled,
  SendOutlined,
  ShopOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  ModalForm,
  ProDescriptions,
  ProFormText,
} from "@ant-design/pro-components";
import {
  App,
  Alert,
  Button,
  Card,
  Col,
  Row,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
} from "antd";
import Link from "next/link";
import { useCallback, useState } from "react";
import type { CronEntry, SettingsData } from "./page";

const { Text, Paragraph } = Typography;

const PIN_RE = /^\d{6,8}$/;

function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "щойно";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "щойно";
  if (m < 60) return `${m} хв тому`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} год тому`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} дн тому`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} міс тому`;
  return `${Math.floor(mo / 12)} р тому`;
}

function fmtAbs(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("uk-UA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Перетворити cron-вираз UTC на людський опис у Києві (EET=UTC+2, EEST=UTC+3).
 * Підтримує лише формат "M H * * *" (щодня) — рідші не очікуємо.
 */
function describeCronUtc(expr: string): string {
  const parts = expr.split(" ").filter(Boolean);
  if (parts.length !== 5) return expr;
  const [m, h, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*" || dow !== "*") return expr;
  const minute = parseInt(m, 10);
  const hour = parseInt(h, 10);
  if (Number.isNaN(minute) || Number.isNaN(hour)) return expr;
  const utc = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} UTC`;
  const kyivWinter = (hour + 2) % 24;
  const kyivSummer = (hour + 3) % 24;
  const fmt = (h2: number) =>
    `${String(h2).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  if (kyivWinter === kyivSummer) {
    return `щодня ${fmt(kyivWinter)} (Київ) · ${utc}`;
  }
  return `щодня ${fmt(kyivWinter)}–${fmt(kyivSummer)} (Київ, DST-safe) · ${utc}`;
}

interface Props {
  data: SettingsData;
}

export function SettingsClient({ data }: Props) {
  const { token } = antdTheme.useToken();
  const { message } = App.useApp();
  const [hasPin, setHasPin] = useState(data.profile.has_pin);
  const [pinModalOpen, setPinModalOpen] = useState(false);

  const handleSavePin = useCallback(
    async (values: { pin: string; confirm: string }) => {
      if (values.pin !== values.confirm) {
        message.error("Підтвердження не співпадає.");
        return false;
      }
      if (!PIN_RE.test(values.pin)) {
        message.error("PIN має бути 6–8 цифр.");
        return false;
      }
      const res = await fetch(
        `/api/admin/users/${data.profile.uid}/pin`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pin: values.pin }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        message.error(body.error ?? "Помилка сервера");
        return false;
      }
      setHasPin(true);
      message.success(hasPin ? "PIN оновлено" : "PIN встановлено");
      return true;
    },
    [data.profile.uid, hasPin, message],
  );

  const dailyReportCron: CronEntry | null =
    data.crons.find((c) => c.path === "/api/cron/daily-report") ?? null;

  return (
    <Row gutter={[16, 16]}>
      {/* === ПРОФІЛЬ === */}
      <Col xs={24} lg={12}>
        <Card
          size="small"
          title={
            <Space size={8}>
              <UserOutlined style={{ color: token.colorPrimary }} />
              <Text strong>Профіль</Text>
            </Space>
          }
        >
          <ProDescriptions<SettingsData["profile"]>
            column={1}
            size="small"
            colon
            dataSource={data.profile}
            columns={[
              {
                title: "Імʼя",
                dataIndex: "full_name",
                render: (_, row) => row.full_name,
              },
              {
                title: "Роль",
                dataIndex: "role",
                render: (_, row) => (
                  <Tag
                    color={row.role === "admin" ? "magenta" : "default"}
                    bordered={false}
                  >
                    {row.role === "admin" ? "Адмін" : "Продавчиня"}
                  </Tag>
                ),
              },
              {
                title: "Магазин",
                dataIndex: "store_name",
                render: (_, row) => {
                  if (row.store_id == null)
                    return <Text type="secondary">не привʼязано</Text>;
                  return (
                    <Space size={6}>
                      <ShopOutlined
                        style={{ color: token.colorTextTertiary }}
                      />
                      <Text>{row.store_name ?? `#${row.store_id}`}</Text>
                    </Space>
                  );
                },
              },
              {
                title: "PIN-код",
                dataIndex: "has_pin",
                render: () =>
                  hasPin ? (
                    <Tag color="green" bordered={false}>
                      встановлено
                    </Tag>
                  ) : (
                    <Tag color="orange" bordered={false}>
                      не встановлено
                    </Tag>
                  ),
              },
              {
                title: "Останній вхід",
                dataIndex: "last_login",
                render: (_, row) =>
                  row.last_login ? (
                    <Tooltip title={fmtAbs(row.last_login)}>
                      <Text type="secondary">{fmtRel(row.last_login)}</Text>
                    </Tooltip>
                  ) : (
                    <Text type="secondary">—</Text>
                  ),
              },
            ]}
          />
          <div style={{ marginTop: 12 }}>
            <Button
              type="primary"
              icon={<KeyOutlined />}
              onClick={() => setPinModalOpen(true)}
            >
              {hasPin ? "Змінити PIN" : "Встановити PIN"}
            </Button>
          </div>
          <Paragraph
            type="secondary"
            style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}
          >
            PIN — 6–8 цифр. При зміні автоматично скидається лічильник
            невдалих спроб і знімається lock. Подія потрапляє в{" "}
            <Link href="/admin/audit">Журнал</Link>.
          </Paragraph>
        </Card>
      </Col>

      {/* === ІНТЕГРАЦІЇ === */}
      <Col xs={24} lg={12}>
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
            {data.integrations.map((it) => (
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
      </Col>

      {/* === CRON: ЩОДЕННИЙ ЗВІТ === */}
      <Col xs={24} lg={12}>
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
          {dailyReportCron ? (
            <Space direction="vertical" size={6} style={{ width: "100%" }}>
              <Space size={6}>
                <ClockCircleOutlined
                  style={{ color: token.colorTextTertiary }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {data.crons
                    .filter((c) => c.path === "/api/cron/daily-report")
                    .map((c) => describeCronUtc(c.schedule))
                    .join(" · ")}
                </Text>
              </Space>
              <Paragraph
                type="secondary"
                style={{ fontSize: 12, marginBottom: 0 }}
              >
                Vercel Cron двічі викликає ендпоінт (для EET і EEST), а
                сервер сам пропускає невідповідну DST-фазу. У production
                cron захищений <code>CRON_SECRET</code>.
              </Paragraph>
              {data.lastManualReport ? (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Останній{" "}
                  <em>ручний</em>
                  {" "}
                  запуск:{" "}
                  <Tooltip title={fmtAbs(data.lastManualReport.occurred_at)}>
                    <Text>{fmtRel(data.lastManualReport.occurred_at)}</Text>
                  </Tooltip>
                </Text>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Ручних запусків ще не було.
                </Text>
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
      </Col>

      {/* === MIRROR === */}
      <Col xs={24} lg={12}>
        <Card
          size="small"
          title={
            <Space size={8}>
              <CloudUploadOutlined
                style={{ color: token.colorPrimary }}
              />
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
            {data.lastManualMirror ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Останній <em>ручний</em> запуск:{" "}
                <Tooltip title={fmtAbs(data.lastManualMirror.occurred_at)}>
                  <Text>{fmtRel(data.lastManualMirror.occurred_at)}</Text>
                </Tooltip>
              </Text>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                Ручних запусків ще не було.
              </Text>
            )}
          </Space>
        </Card>
      </Col>

      <ModalForm<{ pin: string; confirm: string }>
        title={hasPin ? "Змінити PIN" : "Встановити PIN"}
        open={pinModalOpen}
        onOpenChange={setPinModalOpen}
        modalProps={{
          destroyOnClose: true,
          okText: "Зберегти",
          cancelText: "Скасувати",
        }}
        onFinish={handleSavePin}
        layout="vertical"
        width={420}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="PIN — 6–8 цифр. Він автоматично хешується bcrypt-ом і ніколи не зберігається у відкритому вигляді."
        />
        <ProFormText.Password
          name="pin"
          label="Новий PIN"
          placeholder="6–8 цифр"
          fieldProps={{ inputMode: "numeric", maxLength: 8 }}
          rules={[
            { required: true, message: "Введіть PIN" },
            {
              pattern: PIN_RE,
              message: "PIN має бути 6–8 цифр",
            },
          ]}
        />
        <ProFormText.Password
          name="confirm"
          label="Підтвердити PIN"
          placeholder="Повторіть"
          fieldProps={{ inputMode: "numeric", maxLength: 8 }}
          rules={[
            { required: true, message: "Підтвердіть PIN" },
            {
              pattern: PIN_RE,
              message: "PIN має бути 6–8 цифр",
            },
          ]}
        />
      </ModalForm>
    </Row>
  );
}
