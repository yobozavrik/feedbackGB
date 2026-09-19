"use client";

import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Form, Input, Modal, Popconfirm, Select, Space, Spin, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { currentKyivMonth, kyivDateTimeParts, kyivWallTimeToIso } from "@/lib/scheduleTime";

export interface ScheduleStore { id: number; name: string; }
export interface ScheduleSeller { id: string; full_name: string; display_label: string | null; store_id: number | null; }

interface SchedulePeriod { id: string; period_start: string; period_end: string; status: "draft" | "published" | "locked" | "archived"; timezone: string; row_version: number; }
interface Shift {
  shift_id: string; period_id: string; period_status: SchedulePeriod["status"]; employee_id: string;
  employee_full_name: string; employee_display_label: string | null; employee_home_store_id: number | null;
  store_id: number; store_name: string; starts_at: string; ends_at: string; break_minutes: number;
  shift_status: "scheduled" | "cancelled"; is_replacement: boolean; replacement_permission_id: string | null;
  change_reason: string | null; row_version: number;
}

interface FormValues { employee_id: string; store_id: number; date: string; starts_time: string; ends_time: string; break_minutes?: number; change_reason?: string; }
interface Props { stores: ScheduleStore[]; sellers: ScheduleSeller[]; bootstrapError: string | null; }

