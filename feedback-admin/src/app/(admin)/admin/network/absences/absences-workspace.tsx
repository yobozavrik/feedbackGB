"use client";

import { DndContext, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { PlusOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Descriptions, Form, Input, Modal, Select, Space, Spin, Table, Tabs, Tag } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";

interface Store { id: number; name: string; }
interface Seller { id: string; full_name: string; store_id: number | null; }
type AbsenceType = "vacation" | "sick_leave" | "day_off";
type RequestTopic = "vacation" | "sick-leave" | "day-off" | "transfer";
type RequestStatus = "new" | "in_progress" | "resolved" | "rejected";
interface Absence {
  id: string; employee_id: string; employee_full_name: string; store_id: number | null; store_name: string | null;
  absence_type: AbsenceType; starts_on: string; ends_on: string; status: "active" | "cancelled";
  note: string | null; cancel_reason: string | null; row_version: number; source_feedback_id?: string | null;
}
interface HrRequest {
  feedback_id: string; requested_at: string; feedback_status: RequestStatus; employee_id: string;
  employee_full_name: string; requested_store_name: string | null; requested_store_id: number | null;
  hr_topic: RequestTopic; requested_date_from: string | null; requested_date_to: string | null;
  requester_comment: string | null; photo_url: string | null; photo_urls: string[] | null;
  absence_id: string | null; absence_status: "active" | "cancelled" | null;
  absence_starts_on: string | null; absence_ends_on: string | null; assigned_full_name: string | null;
}
interface CalendarRow { key: string; employee_full_name: string; store_name: string | null; absences: Absence[]; }
type ActionKind = "review" | "approve" | "reject";
type PendingAction = { request: HrRequest; action: ActionKind } | null;

const absenceLabels: Record<AbsenceType, string> = { vacation: "Відпустка", sick_leave: "Лікарняний", day_off: "Відгул" };
const absenceColors: Record<AbsenceType, string> = { vacation: "blue", sick_leave: "red", day_off: "gold" };
const topicLabels: Record<RequestTopic, string> = { vacation: "Відпустка", "sick-leave": "Лікарняний", "day-off": "Відгул", transfer: "Переведення" };
const topicEmoji: Record<RequestTopic, string> = { vacation: "🏖️", "sick-leave": "🤒", "day-off": "🛋️", transfer: "🔁" };
const statusLabels: Record<RequestStatus, string> = { new: "Отримано", in_progress: "На розгляді", resolved: "Погоджено", rejected: "Відхилено" };
const statusColors: Record<RequestStatus, string> = { new: "blue", in_progress: "gold", resolved: "green", rejected: "red" };
const columns: RequestStatus[] = ["new", "in_progress", "resolved", "rejected"];

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit" }).format(new Date());
}

function visiblePhotos(request: HrRequest) {
  return (request.photo_urls?.length ?? 0) || (request.photo_url ? 1 : 0);
}

function HrRequestCard({ request, onAction, onPhotos }: { request: HrRequest; onAction: (request: HrRequest, action: ActionKind) => void; onPhotos: (request: HrRequest) => void }) {
  const draggable = useDraggable({ id: request.feedback_id, data: { request } });
  return (
    <div ref={draggable.setNodeRef} {...draggable.attributes} {...draggable.listeners} style={{ opacity: draggable.isDragging ? 0.45 : 1 }}>
      <Card size="small" className="mb-2 cursor-grab shadow-sm active:cursor-grabbing">
        <div className="flex items-start justify-between gap-2">
          <strong className="text-ink-900">{topicEmoji[request.hr_topic]} {request.employee_full_name}</strong>
          <Tag color={statusColors[request.feedback_status]}>{statusLabels[request.feedback_status]}</Tag>
        </div>
        <div className="mt-1 text-xs text-ink-600">{request.requested_store_name ?? "Магазин не вказано"}</div>
        <div className="mt-2 text-sm text-ink-800">{topicLabels[request.hr_topic]} · {request.requested_date_from ?? "без періоду"}{request.requested_date_to ? " — " + request.requested_date_to : ""}</div>
        {request.requester_comment ? <div className="mt-2 line-clamp-2 text-xs text-ink-600">{request.requester_comment}</div> : null}
        <div className="mt-2 flex flex-wrap gap-1">
          {visiblePhotos(request) ? <Button size="small" onPointerDown={(event) => event.stopPropagation()} onClick={() => onPhotos(request)}>Фото: {visiblePhotos(request)}</Button> : null}
          {request.absence_id ? <Tag color={request.absence_status === "cancelled" ? "default" : "green"}>{request.absence_status === "cancelled" ? "Відсутність скасовано" : "Відсутність створено"}</Tag> : null}
        </div>
        {request.feedback_status === "new" || request.feedback_status === "in_progress" ? (
          <Space size={4} wrap className="mt-3" onPointerDown={(event) => event.stopPropagation()}>
            {request.feedback_status === "new" ? <Button size="small" onClick={() => onAction(request, "review")}>Взяти в роботу</Button> : null}
            <Button size="small" type="primary" onClick={() => onAction(request, "approve")}>Погодити</Button>
            <Button size="small" danger onClick={() => onAction(request, "reject")}>Відхилити</Button>
          </Space>
        ) : null}
      </Card>
    </div>
  );
}

