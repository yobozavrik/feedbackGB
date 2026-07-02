"use client";

import {
  Alert,
  Drawer,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
  theme as antdTheme,
} from "antd";
import { ItemTitle } from "@/components/admin/ui/typography";
import type { AdminUser } from "@/app/(admin)/admin/users/page";
import type { ActivityLogEntry } from "@/lib/adminUsersApi";

const { Text } = Typography;

interface Props {
  target: AdminUser | null;
  logs: ActivityLogEntry[];
  loading: boolean;
  onClose: () => void;
}

export function ActivityDrawer({ target, logs, loading, onClose }: Props) {
  const { token } = antdTheme.useToken();

  return (
    <Drawer
      title={
        target?.role === "seller"
          ? `Відгуки співробітника: ${target?.full_name}`
          : `Активність адміністратора: ${target?.full_name}`
      }
      placement="right"
      width={480}
      onClose={onClose}
      open={target != null}
      destroyOnClose
    >
      {loading ? (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <Spin size="large" />
        </div>
      ) : logs.length === 0 ? (
        <Alert
          message={target?.role === "seller" ? "Відгуки відсутні" : "Активність відсутня"}
          description={
            target?.role === "seller"
              ? "Цей співробітник ще не надсилав відгуків."
              : "За цим користувачем не зафіксовано жодних дій."
          }
          type="info"
          showIcon
        />
      ) : (
        <Timeline
          mode="left"
          items={logs.map((log) => {
            const dateStr = new Date(log.occurred_at).toLocaleString("uk-UA");

            if (log.isFeedback) {
              let statusColor = "blue";
              let statusText = "Новий";
              if (log.status === "in_progress") {
                statusColor = "orange";
                statusText = "В роботі";
              } else if (log.status === "resolved") {
                statusColor = "green";
                statusText = "Вирішено";
              } else if (log.status === "rejected") {
                statusColor = "red";
                statusText = "Відхилено";
              }

              return {
                label: dateStr,
                children: (
                  <div style={{ paddingBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                      <ItemTitle>
                        {log.category_emoji || "📝"} {log.category_title || log.category}
                      </ItemTitle>
                      <Tag color={statusColor} style={{ fontSize: 10, margin: 0, paddingInline: 4 }}>
                        {statusText}
                      </Tag>
                    </div>
                    <div style={{ marginBlock: 4 }}>
                      <Text style={{ fontSize: 12 }}>{log.summary}</Text>
                    </div>
                    {log.store_name && (
                      <div style={{ fontSize: 11, color: token.colorTextDescription }}>
                        Магазин: {log.store_name}
                      </div>
                    )}
                  </div>
                ),
              };
            }

            const hasMeta = log.meta && Object.keys(log.meta).length > 0;
            const hasDiff = log.diff && Object.keys(log.diff).length > 0;

            return {
              label: dateStr,
              children: (
                <>
                  <div style={{ fontWeight: "bold" }}>{log.action_title}</div>
                  {log.ip && (
                    <div style={{ fontSize: 11, color: token.colorTextTertiary }}>
                      IP: {log.ip} {log.user_agent ? `| ${log.user_agent.slice(0, 40)}...` : ""}
                    </div>
                  )}
                  {hasMeta && (
                    <div style={{ marginTop: 4, background: token.colorFillAlter, padding: "4px 8px", borderRadius: token.borderRadiusSM, fontSize: 11 }}>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(log.meta, null, 2)}
                      </pre>
                    </div>
                  )}
                  {hasDiff && (
                    <div style={{ marginTop: 4, background: token.colorWarningBg, padding: "4px 8px", borderRadius: token.borderRadiusSM, fontSize: 11, border: `1px solid ${token.colorWarningBorder}` }}>
                      <div style={{ fontWeight: "bold", color: token.colorWarningText, marginBottom: 2 }}>Зміни:</div>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(log.diff, null, 2)}
                      </pre>
                    </div>
                  )}
                </>
              ),
            };
          })}
        />
      )}
    </Drawer>
  );
}