function readableDateTime(iso: string) {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function periodIsReadonly(period: SchedulePeriod | null) {
  return period?.status === "locked" || period?.status === "archived";
}

export function ScheduleWorkspace({ stores, sellers, bootstrapError }: Props) {
  const [month, setMonth] = useState(currentKyivMonth);
  const [storeId, setStoreId] = useState<number | undefined>();
  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [period, setPeriod] = useState<SchedulePeriod | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(bootstrapError);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ month });
      if (storeId) params.set("storeId", String(storeId));
      if (employeeId) params.set("employeeId", employeeId);
      const [periodResponse, shiftsResponse] = await Promise.all([
        fetch(`/api/admin/network/schedule-periods?month=${month}`, { signal }),
        fetch(`/api/admin/network/schedules?${params.toString()}`, { signal }),
      ]);
      const periodBody = await periodResponse.json() as { period?: SchedulePeriod | null; error?: string };
      const shiftsBody = await shiftsResponse.json() as { shifts?: Shift[]; error?: string };
      if (!periodResponse.ok) throw new Error(periodBody.error ?? "Не вдалося завантажити період");
      if (!shiftsResponse.ok) throw new Error(shiftsBody.error ?? "Не вдалося завантажити зміни");
      setPeriod(periodBody.period ?? null); setShifts(shiftsBody.shifts ?? []);
    } catch (requestError: unknown) {
      if (!signal?.aborted) setError(requestError instanceof Error ? requestError.message : "Не вдалося завантажити графік");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, [employeeId, month, storeId]);

  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ date: `${month}-01`, starts_time: "09:00", ends_time: "18:00", break_minutes: 30, store_id: storeId });
    setModalOpen(true);
  };
  const openEdit = useCallback((shift: Shift) => {
    const starts = kyivDateTimeParts(shift.starts_at); const ends = kyivDateTimeParts(shift.ends_at);
    setEditing(shift);
    form.setFieldsValue({ employee_id: shift.employee_id, store_id: shift.store_id, date: starts.date, starts_time: starts.time, ends_time: ends.time, break_minutes: shift.break_minutes, change_reason: shift.change_reason ?? undefined });
    setModalOpen(true);
  }, [form]);

  const submit = async (values: FormValues) => {
    if (!period) return;
    setSaving(true); setError(null);
    try {
      const startsAt = kyivWallTimeToIso(values.date, values.starts_time);
      const endsAt = kyivWallTimeToIso(values.date, values.ends_time);
      const payload = { employee_id: values.employee_id, store_id: values.store_id, starts_at: startsAt, ends_at: endsAt, break_minutes: Number(values.break_minutes ?? 0), change_reason: values.change_reason };
      const response = editing
        ? await fetch(`/api/admin/network/schedules?id=${editing.shift_id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, row_version: editing.row_version }) })
        : await fetch("/api/admin/network/schedules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, period_id: period.id }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не вдалося зберегти зміну");
      setModalOpen(false); await load();
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : "Не вдалося зберегти зміну");
    } finally { setSaving(false); }
  };

  const cancelShift = useCallback(async (shift: Shift) => {
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/admin/network/schedules?id=${shift.shift_id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ row_version: shift.row_version, status: "cancelled", change_reason: "Скасовано адміністратором" }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не вдалося скасувати зміну");
      await load();
    } catch (requestError: unknown) { setError(requestError instanceof Error ? requestError.message : "Не вдалося скасувати зміну"); }
    finally { setSaving(false); }
  }, [load]);

  const createPeriod = async () => {
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/admin/network/schedule-periods", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ month }) });
      const body = await response.json() as { period?: SchedulePeriod; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не вдалося створити період");
      setPeriod(body.period ?? null); setShifts([]);
    } catch (requestError: unknown) { setError(requestError instanceof Error ? requestError.message : "Не вдалося створити період"); }
    finally { setSaving(false); }
  };

  const columns: ColumnsType<Shift> = useMemo(() => [
    { title: "Дата і час", key: "time", width: 175, render: (_, row) => `${readableDateTime(row.starts_at)} — ${readableDateTime(row.ends_at)}` },
    { title: "Працівник", key: "employee", render: (_, row) => <Space size={6}>{row.employee_display_label ?? row.employee_full_name}{row.is_replacement ? <Tag color="gold">Заміна</Tag> : null}</Space> },
    { title: "Магазин", dataIndex: "store_name", key: "store" },
    { title: "Перерва", dataIndex: "break_minutes", key: "break", width: 90, render: (value: number) => `${value} хв` },
    { title: "Статус", dataIndex: "shift_status", key: "status", width: 115, render: (value: Shift["shift_status"]) => <Tag color={value === "scheduled" ? "green" : "default"}>{value === "scheduled" ? "Заплановано" : "Скасовано"}</Tag> },
    { title: "", key: "actions", width: 125, render: (_, row) => row.shift_status === "scheduled" && !periodIsReadonly(period) ? <Space size={2}><Button type="text" aria-label={`Редагувати ${row.employee_full_name}`} icon={<EditOutlined />} onClick={() => openEdit(row)} /><Popconfirm title="Скасувати цю зміну?" okText="Скасувати" cancelText="Назад" onConfirm={() => void cancelShift(row)}><Button danger type="link" size="small" loading={saving}>Скасувати</Button></Popconfirm></Space> : null },
  ], [cancelShift, openEdit, period, saving]);

  const periodLabel = period ? `Період: ${period.period_start} — ${period.period_end} · ${period.status}` : "Період ще не створено";
  const readonly = periodIsReadonly(period);

  return <div className="space-y-4">
    {error ? <Alert type="error" showIcon message="Графік недоступний" description={error} closable onClose={() => setError(null)} /> : null}
    <Card><div className="flex flex-wrap items-end justify-between gap-4"><Space wrap size="middle"><label className="grid gap-1 text-sm text-ink-600">Місяць<Input aria-label="Місяць графіка" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-40" /></label><label className="grid gap-1 text-sm text-ink-600">Магазин<Select allowClear placeholder="Усі магазини" value={storeId} onChange={setStoreId} className="min-w-52" options={stores.map((store) => ({ value: store.id, label: store.name }))} /></label><label className="grid gap-1 text-sm text-ink-600">Працівник<Select allowClear showSearch optionFilterProp="label" placeholder="Усі продавці" value={employeeId} onChange={setEmployeeId} className="min-w-56" options={sellers.map((seller) => ({ value: seller.id, label: seller.display_label ?? seller.full_name }))} /></label></Space><Space>{period ? <Tag color={readonly ? "default" : "blue"}>{periodLabel}</Tag> : <Button type="primary" icon={<PlusOutlined />} loading={saving} onClick={() => void createPeriod()}>Створити графік</Button>}{period && !readonly ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Додати зміну</Button> : null}</Space></div></Card>
    {loading ? <Card><div className="py-14 text-center"><Spin /></div></Card> : null}
    {!loading && !period ? <Card><Empty description={`На ${month} ще немає графіка`}><Button type="primary" loading={saving} onClick={() => void createPeriod()}>Створити чернетку графіка</Button></Empty></Card> : null}
    {!loading && period ? <Card title="Зміни"><Table rowKey="shift_id" columns={columns} dataSource={shifts} pagination={{ pageSize: 30, hideOnSinglePage: true }} locale={{ emptyText: "У вибраному фільтрі змін ще немає" }} scroll={{ x: 850 }} /></Card> : null}
    <Modal destroyOnClose open={modalOpen} title={editing ? "Редагувати зміну" : "Додати зміну"} okText={editing ? "Зберегти" : "Додати"} cancelText="Скасувати" confirmLoading={saving} onCancel={() => setModalOpen(false)} onOk={() => form.submit()}>
      <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
        <Form.Item name="employee_id" label="Продавець" rules={[{ required: true, message: "Оберіть продавця" }]}><Select showSearch optionFilterProp="label" options={sellers.map((seller) => ({ value: seller.id, label: seller.display_label ?? seller.full_name }))} /></Form.Item>
        <Form.Item name="store_id" label="Магазин" rules={[{ required: true, message: "Оберіть магазин" }]}><Select options={stores.map((store) => ({ value: store.id, label: store.name }))} /></Form.Item>
        <div className="grid grid-cols-2 gap-3"><Form.Item name="date" label="Дата" rules={[{ required: true, message: "Оберіть дату" }]}><Input type="date" /></Form.Item><Form.Item name="break_minutes" label="Перерва, хв" rules={[{ required: true, message: "Вкажіть перерву" }]}><Input type="number" min={0} max={480} /></Form.Item></div>
        <div className="grid grid-cols-2 gap-3"><Form.Item name="starts_time" label="Початок (Київ)" rules={[{ required: true, message: "Вкажіть початок" }]}><Input type="time" /></Form.Item><Form.Item name="ends_time" label="Кінець (Київ)" rules={[{ required: true, message: "Вкажіть кінець" }]}><Input type="time" /></Form.Item></div>
        {editing?.period_status === "published" ? <Form.Item name="change_reason" label="Причина зміни" rules={[{ required: true, min: 3, message: "Вкажіть причину (мінімум 3 символи)" }]}><Input.TextArea maxLength={500} /></Form.Item> : null}
      </Form>
    </Modal>
  </div>;
}
