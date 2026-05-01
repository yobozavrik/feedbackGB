"use client";

import { Card, Space, Tooltip, Typography, theme as antdTheme } from "antd";
import { useMemo } from "react";
import type { DashboardRow } from "./DashboardKPI";

const { Text } = Typography;

interface Props {
  rows: DashboardRow[];
  /** How many days of data to include (default 14). */
  days?: number;
}

const DAYS_UK = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

/**
 * Hour-of-day × day-of-week heatmap of feedback activity over the last N days.
 * Each cell shows count of feedbacks created at that hour of that weekday;
 * cell opacity scales linearly with count vs the max.
 */
export function DashboardHeatmap({ rows, days = 14 }: Props) {
  const { token } = antdTheme.useToken();

  const { grid, max, total } = useMemo(() => {
    // grid[dayIdx][hour] where dayIdx=0..6 (Mon..Sun)
    const g: number[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => 0),
    );
    let m = 0;
    let tot = 0;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    for (const r of rows) {
      const t = new Date(r.created_at);
      if (t.getTime() < cutoff) continue;
      // JS getDay: 0=Sun, 1=Mon..6=Sat. Remap to 0=Mon..6=Sun.
      const jsDay = t.getDay();
      const dayIdx = (jsDay + 6) % 7;
      const hour = t.getHours();
      g[dayIdx][hour] += 1;
      tot += 1;
      if (g[dayIdx][hour] > m) m = g[dayIdx][hour];
    }
    return { grid: g, max: m, total: tot };
  }, [rows, days]);

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <Text strong>Активність по годинах</Text>
          <Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>
            останні {days} днів · {total} подій
          </Text>
        </Space>
      }
      style={{ marginBottom: 16 }}
      styles={{ body: { padding: "12px 16px" } }}
    >
      {total === 0 ? (
        <Text type="secondary" style={{ fontSize: 13 }}>
          Поки що немає подій у вибраному періоді.
        </Text>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              borderCollapse: "separate",
              borderSpacing: 2,
              fontSize: 11,
              minWidth: 640,
            }}
          >
            <thead>
              <tr>
                <th />
                {HOURS.map((h) => (
                  <th
                    key={h}
                    style={{
                      width: 22,
                      color: token.colorTextTertiary,
                      fontWeight: 400,
                      textAlign: "center",
                      paddingBottom: 4,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {h % 3 === 0 ? h.toString().padStart(2, "0") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS_UK.map((dayLabel, dayIdx) => (
                <tr key={dayLabel}>
                  <td
                    style={{
                      color: token.colorTextSecondary,
                      paddingRight: 8,
                      textAlign: "right",
                      fontWeight: 500,
                    }}
                  >
                    {dayLabel}
                  </td>
                  {HOURS.map((h) => {
                    const count = grid[dayIdx][h];
                    const ratio = max === 0 ? 0 : count / max;
                    const bg =
                      count === 0
                        ? token.colorFillTertiary
                        : `color-mix(in srgb, ${token.colorPrimary} ${Math.max(
                            12,
                            Math.round(ratio * 100),
                          )}%, transparent)`;
                    const cell = (
                      <td
                        key={h}
                        style={{
                          width: 22,
                          height: 22,
                          background: bg,
                          borderRadius: 4,
                          cursor: count > 0 ? "default" : "default",
                        }}
                      />
                    );
                    if (count === 0) return cell;
                    return (
                      <Tooltip
                        key={h}
                        title={`${dayLabel} ${h.toString().padStart(2, "0")}:00 — ${count} ${
                          count === 1 ? "фідбек" : "фідбеків"
                        }`}
                      >
                        {cell}
                      </Tooltip>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginTop: 12,
              fontSize: 11,
              color: token.colorTextTertiary,
            }}
          >
            <span>менше</span>
            {[0, 0.25, 0.5, 0.75, 1].map((r) => (
              <span
                key={r}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 3,
                  background:
                    r === 0
                      ? token.colorFillTertiary
                      : `color-mix(in srgb, ${token.colorPrimary} ${Math.round(r * 100)}%, transparent)`,
                }}
              />
            ))}
            <span>більше</span>
            <span style={{ marginLeft: 16 }}>пік: {max}</span>
          </div>
        </div>
      )}
    </Card>
  );
}
