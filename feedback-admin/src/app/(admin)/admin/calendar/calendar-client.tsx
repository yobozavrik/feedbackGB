"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/uk";
import ukUA from "antd/locale/uk_UA";
import { Alert, App, Button, Calendar, Card, ConfigProvider, Empty, Form, Input, List, Modal, Select, Space, Spin, Tag, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import type { CalendarTask } from "@/lib/admin/calendar";

type Values = { title: string; description: string; due_at: string; remind_at?: string; status: "planned" | "done" };
const localTime = (value: string) => dayjs(value).format("YYYY-MM-DDTHH:mm");
export function CalendarClient() {
  const { message } = App.useApp();
  const [day, setDay] = useState(() => dayjs());
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<CalendarTask | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<Values>();
  const sequence = useRef(0);
  const month = day.format("YYYY-MM");
  const load = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    try {
      const start = dayjs(`${month}-01`).locale("uk").startOf("month").startOf("week");
      const end = dayjs(`${month}-01`).locale("uk").endOf("month").endOf("week").add(1, "day").startOf("day");
      const params = new URLSearchParams({ from: start.toISOString(), to: end.toISOString() });
      const response = await fetch(`/api/admin/calendar?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не вдалося завантажити календар");
      if (request === sequence.current) { setTasks(data.tasks); setError(null); }
    } catch (e) {
      if (request === sequence.current) { setTasks([]); setError(e instanceof Error ? e.message : "Помилка мережі"); }
    } finally { if (request === sequence.current) setLoading(false); }
  }, [month]);
  useEffect(() => { const requests = sequence; void load(); return () => { requests.current++; }; }, [load]);
  function edit(task: CalendarTask | null) {
    setEditing(task);
    form.setFieldsValue(task ? { ...task, due_at: localTime(task.due_at), remind_at: task.remind_at ? localTime(task.remind_at) : "" } :
      { title: "", description: "", due_at: day.hour(9).minute(0).format("YYYY-MM-DDTHH:mm"), remind_at: "", status: "planned" });
    setOpen(true);
  }
  async function save(values: Values) {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/calendar", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        ...values, due_at: new Date(values.due_at).toISOString(), remind_at: values.remind_at ? new Date(values.remind_at).toISOString() : null,
        ...(editing ? { id: editing.id, row_version: editing.row_version } : {}),
      }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не вдалося зберегти задачу");
      setOpen(false); message.success("Задачу збережено"); await load();
    } catch (e) { message.error(e instanceof Error ? e.message : "Помилка мережі"); }
    finally { setSaving(false); }
  }
  const selected = tasks.filter(task => dayjs(task.due_at).isSame(day, "day"));
  return <ConfigProvider locale={ukUA}>
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert type="info" showIcon message="Це ваш особистий календар" description={`Інші адміністратори не бачать ці задачі. Час: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Нагадування показуються в адмінці, поки вона відкрита; при поверненні — пропущені.`} />
      {error && <Alert type="error" showIcon message={error} action={<Button onClick={() => void load()}>Повторити</Button>} />}
      <Space wrap><Button type="primary" icon={<PlusOutlined />} onClick={() => edit(null)} disabled={Boolean(error) || loading}>Додати задачу</Button><Button onClick={() => void load()}>Оновити</Button></Space>
      <Spin spinning={loading}><Card>
        <Calendar value={day.locale("uk")} onSelect={setDay} cellRender={(date, info) => {
          if (info.type !== "date") return info.originNode;
          const items = tasks.filter(task => dayjs(task.due_at).isSame(date, "day"));
          return <>{items.slice(0, 3).map(task => <div key={task.id}>
            <Button type="text" size="small" style={{ maxWidth: "100%", overflow: "hidden" }} onClick={event => { event.stopPropagation(); edit(task); }}>
              <Tag color={task.status === "done" ? "green" : "blue"}>{dayjs(task.due_at).format("HH:mm")}</Tag>{task.title}
            </Button>
          </div>)}{items.length > 3 && <Typography.Text type="secondary">Ще {items.length - 3} · оберіть день</Typography.Text>}</>;
        }} />
      </Card></Spin>
      <Card title={`Задачі на ${day.format("DD.MM.YYYY")} · ${selected.length}`}>
        {selected.length === 0 ? <Empty description="Немає задач на цей день" /> : <List dataSource={selected} renderItem={task => <List.Item actions={[<Button key="edit" onClick={() => edit(task)}>Редагувати</Button>]}>
          <List.Item.Meta title={<Space wrap><Tag color={task.status === "done" ? "green" : "blue"}>{task.status === "done" ? "Виконано" : "Заплановано"}</Tag><Typography.Text>{dayjs(task.due_at).format("HH:mm")} · {task.title}</Typography.Text></Space>}
            description={<>{task.description}{task.remind_at && <div>Нагадування: {dayjs(task.remind_at).format("DD.MM.YYYY HH:mm")}</div>}</>} />
        </List.Item>} />}
      </Card>
    </Space>
    <Modal title={editing ? "Редагувати задачу" : "Нова задача"} open={open} onCancel={() => { if (!saving) setOpen(false); }} footer={null} forceRender>
      <Form form={form} layout="vertical" onFinish={save}>
        <Form.Item name="title" label="Назва" rules={[{ required: true, whitespace: true, max: 200 }]}><Input maxLength={200} /></Form.Item>
        <Form.Item name="description" label="Опис"><Input.TextArea maxLength={2000} rows={3} /></Form.Item>
        <Form.Item name="due_at" label="Дата і час задачі" rules={[{ required: true }]}><Input type="datetime-local" /></Form.Item>
        <Form.Item name="remind_at" label="Нагадати (не пізніше часу задачі)"><Input type="datetime-local" /></Form.Item>
        <Form.Item name="status" label="Статус"><Select options={[{ value: "planned", label: "Заплановано" }, { value: "done", label: "Виконано" }]} /></Form.Item>
        <Button type="primary" htmlType="submit" loading={saving}>Зберегти</Button>
      </Form>
    </Modal>
  </ConfigProvider>;
}
