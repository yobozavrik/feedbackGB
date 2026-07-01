"use client";

import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  AppstoreOutlined,
  AuditOutlined,
  ClockCircleOutlined,
  ShopOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { StatisticCard } from "@ant-design/pro-components";
import { Tag, Typography, theme as antdTheme } from "antd";
import { useMemo } from "react";
import { HOUR_MS, OVERDUE_HOURS, ageMs, formatAge, isOpen } from "@/lib/sla";

const { Text } = Typography;

export interface DashboardRow {
  created_at: string;
  category: string;
  category_title: string | null;
  store_name: string | null;
  status: string | null;
}

interface Props {
  rows: DashboardRow[];
}

const DAY = 24 * 60 * 60 * 1000;

function countSince(rows: DashboardRow[], cutoff: number): number {
  return rows.reduce(
    (acc, r) =>
      new Date(r.created_at).getTime() >= cutoff ? acc + 1 : acc,
    0,
  );
}

function delta(curr: number, prev: number): {
  pct: number;
  direction: "up" | "down" | "flat";
} {
  if (prev === 0 && curr === 0) return { pct: 0, direction: "flat" };
  if (prev === 0) return { pct: 100, direction: "up" };
  const diff = ((curr - prev) / prev) * 100;
  if (Math.abs(diff) < 1) return { pct: 0, direction: "flat" };
  return {
    pct: Math.round(diff),
    direction: diff > 0 ? "up" : "down",
  };
}

