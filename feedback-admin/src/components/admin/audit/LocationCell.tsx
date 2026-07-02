"use client";

import { Space, Tooltip, Typography } from "antd";
import { readGeo } from "@/lib/auditFormat";
import { countryFlag, formatGeoLines } from "@/lib/geoip";
import type { AuditRow } from "@/app/(admin)/admin/audit/page";

const { Text } = Typography;

/** "Звідки" cell: flag + city/country line with ISP/ASN (or bare IP) below. */
export function LocationCell({ row }: { row: AuditRow }) {
  const geo = readGeo(row.meta);
  if (!row.ip && !geo) {
    return <Text type="secondary">—</Text>;
  }
  const flag = countryFlag(geo?.country ?? undefined);
  const { cityCountry, ispAsn } = formatGeoLines(geo);
  const secondary = ispAsn || row.ip;
  return (
    <Space direction="vertical" size={2} style={{ lineHeight: 1.2 }}>
      <Space size={6} wrap>
        {flag ? <span style={{ fontSize: 14 }}>{flag}</span> : null}
        {cityCountry ? (
          <Text style={{ fontSize: 12 }}>{cityCountry}</Text>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            —
          </Text>
        )}
      </Space>
      {secondary ? (
        <Tooltip title={row.ip ? `IP: ${row.ip}` : undefined}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {secondary}
          </Text>
        </Tooltip>
      ) : null}
    </Space>
  );
}
