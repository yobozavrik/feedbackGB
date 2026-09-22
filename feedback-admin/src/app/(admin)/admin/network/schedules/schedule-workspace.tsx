"use client";

import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Form, Input, Modal, Popconfirm, Select, Space, Spin, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useMemo, useState } from "react";
import { currentKyivMonth, kyivDateTimeParts, kyivWallTimeToIso } from "@/lib/scheduleTime";
import { ScheduleMonthGrid } from "./schedule-month-grid";
import { SchedulePhotoControl } from "./schedule-photo-control";
import type { GridMoveRequest } from "./schedule-month-grid";

export interface ScheduleStore { id: number; name: string; }
export interface ScheduleSeller { id: string; full_name: string; display_label: string | null; store_id: number | null; replacement_store_ids: number[]; }

interface SchedulePeriod { id: string; period_start: string; period_end: string; status: "draft" | "published" | "locked" | "archived"; timezone: string; row_version: number; }
export interface Shift {
  shift_id: string; period_id: string; period_status: SchedulePeriod["status"]; employee_id: string;
  employee_full_name: string; employee_display_label: string | null; employee_home_store_id: number | null;
  store_id: number; store_name: string; starts_at: string; ends_at: string; break_minutes: number;
  shift_status: "scheduled" | "cancelled"; is_replacement: boolean; replacement_permission_id: string | null;
  change_reason: string | null; row_version: number;
}
interface ShiftEvent { id: string; event_type: "created" | "updated" | "cancelled"; actor_name: string; occurred_at: string; reason: string | null; }
interface EmployeeMonthSummary { employee_id: string; employee_full_name: string; employee_display_label: string | null; scheduled_shift_count: number; cancelled_shift_count: number; replacement_shift_count: number; planned_minutes: number; }
interface StoreMonthSummary { store_id: number; store_name: string; scheduled_shift_count: number; cancelled_shift_count: number; replacement_shift_count: number; scheduled_employee_count: number; planned_minutes: number; }

interface FormValues { employee_id: string; store_id: number; date: string; starts_time: string; ends_time: string; break_minutes?: number; change_reason?: string; }
interface Props { stores: ScheduleStore[]; sellers: ScheduleSeller[]; bootstrapError: string | null; canManagePeriod: boolean; }