function KanbanColumn({ status, requests, onAction, onPhotos }: { status: RequestStatus; requests: HrRequest[]; onAction: (request: HrRequest, action: ActionKind) => void; onPhotos: (request: HrRequest) => void }) {
  const droppable = useDroppable({ id: status });
  return (
    <div ref={droppable.setNodeRef} className="min-w-[265px] flex-1 rounded-lg bg-elev1 p-3">
      <div className="mb-3 flex items-center justify-between"><strong>{statusLabels[status]}</strong><Tag color={statusColors[status]}>{requests.length}</Tag></div>
      {requests.map((request) => <HrRequestCard key={request.feedback_id} request={request} onAction={onAction} onPhotos={onPhotos} />)}
      {!requests.length ? <div className="py-8 text-center text-sm text-ink-500">Немає заявок</div> : null}
    </div>
  );
}

export function AbsencesWorkspace({ stores, sellers, bootstrapError }: { stores: Store[]; sellers: Seller[]; bootstrapError: string | null }) {
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<Absence[]>([]);
  const [requests, setRequests] = useState<HrRequest[]>([]);
  const [error, setError] = useState<string | null>(bootstrapError);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [editingAbsence, setEditingAbsence] = useState<Absence | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [cancelAbsence, setCancelAbsence] = useState<Absence | null>(null);
  const [photoRequest, setPhotoRequest] = useState<HrRequest | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [topicFilter, setTopicFilter] = useState<RequestTopic | undefined>();
  const [storeFilter, setStoreFilter] = useState<number | undefined>();
  const [sellerFilter, setSellerFilter] = useState<string | undefined>();
  const [openOnly, setOpenOnly] = useState(false);
  const [manualForm] = Form.useForm();
  const [actionForm] = Form.useForm();
  const [cancelForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const requestParams = new URLSearchParams({ month });
      if (topicFilter) requestParams.set("topic", topicFilter);
      if (storeFilter) requestParams.set("storeId", String(storeFilter));
      if (sellerFilter) requestParams.set("sellerId", sellerFilter);
      const [absenceResponse, requestResponse] = await Promise.all([
        fetch("/api/admin/network/absences?month=" + month),
        fetch("/api/admin/network/absence-requests?" + requestParams.toString()),
      ]);
      const absenceBody = await absenceResponse.json();
      const requestBody = await requestResponse.json();
      if (!absenceResponse.ok) throw new Error(absenceBody.error ?? "Не вдалося завантажити відсутності");
      if (!requestResponse.ok) throw new Error(requestBody.error ?? "Не вдалося завантажити HR-заявки");
      setRows(absenceBody.absences ?? []);
      setRequests(requestBody.requests ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не вдалося завантажити дані");
    } finally {
      setLoading(false);
    }
  }, [month, sellerFilter, storeFilter, topicFilter]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (pendingAction) actionForm.resetFields(); }, [actionForm, pendingAction]);

  const displayedRequests = useMemo(() => openOnly ? requests.filter((request) => request.feedback_status === "new" || request.feedback_status === "in_progress") : requests, [openOnly, requests]);
  const calendarDays = useMemo(() => {
    const [year, monthNumber] = month.split("-").map(Number);
    return Array.from({ length: new Date(Date.UTC(year, monthNumber, 0)).getUTCDate() }, (_, index) => index + 1);
  }, [month]);
  const calendarRows = useMemo<CalendarRow[]>(() => {
    const grouped = new Map<string, CalendarRow>();
    for (const absence of rows.filter((row) => row.status === "active")) {
      const current = grouped.get(absence.employee_id) ?? {
        key: absence.employee_id, employee_full_name: absence.employee_full_name, store_name: absence.store_name, absences: [],
      };
      current.absences.push(absence);
      grouped.set(absence.employee_id, current);
    }
    return [...grouped.values()].sort((left, right) => left.employee_full_name.localeCompare(right.employee_full_name, "uk"));
  }, [rows]);

  const doAction = async (values: Record<string, unknown>) => {
    if (!pendingAction) return;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/network/absence-requests/" + pendingAction.request.feedback_id + "/" + pendingAction.action, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(values),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не вдалося обробити HR-заявку");
      setPendingAction(null);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Не вдалося обробити HR-заявку");
    } finally { setSaving(false); }
  };

  const saveAbsence = async (values: Record<string, unknown>) => {
    setSaving(true);
    try {
      const response = await fetch(editingAbsence ? "/api/admin/network/absences/" + editingAbsence.id : "/api/admin/network/absences", {
        method: editingAbsence ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editingAbsence ? { ...values, row_version: editingAbsence.row_version } : values),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не вдалося зберегти відсутність");
      setManualOpen(false); setEditingAbsence(null); manualForm.resetFields(); await load();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Не вдалося зберегти відсутність"); }
    finally { setSaving(false); }
  };

  const cancel = async (values: Record<string, unknown>) => {
    if (!cancelAbsence) return;
    setSaving(true);
    try {
      const response = await fetch("/api/admin/network/absences/" + cancelAbsence.id, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel", row_version: cancelAbsence.row_version, cancel_reason: values.cancel_reason }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не вдалося скасувати відсутність");
      setCancelAbsence(null); cancelForm.resetFields(); await load();
    } catch (cancelError) { setError(cancelError instanceof Error ? cancelError.message : "Не вдалося скасувати відсутність"); }
    finally { setSaving(false); }
  };

  const openPhotos = async (request: HrRequest) => {
    setPhotoRequest(request);
    setPhotoUrls([]);
    setPhotosLoading(true);
    try {
      const response = await fetch("/api/admin/feedback/" + request.feedback_id + "/photos");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не вдалося завантажити фото");
      setPhotoUrls(body.photos ?? []);
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : "Не вдалося завантажити фото");
    } finally { setPhotosLoading(false); }
  };

  const onDragEnd = (event: DragEndEvent) => {
    const request = event.active.data.current?.request as HrRequest | undefined;
    const target = String(event.over?.id ?? "") as RequestStatus;
    if (!request || !columns.includes(target) || target === request.feedback_status) return;
    if (request.feedback_status === "resolved" || request.feedback_status === "rejected" || target === "new") return;
    const action = target === "in_progress" ? "review" : target === "resolved" ? "approve" : target === "rejected" ? "reject" : null;
    if (action) setPendingAction({ request, action });
  };

  const absenceColumns = useMemo(() => [
    { title: "Продавчиня", dataIndex: "employee_full_name", key: "employee" },
    { title: "Магазин", dataIndex: "store_name", key: "store", render: (value: string | null) => value ?? "Не задано" },
    { title: "Тип", dataIndex: "absence_type", key: "type", render: (value: AbsenceType) => <Tag color={absenceColors[value]}>{absenceLabels[value]}</Tag> },
    { title: "Період", key: "dates", render: (_: unknown, row: Absence) => row.starts_on + " — " + row.ends_on },
    { title: "Джерело", key: "source", render: (_: unknown, row: Absence) => row.source_feedback_id ? <Tag color="blue">HR-заявка</Tag> : <Tag>Вручну</Tag> },
    { title: "Статус", dataIndex: "status", key: "status", render: (value: Absence["status"]) => <Tag color={value === "active" ? "green" : "default"}>{value === "active" ? "Активна" : "Скасована"}</Tag> },
    { title: "Дії", key: "actions", render: (_: unknown, row: Absence) => row.status === "active" ? <Space size={4}><Button size="small" onClick={() => { setEditingAbsence(row); manualForm.setFieldsValue({ employee_id: row.employee_id, store_id: row.store_id ?? undefined, absence_type: row.absence_type, starts_on: row.starts_on, ends_on: row.ends_on, note: row.note ?? undefined }); setManualOpen(true); }}>Редагувати</Button><Button size="small" danger onClick={() => setCancelAbsence(row)}>Скасувати</Button></Space> : "—" },
  ], []);

  const calendarColumns = useMemo(() => [
    { title: "Продавчиня", dataIndex: "employee_full_name", key: "employee", fixed: "left" as const, width: 170 },
    { title: "Магазин", dataIndex: "store_name", key: "store", fixed: "left" as const, width: 130, render: (value: string | null) => value ?? "Не задано" },
    ...calendarDays.map((day) => {
      const date = month + "-" + String(day).padStart(2, "0");
      const weekday = new Intl.DateTimeFormat("uk-UA", { weekday: "short", timeZone: "Europe/Kyiv" }).format(new Date(date + "T12:00:00Z"));
      return {
        title: <span className="text-xs">{day}<br />{weekday}</span>, key: date, width: 54, align: "center" as const,
        render: (_: unknown, row: CalendarRow) => {
          const absence = row.absences.find((item) => item.starts_on <= date && item.ends_on >= date);
          return absence ? <Tag color={absenceColors[absence.absence_type]} className="m-0 px-1 text-[10px]">{absence.absence_type === "vacation" ? "В" : absence.absence_type === "sick_leave" ? "Л" : "Вг"}</Tag> : null;
        },
      };
    }),
  ], [calendarDays, month]);

  const modalTitle = pendingAction ? ({ review: "Взяти HR-заявку в роботу", approve: "Погодити HR-заявку", reject: "Відхилити HR-заявку" }[pendingAction.action]) : "";

  return <div className="space-y-4">
    {error ? <Alert type="error" showIcon message="Графік відсутностей недоступний" description={error} closable onClose={() => setError(null)} /> : null}
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Space wrap>
          <label className="grid gap-1 text-sm text-ink-600">Місяць<Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
          <Select aria-label="Тип HR-заявки" allowClear placeholder="Усі типи" value={topicFilter} onChange={setTopicFilter} className="min-w-40" options={Object.entries(topicLabels).map(([value, label]) => ({ value, label }))} />
          <Select aria-label="Магазин" allowClear placeholder="Усі магазини" value={storeFilter} onChange={setStoreFilter} className="min-w-40" options={stores.map((store) => ({ value: store.id, label: store.name }))} />
          <Select aria-label="Продавчиня" allowClear showSearch optionFilterProp="label" placeholder="Усі продавчині" value={sellerFilter} onChange={setSellerFilter} className="min-w-48" options={sellers.map((seller) => ({ value: seller.id, label: seller.full_name }))} />
          <Button type={openOnly ? "primary" : "default"} onClick={() => setOpenOnly((value) => !value)}>Без рішення</Button>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingAbsence(null); manualForm.resetFields(); setManualOpen(true); }}>Додати відсутність</Button>
      </div>
    </Card>
    {loading ? <Card><div className="py-12 text-center"><Spin /></div></Card> : <Tabs defaultActiveKey="requests" items={[
      { key: "requests", label: "Заявки", children: <DndContext onDragEnd={onDragEnd}><div className="overflow-x-auto"><div className="grid min-w-[1100px] grid-cols-4 gap-3">{columns.map((status) => <KanbanColumn key={status} status={status} requests={displayedRequests.filter((request) => request.feedback_status === status)} onAction={(request, action) => setPendingAction({ request, action })} onPhotos={(request) => void openPhotos(request)} />)}</div></div></DndContext> },
      { key: "calendar", label: "Календар відсутностей", children: <Card title={"Відсутності за " + month}><Table rowKey="key" columns={calendarColumns} dataSource={calendarRows} scroll={{ x: 2100 }} pagination={{ pageSize: 30, hideOnSinglePage: true }} locale={{ emptyText: "У цьому місяці відсутностей немає" }} /></Card> },
      { key: "list", label: "Список", children: <Card title="Усі відсутності"><Table rowKey="id" columns={absenceColumns} dataSource={rows} pagination={{ pageSize: 30, hideOnSinglePage: true }} locale={{ emptyText: "У цьому місяці відсутностей немає" }} /></Card> },
    ]} />}

    <Modal destroyOnHidden open={manualOpen} title={editingAbsence ? "Редагувати відсутність" : "Додати відсутність"} okText="Зберегти" cancelText="Скасувати" confirmLoading={saving} onCancel={() => { setManualOpen(false); setEditingAbsence(null); manualForm.resetFields(); }} onOk={() => manualForm.submit()}>
      <Form form={manualForm} layout="vertical" onFinish={(values) => void saveAbsence(values)}>
        <Form.Item name="employee_id" label="Продавчиня" rules={[{ required: true }]}><Select showSearch optionFilterProp="label" options={sellers.map((seller) => ({ value: seller.id, label: seller.full_name }))} /></Form.Item>
        <Form.Item name="store_id" label="Магазин"><Select allowClear options={stores.map((store) => ({ value: store.id, label: store.name }))} /></Form.Item>
        <Form.Item name="absence_type" label="Тип" rules={[{ required: true }]}><Select options={Object.entries(absenceLabels).map(([value, label]) => ({ value, label }))} /></Form.Item>
        <Space className="grid grid-cols-2 gap-3"><Form.Item name="starts_on" label="Початок" rules={[{ required: true }]}><Input type="date" /></Form.Item><Form.Item name="ends_on" label="Кінець" rules={[{ required: true }]}><Input type="date" /></Form.Item></Space>
        <Form.Item name="note" label="Примітка"><Input.TextArea maxLength={500} /></Form.Item>
      </Form>
    </Modal>

    <Modal destroyOnHidden open={Boolean(pendingAction)} title={modalTitle} okText={pendingAction?.action === "reject" ? "Відхилити" : pendingAction?.action === "approve" ? "Погодити" : "Взяти в роботу"} okButtonProps={{ danger: pendingAction?.action === "reject" }} cancelText="Скасувати" confirmLoading={saving} onCancel={() => setPendingAction(null)} onOk={() => actionForm.submit()}>
      {pendingAction ? <Form form={actionForm} layout="vertical" onFinish={(values) => void doAction(values)}>
        <Descriptions size="small" column={1} items={[{ key: "seller", label: "Продавчиня", children: pendingAction.request.employee_full_name }, { key: "store", label: "Магазин", children: pendingAction.request.requested_store_name ?? "Не вказано" }, { key: "topic", label: "Заявка", children: topicLabels[pendingAction.request.hr_topic] }]} />
        {pendingAction.action === "approve" && pendingAction.request.hr_topic === "sick-leave" && !pendingAction.request.requested_date_to ? <Form.Item name="sick_ends_on" label="Дата завершення лікарняного" rules={[{ required: true }]}><Input type="date" /></Form.Item> : null}
        {pendingAction.action === "approve" ? <Form.Item name="note" label="Примітка HR"><Input.TextArea maxLength={500} /></Form.Item> : null}
        {pendingAction.action === "review" ? <Form.Item name="comment" label="Коментар продавчині"><Input.TextArea maxLength={500} /></Form.Item> : null}
        {pendingAction.action === "reject" ? <Form.Item name="reason" label="Причина відмови" rules={[{ required: true, min: 3, max: 500 }]}><Input.TextArea maxLength={500} /></Form.Item> : null}
      </Form> : null}
    </Modal>

    <Modal destroyOnHidden open={Boolean(cancelAbsence)} title="Скасувати відсутність" okText="Скасувати відсутність" okButtonProps={{ danger: true }} cancelText="Назад" confirmLoading={saving} onCancel={() => setCancelAbsence(null)} onOk={() => cancelForm.submit()}>
      <Form form={cancelForm} layout="vertical" onFinish={(values) => void cancel(values)}>
        <Form.Item name="cancel_reason" label="Причина скасування" rules={[{ required: true, min: 3, max: 500 }]}><Input.TextArea maxLength={500} /></Form.Item>
      </Form>
    </Modal>

    <Modal destroyOnHidden open={Boolean(photoRequest)} title={photoRequest ? "Фото довідки: " + photoRequest.employee_full_name : "Фото довідки"} footer={null} onCancel={() => setPhotoRequest(null)}>
      {photosLoading ? <div className="py-10 text-center"><Spin /></div> : photoUrls.length ? <div className="grid grid-cols-2 gap-3">{photoUrls.map((url) => <img key={url} src={url} alt="Фото довідки продавчині" className="h-40 w-full rounded object-cover" />)}</div> : <Alert type="info" showIcon message="Фото недоступні" />}
    </Modal>
  </div>;
}