export function DashboardKPI({ rows }: Props) {
  const { token } = antdTheme.useToken();

  const stats = useMemo(() => {
    const now = Date.now();
    const weekAgo = now - 7 * DAY;
    const twoWeeksAgo = now - 14 * DAY;

    const thisWeek = rows.filter(
      (r) => new Date(r.created_at).getTime() >= weekAgo,
    );
    const lastWeek = rows.filter((r) => {
      const t = new Date(r.created_at).getTime();
      return t >= twoWeeksAgo && t < weekAgo;
    });

    const totalThisWeek = thisWeek.length;
    const totalLastWeek = lastWeek.length;
    const totalDelta = delta(totalThisWeek, totalLastWeek);

    const defectsThisWeek = thisWeek.filter((r) => r.category === "defect").length;
    const defectsLastWeek = lastWeek.filter((r) => r.category === "defect").length;
    const defectsDelta = delta(defectsThisWeek, defectsLastWeek);

    const todayCount = countSince(rows, now - DAY);

    // SLA: open rows older than the overdue threshold. We don't compute it
    // off `thisWeek` because a fidbek that's been "new" for 3 days is older
    // than 7 — but it absolutely belongs in this card.
    let overdueCount = 0;
    let oldestOpenMs = 0;
    for (const r of rows) {
      if (!isOpen(r.status)) continue;
      const a = ageMs(r.created_at, now);
      if (a >= OVERDUE_HOURS * HOUR_MS) overdueCount += 1;
      if (a > oldestOpenMs) oldestOpenMs = a;
    }

    const storesThisWeek = new Set(
      thisWeek
        .map((r) => r.store_name)
        .filter((x): x is string => Boolean(x)),
    ).size;
    const storesLastWeek = new Set(
      lastWeek
        .map((r) => r.store_name)
        .filter((x): x is string => Boolean(x)),
    ).size;

    const categoryCounts = new Map<string, { count: number; title: string }>();
    for (const r of thisWeek) {
      const key = r.category;
      const cur = categoryCounts.get(key) ?? {
        count: 0,
        title: r.category_title ?? r.category,
      };
      cur.count += 1;
      categoryCounts.set(key, cur);
    }
    const topCategory = Array.from(categoryCounts.entries()).sort(
      (a, b) => b[1].count - a[1].count,
    )[0];

    return {
      totalThisWeek,
      totalDelta,
      defectsThisWeek,
      defectsDelta,
      todayCount,
      overdueCount,
      oldestOpenMs,
      storesThisWeek,
      storesLastWeek,
      topCategory: topCategory
        ? { title: topCategory[1].title, count: topCategory[1].count }
        : null,
    };
  }, [rows]);

  const trendNode = (
    d: { pct: number; direction: "up" | "down" | "flat" },
    invertColors = false,
  ) => {
    if (d.direction === "flat") {
      return (
        <Text type="secondary" style={{ fontSize: 12 }}>
          без змін
        </Text>
      );
    }
    const goodIsUp = !invertColors;
    const isGood = d.direction === "up" ? goodIsUp : !goodIsUp;
    const color = isGood ? token.colorSuccess : token.colorError;
    return (
      <Text style={{ color, fontSize: 12, fontWeight: 500 }}>
        {d.direction === "up" ? <ArrowUpOutlined /> : <ArrowDownOutlined />}{" "}
        {Math.abs(d.pct)}% vs минулий тиждень
      </Text>
    );
  };

  const overdueColor =
    stats.overdueCount > 0 ? token.colorError : token.colorSuccess;
  const overdueDescription =
    stats.overdueCount > 0 ? (
      <Text style={{ color: token.colorError, fontSize: 12, fontWeight: 500 }}>
        найстаріший відкритий: {formatAge(stats.oldestOpenMs)}
      </Text>
    ) : (
      <Text type="secondary" style={{ fontSize: 12 }}>
        усе під контролем
      </Text>
    );

  return (
    <StatisticCard.Group
      className="admin-kpi-grid"
      direction="row"
      style={{ marginBottom: 16 }}
      colSpan={{ xs: 24, sm: 12, md: 12, lg: 6, xl: 6 }}
    >
      <StatisticCard
        statistic={{
          title: `Прострочено (>${OVERDUE_HOURS} год)`,
          value: stats.overdueCount,
          valueStyle: { color: overdueColor },
          icon: (
            <ClockCircleOutlined
              style={{ color: overdueColor, fontSize: 22 }}
            />
          ),
          description: overdueDescription,
          suffix: stats.overdueCount === 1 ? "запис" : "записів",
        }}
      />
      <StatisticCard
        statistic={{
          title: "За тиждень",
          value: stats.totalThisWeek,
          icon: (
            <AppstoreOutlined
              style={{ color: token.colorPrimary, fontSize: 22 }}
            />
          ),
          description: trendNode(stats.totalDelta),
          suffix: "фідбеків",
        }}
      />
      <StatisticCard
        statistic={{
          title: "Дефекти за тиждень",
          value: stats.defectsThisWeek,
          icon: (
            <WarningOutlined
              style={{ color: token.colorWarning, fontSize: 22 }}
            />
          ),
          description: trendNode(stats.defectsDelta, true),
          suffix: stats.defectsThisWeek === 1 ? "запис" : "записів",
        }}
      />
      <StatisticCard
        statistic={{
          title: "Активних магазинів",
          value: stats.storesThisWeek,
          icon: (
            <ShopOutlined style={{ color: token.colorInfo, fontSize: 22 }} />
          ),
          description: (
            <Text type="secondary" style={{ fontSize: 12 }}>
              минулий тиждень: {stats.storesLastWeek}
            </Text>
          ),
          suffix: "точок",
        }}
      />
      <StatisticCard
        statistic={{
          title: "Сьогодні",
          value: stats.todayCount,
          icon: (
            <AuditOutlined
              style={{ color: token.colorSuccess, fontSize: 22 }}
            />
          ),
          description: stats.topCategory ? (
            <Text style={{ fontSize: 12 }}>
              топ-категорія:{" "}
              <Tag color="magenta" bordered={false} style={{ marginInlineEnd: 0 }}>
                {stats.topCategory.title} · {stats.topCategory.count}
              </Tag>
            </Text>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              ще нема даних
            </Text>
          ),
          suffix: stats.todayCount === 1 ? "запис" : "записів",
        }}
      />
    </StatisticCard.Group>
  );
}