function readableDateTime(iso: string) {
  return new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function periodIsReadonly(period: SchedulePeriod | null) {
  return period?.status === "locked" || period?.status === "archived";
}

export function ScheduleWorkspace({ stores, sellers, bootstrapError, canManagePeriod }: Props) {
  const [month, setMonth] = useState(currentKyivMonth);
  const [storeId, setStoreId] = useState<number | undefined>();
  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [period, setPeriod] = useState<SchedulePeriod | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [employeeSummary, setEmployeeSummary] = useState<EmployeeMonthSummary[]>([]);
  const [storeSummary, setStoreSummary] = useState<StoreMonthSummary[]>([]);
  const [storeSummaryError, setStoreSummaryError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("grid");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(bootstrapError);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null);
  const [periodAction, setPeriodAction] = useState<"publish" | "lock" | null>(null);
  const [lockReason, setLockReason] = useState("");
  const [historyShift, setHistoryShift] = useState<Shift | null>(null);
  const [historyEvents, setHistoryEvents] = useState<ShiftEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [moveRequest, setMoveRequest] = useState<GridMoveRequest | null>(null);
  const [moveReason, setMoveReason] = useState("");
  const [form] = Form.useForm<FormValues>();

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ month });
      if (storeId) params.set("storeId", String(storeId));
      if (employeeId) params.set("employeeId", employeeId);
      const [periodResponse, shiftsResponse, employeesResponse, storesResponse] = await Promise.all([
        fetch(`/api/admin/network/schedule-periods?month=${month}`, { signal }),
        fetch(`/api/admin/network/schedules?${params.toString()}`, { signal }),
        fetch(`/api/admin/network/schedule-employees?month=${month}`, { signal }),
        fetch(`/api/admin/network/schedule-stores?month=${month}`, { signal }),
      ]);
      const periodBody = await periodResponse.json() as { period?: SchedulePeriod | null; error?: string };
      const shiftsBody = await shiftsResponse.json() as { shifts?: Shift[]; error?: string };
      const employeesBody = await employeesResponse.json() as { employees?: EmployeeMonthSummary[]; error?: string };
      const storesBody = await storesResponse.json() as { stores?: StoreMonthSummary[]; error?: string };
      if (!periodResponse.ok) throw new Error(periodBody.error ?? "Не вдалося завантажити період");
      if (!shiftsResponse.ok) throw new Error(shiftsBody.error ?? "Не вдалося завантажити зміни");
      if (!employeesResponse.ok) throw new Error(employeesBody.error ?? "Не вдалося завантажити підсумок працівників");
      setPeriod(periodBody.period ?? null); setShifts(shiftsBody.shifts ?? []); setEmployeeSummary(employeesBody.employees ?? []);
      if (storesResponse.ok) { setStoreSummary(storesBody.stores ?? []); setStoreSummaryError(null); }
      else { setStoreSummary([]); setStoreSummaryError(storesBody.error ?? "Статистика магазинів тимчасово недоступна"); }
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

  const runPeriodAction = async () => {
    if (!periodAction || !period) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/admin/network/schedule-periods?id=${period.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: periodAction, row_version: period.row_version, ...(periodAction === "lock" ? { lock_reason: lockReason } : {}) }),
      });
      const body = await response.json() as { period?: SchedulePeriod; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не вдалося оновити статус графіка");
      setPeriodAction(null); setLockReason(""); setPeriod(body.period ?? period); await load();
    } catch (requestError: unknown) { setError(requestError instanceof Error ? requestError.message : "Не вдалося оновити статус графіка"); }
    finally { setSaving(false); }
  };

  const openHistory = async (shift: Shift) => {
    setHistoryShift(shift); setHistoryEvents([]); setHistoryError(null); setHistoryLoading(true);
    try {
      const response = await fetch(`/api/admin/network/schedules/${shift.shift_id}/events`);
      const body = await response.json() as { events?: ShiftEvent[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не вдалося завантажити історію");
      setHistoryEvents(body.events ?? []);
    } catch (requestError: unknown) { setHistoryError(requestError instanceof Error ? requestError.message : "Не вдалося завантажити історію"); }
    finally { setHistoryLoading(false); }
  };

  const requestGridMove = (request: GridMoveRequest) => {
    setMoveReason("");
    setMoveRequest(request);
  };

  const saveGridMove = async () => {
    if (!moveRequest) return;
    if (period?.status === "published" && moveReason.trim().length < 3) {
      setError("Для перенесення в опублікованому графіку вкажіть причину (мінімум 3 символи)");
      return;
    }
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/admin/network/schedules?id=${moveRequest.shift.shift_id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ row_version: moveRequest.shift.row_version, store_id: moveRequest.targetStoreId, starts_at: moveRequest.startsAt, ends_at: moveRequest.endsAt, ...(moveReason.trim() ? { change_reason: moveReason.trim() } : {}) }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не вдалося перенести зміну");
      setMoveRequest(null); setMoveReason(""); await load();
    } catch (requestError: unknown) { setError(requestError instanceof Error ? requestError.message : "Не вдалося перенести зміну"); }
    finally { setSaving(false); }
  };

  const columns: ColumnsType<Shift> = useMemo(() => [
    { title: "Дата і час", key: "time", width: 175, render: (_, row) => `${readableDateTime(row.starts_at)} — ${readableDateTime(row.ends_at)}` },
    { title: "Працівник", key: "employee", render: (_, row) => <Space size={6}>{row.employee_display_label ?? row.employee_full_name}{row.is_replacement ? <Tag color="gold">Заміна</Tag> : null}</Space> },
    { title: "Магазин", dataIndex: "store_name", key: "store" },
    { title: "Перерва", dataIndex: "break_minutes", key: "break", width: 90, render: (value: number) => `${value} хв` },
    { title: "Статус", dataIndex: "shift_status", key: "status", width: 115, render: (value: Shift["shift_status"]) => <Tag color={value === "scheduled" ? "green" : "default"}>{value === "scheduled" ? "Заплановано" : "Скасовано"}</Tag> },
    { title: "", key: "actions", width: 180, render: (_, row) => <Space size={2}><Button type="link" size="small" onClick={() => void openHistory(row)}>Історія</Button>{row.shift_status === "scheduled" && !periodIsReadonly(period) ? <><Button type="text" aria-label={`Редагувати ${row.employee_full_name}`} icon={<EditOutlined />} onClick={() => openEdit(row)} /><Popconfirm title="Скасувати цю зміну?" okText="Скасувати" cancelText="Назад" onConfirm={() => void cancelShift(row)}><Button danger type="link" size="small" loading={saving}>Скасувати</Button></Popconfirm></> : null}</Space> },
  ], [cancelShift, openEdit, period, saving]);

  const employeeColumns: ColumnsType<EmployeeMonthSummary> = useMemo(() => [
    { title: "Працівник", key: "employee", render: (_, row) => row.employee_display_label ?? row.employee_full_name },
    { title: "Змін", dataIndex: "scheduled_shift_count", align: "right", width: 90 },
    { title: "Заміни", dataIndex: "replacement_shift_count", align: "right", width: 100 },
    { title: "Скасовано", dataIndex: "cancelled_shift_count", align: "right", width: 115 },
    { title: "Планові години", dataIndex: "planned_minutes", align: "right", width: 145, render: (value: number) => `${(value / 60).toFixed(1)} год` },
  ], []);

  const storeById = useMemo(() => new Map(stores.map((store) => [store.id, store.name])), [stores]);
  const storeColumns: ColumnsType<StoreMonthSummary> = useMemo(() => [
    { title: "Магазин", dataIndex: "store_name", key: "store" },
    { title: "Продавців у графіку", dataIndex: "scheduled_employee_count", align: "right", width: 150 },
    { title: "Змін", dataIndex: "scheduled_shift_count", align: "right", width: 90 },
    { title: "Планові години", dataIndex: "planned_minutes", align: "right", width: 140, render: (value: number) => `${(value / 60).toFixed(1)} год` },
    { title: "Заміни", dataIndex: "replacement_shift_count", align: "right", width: 95 },
    { title: "Скасовано", dataIndex: "cancelled_shift_count", align: "right", width: 105 },
  ], []);
  const replacementColumns: ColumnsType<Shift> = useMemo(() => [
    { title: "Дата і час", key: "time", width: 180, render: (_, row) => `${readableDateTime(row.starts_at)} — ${readableDateTime(row.ends_at)}` },
    { title: "Продавець", key: "employee", render: (_, row) => row.employee_display_label ?? row.employee_full_name },
    { title: "Основний магазин", key: "home_store", render: (_, row) => row.employee_home_store_id ? storeById.get(row.employee_home_store_id) ?? "Невідомо" : "Не задано" },
    { title: "Магазин заміни", dataIndex: "store_name", key: "store" },
    { title: "Статус", dataIndex: "shift_status", key: "status", width: 120, render: (value: Shift["shift_status"]) => <Tag color={value === "scheduled" ? "green" : "default"}>{value === "scheduled" ? "Заплановано" : "Скасовано"}</Tag> },
    { title: "", key: "history", width: 90, render: (_, row) => <Button type="link" size="small" onClick={() => void openHistory(row)}>Історія</Button> },
  ], [openHistory, storeById]);

  const visibleStores = useMemo(() => storeId ? stores.filter((store) => store.id === storeId) : stores, [storeId, stores]);
  const visibleEmployees = useMemo(() => employeeId ? employeeSummary.filter((row) => row.employee_id === employeeId) : employeeSummary, [employeeId, employeeSummary]);
  const visibleStoreSummary = useMemo(() => {
    const summaryByStore = new Map(storeSummary.map((row) => [row.store_id, row]));
    return visibleStores.map((store) => summaryByStore.get(store.id) ?? { store_id: store.id, store_name: store.name, scheduled_shift_count: 0, cancelled_shift_count: 0, replacement_shift_count: 0, scheduled_employee_count: 0, planned_minutes: 0 });
  }, [storeSummary, visibleStores]);
  const replacementShifts = useMemo(() => shifts.filter((shift) => shift.is_replacement), [shifts]);

  const periodLabel = period ? `Період: ${period.period_start} — ${period.period_end} · ${period.status}` : "Період ще не створено";
  const readonly = periodIsReadonly(period);

  return <div className="space-y-4">
    {error ? <Alert type="error" showIcon message="Графік недоступний" description={error} closable onClose={() => setError(null)} /> : null}
    <Card><div className="flex flex-wrap items-end justify-between gap-4"><Space wrap size="middle"><label className="grid gap-1 text-sm text-ink-600">Місяць<Input aria-label="Місяць графіка" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="w-40" /></label><label className="grid gap-1 text-sm text-ink-600">Магазин<Select allowClear placeholder="Усі магазини" value={storeId} onChange={setStoreId} className="min-w-52" options={stores.map((store) => ({ value: store.id, label: store.name }))} /></label><label className="grid gap-1 text-sm text-ink-600">Працівник<Select allowClear showSearch optionFilterProp="label" placeholder="Усі продавці" value={employeeId} onChange={setEmployeeId} className="min-w-56" options={sellers.map((seller) => ({ value: seller.id, label: seller.display_label ?? seller.full_name }))} /></label></Space><Space>{period ? <Tag color={readonly ? "default" : "blue"}>{periodLabel}</Tag> : <Button type="primary" icon={<PlusOutlined />} loading={saving} onClick={() => void createPeriod()}>Створити графік</Button>}{period && !readonly ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>Додати зміну</Button> : null}{period?.status === "draft" && canManagePeriod ? <Button onClick={() => setPeriodAction("publish")}>Опублікувати</Button> : null}{period?.status === "published" && canManagePeriod ? <Button danger onClick={() => setPeriodAction("lock")}>Закрити місяць</Button> : null}</Space></div></Card>
    {loading ? <Card><div className="py-14 text-center"><Spin /></div></Card> : null}
    {!loading && !period ? <Card><Empty description={`На ${month} ще немає графіка`}><Button type="primary" loading={saving} onClick={() => void createPeriod()}>Створити чернетку графіка</Button></Empty></Card> : null}
    {!loading && period ? <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
      {
        key: "grid", label: "Сітка місяця", children: <Card title="Сітка магазинів" extra={<span className="text-xs text-ink-500">Компактна сітка: весь місяць і всі магазини на одному екрані</span>}>
          <ScheduleMonthGrid stores={visibleStores} month={month} shifts={shifts} sellers={sellers} readonly={readonly} onRequestMove={requestGridMove} onEdit={openEdit} onError={setError} />
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-600"><span><Tag color="blue">Звичайна зміна</Tag></span><span><Tag color="gold">Заміна</Tag></span></div>
        </Card>,
      },
      {
        key: "statistics", label: "Статистика", children: <div className="space-y-4">
          {storeSummaryError ? <Alert type="warning" showIcon message="Статистика магазинів тимчасово недоступна" description={storeSummaryError} /> : null}
          <Card title="Магазини за місяць"><Table rowKey="store_id" columns={storeColumns} dataSource={visibleStoreSummary} pagination={{ pageSize: 30, hideOnSinglePage: true }} locale={{ emptyText: "За цей місяць немає даних" }} /></Card>
          <Card title="Працівники за місяць"><Table rowKey="employee_id" columns={employeeColumns} dataSource={visibleEmployees} pagination={{ pageSize: 20, hideOnSinglePage: true }} locale={{ emptyText: "За цей місяць немає запланованих змін" }} /></Card>
        </div>,
      },
      {
        key: "replacements", label: "Заміни", children: <Card title="Журнал замін" extra={<span className="text-xs text-ink-500">Зміни не в основному магазині продавця</span>}><Table rowKey="shift_id" columns={replacementColumns} dataSource={replacementShifts} pagination={{ pageSize: 30, hideOnSinglePage: true }} locale={{ emptyText: "У вибраному періоді замін немає" }} scroll={{ x: 950 }} /></Card>,
      },
      { key: "photo-control", label: "Контроль фотозвітів", children: <SchedulePhotoControl month={month} /> },
    ]} /> : null}
    <Modal destroyOnHidden open={modalOpen} title={editing ? "Редагувати зміну" : "Додати зміну"} okText={editing ? "Зберегти" : "Додати"} cancelText="Скасувати" confirmLoading={saving} onCancel={() => setModalOpen(false)} onOk={() => form.submit()}>
      <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
        <Form.Item name="employee_id" label="Продавець" rules={[{ required: true, message: "Оберіть продавця" }]}><Select showSearch optionFilterProp="label" options={sellers.map((seller) => ({ value: seller.id, label: seller.display_label ?? seller.full_name }))} /></Form.Item>
        <Form.Item name="store_id" label="Магазин" rules={[{ required: true, message: "Оберіть магазин" }]}><Select options={stores.map((store) => ({ value: store.id, label: store.name }))} /></Form.Item>
        <div className="grid grid-cols-2 gap-3"><Form.Item name="date" label="Дата" rules={[{ required: true, message: "Оберіть дату" }]}><Input type="date" /></Form.Item><Form.Item name="break_minutes" label="Перерва, хв" rules={[{ required: true, message: "Вкажіть перерву" }]}><Input type="number" min={0} max={480} /></Form.Item></div>
        <div className="grid grid-cols-2 gap-3"><Form.Item name="starts_time" label="Початок (Київ)" rules={[{ required: true, message: "Вкажіть початок" }]}><Input type="time" /></Form.Item><Form.Item name="ends_time" label="Кінець (Київ)" rules={[{ required: true, message: "Вкажіть кінець" }]}><Input type="time" /></Form.Item></div>
        {editing?.period_status === "published" ? <Form.Item name="change_reason" label="Причина зміни" rules={[{ required: true, min: 3, message: "Вкажіть причину (мінімум 3 символи)" }]}><Input.TextArea maxLength={500} /></Form.Item> : null}
      </Form>
    </Modal>
    <Modal destroyOnHidden open={periodAction !== null} title={periodAction === "publish" ? "Опублікувати графік" : "Закрити графік"} okText={periodAction === "publish" ? "Опублікувати" : "Закрити"} cancelText="Назад" confirmLoading={saving} okButtonProps={{ danger: periodAction === "lock", disabled: periodAction === "lock" && lockReason.trim().length < 3 }} onCancel={() => { setPeriodAction(null); setLockReason(""); }} onOk={() => void runPeriodAction()}>
      {periodAction === "publish" ? <p>Графік стане операційним. Перед публікацією система перевірить непридатні призначення та заміни.</p> : <div className="grid gap-2"><p>Закритий місяць доступний лише для перегляду та не є фактом для зарплати.</p><Input.TextArea aria-label="Причина закриття" value={lockReason} onChange={(event) => setLockReason(event.target.value)} maxLength={500} placeholder="Причина закриття (мінімум 3 символи)" /></div>}
    </Modal>
    <Modal destroyOnHidden open={historyShift !== null} title={historyShift ? `Історія зміни: ${historyShift.employee_display_label ?? historyShift.employee_full_name}` : "Історія зміни"} footer={null} onCancel={() => setHistoryShift(null)}>
      {historyLoading ? <div className="py-8 text-center"><Spin /></div> : null}
      {historyError ? <Alert type="error" showIcon message="Історія недоступна" description={historyError} /> : null}
      {!historyLoading && !historyError && !historyEvents.length ? <Empty description="Подій ще немає" /> : null}
      {!historyLoading && !historyError && historyEvents.length ? <div className="space-y-3">{historyEvents.map((event) => <div key={event.id} className="rounded-lg border border-[rgb(var(--border))] p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{event.event_type === "created" ? "Створено" : event.event_type === "cancelled" ? "Скасовано" : "Змінено"}</strong><span className="text-ink-500">{readableDateTime(event.occurred_at)}</span></div><div className="mt-1 text-ink-700">{event.actor_name}{event.reason ? ` · ${event.reason}` : ""}</div></div>)}</div> : null}
    </Modal>
    <Modal destroyOnHidden open={moveRequest !== null} title="Перемістити зміну" okText="Підтвердити перенесення" cancelText="Назад" confirmLoading={saving} okButtonProps={{ disabled: period?.status === "published" && moveReason.trim().length < 3 }} onCancel={() => { setMoveRequest(null); setMoveReason(""); }} onOk={() => void saveGridMove()}>
      {moveRequest ? <div className="space-y-3"><p>Перемістити <strong>{moveRequest.shift.employee_display_label ?? moveRequest.shift.employee_full_name}</strong> з <strong>{moveRequest.shift.store_name}, {kyivDateTimeParts(moveRequest.shift.starts_at).date}</strong> до <strong>{storeById.get(moveRequest.targetStoreId)}, {moveRequest.targetDate}</strong>?</p>{period?.status === "published" ? <Form.Item label="Причина перенесення" required><Input.TextArea aria-label="Причина перенесення" value={moveReason} onChange={(event) => setMoveReason(event.target.value)} maxLength={500} placeholder="Мінімум 3 символи" /></Form.Item> : null}</div> : null}
    </Modal>
  </div>;
}
