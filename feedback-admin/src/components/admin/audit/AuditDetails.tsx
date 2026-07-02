"use client";

import { Space, Typography, theme as antdTheme } from "antd";
import { MetaText } from "@/components/admin/ui/typography";
import type { AuditRow } from "@/app/(admin)/admin/audit/page";

const { Text, Paragraph } = Typography;

/** Expanded-row body: user-agent line plus pretty-printed meta/diff JSON. */
export function AuditDetails({ row }: { row: AuditRow }) {
  return (
    <Space direction="vertical" size={12} style={{ width: "100%" }}>
      {row.user_agent ? (
        <div>
          <MetaText>User-Agent:</MetaText>{" "}
          <Text style={{ fontSize: 12 }}>{row.user_agent}</Text>
        </div>
      ) : null}
      {row.meta && Object.keys(row.meta).length > 0 ? (
        <JsonBlock label="meta:" value={row.meta} />
      ) : null}
      {row.diff && Object.keys(row.diff).length > 0 ? (
        <JsonBlock label="diff:" value={row.diff} />
      ) : null}
    </Space>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const { token } = antdTheme.useToken();
  return (
    <div>
      <MetaText>{label}</MetaText>
      <Paragraph
        style={{
          margin: 0,
          padding: 12,
          background: token.colorFillTertiary,
          borderRadius: 8,
          fontSize: 12,
          fontFamily: "monospace",
          whiteSpace: "pre-wrap",
        }}
      >
        {JSON.stringify(value, null, 2)}
      </Paragraph>
    </div>
  );
}
