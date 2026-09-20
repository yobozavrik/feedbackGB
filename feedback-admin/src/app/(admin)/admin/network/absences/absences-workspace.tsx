"use client";

import { PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Modal, Select, Space, Spin, Table, Tag } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Store { id: number; name: string; }
interface Seller { id: string; full_name: string; store_id: number | null; }
interface Absence { id: string; employee_id: string; employee_full_name: string; store_name: string | null; absence_type: "vacation" | "sick_leave" | "day_off"; starts_on: string; ends_on: string; status: "active" | "cancelled"; note: string | null; }
const labels = { vacation: "Відпустка", sick_leave: "Лікарняний", day_off: "Відгул" } as const;
const colors = { vacation: "blue", sick_leave: "red", day_off: "gold" } as const;

export function AbsencesWorkspace({ stores, sellers, bootstrapError }: { stores: Store[]; sellers: Seller[]; bootstrapError: string | null }) {
  const [month, setMonth] = useState(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit" }).format(new Date()));
  const [rows, setRows] = useState<Absence[]>([]); const [error, setError] = useState<string | null>(bootstrapError); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [open, setOpen] = useState(false); const [form] = Form.useForm();
  const load = useCallback(async () => { setLoading(true); try { const res = await fetch(`/api/admin/network/absences?month=${month}`); const body = await res.json(); if (!res.ok) throw new Error(body.error); setRows(body.absences ?? []); } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося завантажити відсутності"); } finally { setLoading(false); } }, [month]);
  useEffect(() => { void load(); }, [load]);
  const columns = useMemo(() => [
    { title: "Продавчиня", dataIndex: "employee_full_name", key: "employee" }, { title: "Магазин", dataIndex: "store_name", key: "store", render: (v: string | null) => v ?? "Не задано" },
    { title: "Тип", dataIndex: "absence_type", key: "type", render: (v: keyof typeof labels) => <Tag color={colors[v]}>{labels[v]}</Tag> }, { title: "Період", key: "dates", render: (_: unknown, r: Absence) => `${r.starts_on} — ${r.ends_on}` }, { title: "Примітка", dataIndex: "note", key: "note", render: (v: string | null) => v ?? "—" },
  ], []);
  const save = async (v: Record<string, unknown>) => { setSaving(true); try { const res = await fetch("/api/admin/network/absences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) }); const body = await res.json(); if (!res.ok) throw new Error(body.error); setOpen(false); form.resetFields(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Не вдалося зберегти"); } finally { setSaving(false); } };
  return <div className="space-y-4">{error ? <Alert type="error" showIcon message="Графік відсутностей недоступний" description={error} closable onClose={() => setError(null)} /> : null}<Card><div className="flex flex-wrap items-end justify-between gap-3"><label className="grid gap-1 text-sm text-ink-600">Місяць<Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Додати відсутність</Button></div></Card>{loading ? <Card><div className="py-12 text-center"><Spin /></div></Card> : <Card title="Відсутності за місяць"><Table rowKey="id" columns={columns} dataSource={rows} pagination={{ pageSize: 30, hideOnSinglePage: true }} locale={{ emptyText: "У цьому місяці відсутностей немає" }} /></Card>}<Modal destroyOnHidden open={open} title="Додати відсутність" okText="Зберегти" cancelText="Скасувати" confirmLoading={saving} onCancel={() => setOpen(false)} onOk={() => form.submit()}><Form form={form} layout="vertical" onFinish={(v) => void save(v)}><Form.Item name="employee_id" label="Продавчиня" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={sellers.map((x) => ({ value: x.id, label: x.full_name }))} /></Form.Item><Form.Item name="store_id" label="Магазин"><Select allowClear options={stores.map((x) => ({ value: x.id, label: x.name }))} /></Form.Item><Form.Item name="absence_type" label="Тип" rules={[{ required: true }]}><Select options={Object.entries(labels).map(([value, label]) => ({ value, label }))} /></Form.Item><Space className="grid grid-cols-2 gap-3"><Form.Item name="starts_on" label="Початок" rules={[{ required: true }]}><Input type="date" /></Form.Item><Form.Item name="ends_on" label="Кінець" rules={[{ required: true }]}><Input type="date" /></Form.Item></Space><Form.Item name="note" label="Примітка"><Input.TextArea maxLength={500} /></Form.Item></Form></Modal></div>;
}
