"use client";

import { Alert, Card, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";

interface ControlShift { shift_id: string; employee_full_name: string; store_name: string; starts_at: string; ends_at: string; is_replacement: boolean; matched_photo_report_count: number; has_matched_photo_report: boolean; }
interface UnmatchedReport { feedback_id: string; seller_full_name: string; store_name: string; submitted_at: string; local_date: string; }
function time(iso: string) { return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)); }

export function SchedulePhotoControl({ month }: { month: string }) {
  const [shifts, setShifts] = useState<ControlShift[]>([]); const [unmatched, setUnmatched] = useState<UnmatchedReport[]>([]); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { const controller = new AbortController(); setLoading(true); setError(null); void fetch(`/api/admin/network/schedule-photo-control?month=${month}`, { signal: controller.signal }).then(async (response) => { const body = await response.json() as { shifts?: ControlShift[]; unmatched_reports?: UnmatchedReport[]; error?: string }; if (!response.ok) throw new Error(body.error ?? "Не вдалося завантажити контроль"); setShifts(body.shifts ?? []); setUnmatched(body.unmatched_reports ?? []); }).catch((value: unknown) => { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "Не вдалося завантажити контроль"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [month]);
  const shiftColumns: ColumnsType<ControlShift> = [{ title: "Зміна", key: "shift", render: (_, row) => `${row.employee_full_name} · ${row.store_name}` }, { title: "Час", key: "time", render: (_, row) => `${time(row.starts_at)}–${time(row.ends_at)}` }, { title: "Заміна", dataIndex: "is_replacement", render: (value: boolean) => value ? <Tag color="gold">Так</Tag> : "—" }, { title: "Фотозвіт", dataIndex: "matched_photo_report_count", render: (value: number) => value ? <Tag color="green">Є: {value}</Tag> : <Tag color="red">Немає</Tag> }];
  const unmatchedColumns: ColumnsType<UnmatchedReport> = [{ title: "Продавець", dataIndex: "seller_full_name" }, { title: "Магазин", dataIndex: "store_name" }, { title: "Дата і час", dataIndex: "submitted_at", render: time }, { title: "Статус", render: () => <Tag color="orange">Поза зміною</Tag> }];
  return <div className="space-y-4">{error ? <Alert type="warning" showIcon message="Контроль фотозвитів недоступний" description={error} /> : null}<Card title="Планові зміни та фотозвіти"><Table rowKey="shift_id" loading={loading} columns={shiftColumns} dataSource={shifts} pagination={{ pageSize: 30, hideOnSinglePage: true }} /></Card><Card title="Фотозвіти поза плановою зміною"><Table rowKey="feedback_id" loading={loading} columns={unmatchedColumns} dataSource={unmatched} pagination={{ pageSize: 20, hideOnSinglePage: true }} /></Card><Alert type="info" showIcon message="Фотозвіт підтверджує відправлення під PIN, а не повну фактичну явку чи зарплатний час." /></div>;
}
