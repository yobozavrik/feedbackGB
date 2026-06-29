"use client";

import React, { useMemo } from "react";
import { Alert, Card, Collapse, Space, Tag, Typography, theme as antdTheme } from "antd";
import {
  AlertOutlined,
  ClockCircleOutlined,
  CopyOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import type { FeedRow } from "@/app/(admin)/admin/page";

const { Text } = Typography;

interface Props {
  rows: FeedRow[];
}

export function DashboardSignals({ rows }: Props) {
  const { token } = antdTheme.useToken();

  const signals = useMemo(() => {
    const now = Date.now();
    const threeDaysAgo = now - 3 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const todayCutoff = now - 24 * 60 * 60 * 1000;

    // 1. Stuck Feedbacks (Status = new, older than 3 days)
    const stuck = rows.filter(
      (r) => r.status === "new" && new Date(r.created_at).getTime() < threeDaysAgo
    );

    // 2. Repeated defects (same product_id in 'defect' category within 7 days on different days/stores)
    const defectsLast7Days = rows.filter(
      (r) =>
        r.category === "defect" &&
        r.product_id != null &&
        new Date(r.created_at).getTime() >= sevenDaysAgo
    );

    const defectMap = new Map<number, FeedRow[]>();
    for (const r of defectsLast7Days) {
      if (r.product_id != null) {
        const list = defectMap.get(r.product_id) ?? [];
        list.push(r);
        defectMap.set(r.product_id, list);
      }
    }

    const repeatedDefects: { productId: number; productName: string; count: number; stores: string[] }[] = [];
    for (const [prodId, list] of defectMap.entries()) {
      if (list.length >= 2) {
        const prodName = list[0].product_name ?? `Товар #${prodId}`;
        const uniqueStores = Array.from(new Set(list.map((r) => r.store_name ?? "Невідомий магазин")));
        repeatedDefects.push({
          productId: prodId,
          productName: prodName,
          count: list.length,
          stores: uniqueStores,
        });
      }
    }

    // 3. Cross-store duplicates today (same product_id reported today in >= 2 stores)
    const todayIssues = rows.filter(
      (r) => r.product_id != null && new Date(r.created_at).getTime() >= todayCutoff
    );

    const todayMap = new Map<number, FeedRow[]>();
    for (const r of todayIssues) {
      if (r.product_id != null) {
        const list = todayMap.get(r.product_id) ?? [];
        list.push(r);
        todayMap.set(r.product_id, list);
      }
    }

    const crossStoreDupes: { productId: number; productName: string; stores: string[] }[] = [];
    for (const [prodId, list] of todayMap.entries()) {
      const uniqueStores = Array.from(new Set(list.map((r) => r.store_name ?? "Невідомий магазин")));
      if (uniqueStores.length >= 2) {
        const prodName = list[0].product_name ?? `Товар #${prodId}`;
        crossStoreDupes.push({
          productId: prodId,
          productName: prodName,
          stores: uniqueStores,
        });
      }
    }

    return { stuck, repeatedDefects, crossStoreDupes };
  }, [rows]);

  const hasSignals =
    signals.stuck.length > 0 ||
    signals.repeatedDefects.length > 0 ||
    signals.crossStoreDupes.length > 0;

  if (!hasSignals) return null;

  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <AlertOutlined style={{ color: token.colorWarning }} />
          <Text strong>Розумні сигнали аналітики</Text>
        </Space>
      }
      style={{ marginBottom: 16, border: `1px solid ${token.colorWarningOutline}` }}
    >
      <Space direction="vertical" size={10} style={{ width: "100%" }}>
        {/* Stuck feedbacks alert */}
        {signals.stuck.length > 0 && (
          <Alert
            type="warning"
            showIcon
            icon={<ClockCircleOutlined />}
            message={
              <Text strong style={{ fontSize: 13 }}>
                Завислі звернення: {signals.stuck.length} шт.
              </Text>
            }
            description={
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Звернення перебувають у статусі «Новий» більше 3 днів:
                </Text>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {signals.stuck.map((r) => (
                    <Tag key={r.id} color="warning" bordered={false} style={{ fontSize: 11 }}>
                      {r.store_name} · {r.category_title}
                    </Tag>
                  ))}
                </div>
              </div>
            }
          />
        )}

        {/* Repeated defects alert */}
        {signals.repeatedDefects.length > 0 && (
          <Alert
            type="error"
            showIcon
            icon={<WarningOutlined />}
            message={
              <Text strong style={{ fontSize: 13 }}>
                Повторюваний брак товарів за тиждень: {signals.repeatedDefects.length} позицій
              </Text>
            }
            description={
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Наступні товари отримали повторні скарги на брак за останні 7 днів:
                </Text>
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                  {signals.repeatedDefects.map((d) => (
                    <div key={d.productId} style={{ fontSize: 12 }}>
                      🎯 <b>{d.productName}</b> — скаржилися {d.count} разів у магазинах:{" "}
                      {d.stores.map((s) => (
                        <Tag key={s} bordered={false} style={{ fontSize: 11 }}>
                          {s}
                        </Tag>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            }
          />
        )}

        {/* Cross-store duplicates alert */}
        {signals.crossStoreDupes.length > 0 && (
          <Alert
            type="info"
            showIcon
            icon={<CopyOutlined />}
            message={
              <Text strong style={{ fontSize: 13 }}>
                Одночасні проблеми з товаром сьогодні: {signals.crossStoreDupes.length} позицій
              </Text>
            }
            description={
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Один і той самий товар сьогодні заявлено як проблемний у кількох магазинах одночасно:
                </Text>
                <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 6 }}>
                  {signals.crossStoreDupes.map((d) => (
                    <div key={d.productId} style={{ fontSize: 12 }}>
                      📦 <b>{d.productName}</b> у магазинах:{" "}
                      {d.stores.map((s) => (
                        <Tag key={s} color="blue" bordered={false} style={{ fontSize: 11 }}>
                          {s}
                        </Tag>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            }
          />
        )}
      </Space>
    </Card>
  );
}
