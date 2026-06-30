"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import {
  Space,
  Select,
  Card,
  Row,
  Col,
  Statistic,
  Table,
  Spin,
  Alert,
  Tabs,
  Tag,
  Typography,
  theme as antdTheme,
} from "antd";
import type { AnalyticsUserOpt } from "./page";

const { Text, Title } = Typography;

interface Interaction {
  id: string;
  page_path: string;
  element_tag: string | null;
  element_id: string | null;
  element_text: string | null;
  x_ratio: number;
  y_ratio: number;
  viewport_w: number | null;
  viewport_h: number | null;
  created_at: string;
  user_id: string | null;
  users: {
    full_name: string;
    display_label: string | null;
  } | null;
}

interface Props {
  users: AnalyticsUserOpt[];
}

export function AnalyticsClient({ users }: Props) {
  const { token } = antdTheme.useToken();
  const [selectedUser, setSelectedUser] = useState<string | undefined>(undefined);
  const [selectedPage, setSelectedPage] = useState<string>("/login");
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [loading, setLoading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Fetch interactions based on filters
  useEffect(() => {
    let active = true;
    async function loadData() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (selectedUser) params.append("user_id", selectedUser);
        params.append("page_path", selectedPage);
        params.append("limit", "2000");

        const res = await fetch(`/api/admin/analytics/interactions?${params.toString()}`);
        if (!res.ok) throw new Error("API error");
        const data = await res.json();
        if (active) {
          setInteractions(data.interactions || []);
        }
      } catch (err) {
        console.error("Failed to load interactions:", err);
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadData();
    return () => {
      active = false;
    };
  }, [selectedUser, selectedPage]);

  // Draw Heatmap on Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    if (interactions.length === 0) return;

    // Draw Heatmap spots
    interactions.forEach((pt) => {
      const x = pt.x_ratio * width;
      const y = pt.y_ratio * height;

      // Draw radial gradient for beautiful glowing heat spots
      const radius = 22;
      const grad = ctx.createRadialGradient(x, y, 2, x, y, radius);
      
      // Warm pink/orange palette
      grad.addColorStop(0, "rgba(255, 30, 80, 0.7)");
      grad.addColorStop(0.3, "rgba(255, 110, 0, 0.45)");
      grad.addColorStop(0.6, "rgba(255, 210, 0, 0.2)");
      grad.addColorStop(1, "rgba(255, 255, 0, 0)");

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fill();
    });
  }, [interactions]);

  // Aggregated Stats
  const stats = useMemo(() => {
    const total = interactions.length;
    const elementClicks = new Map<string, { tag: string; text: string; count: number }>();

    interactions.forEach((item) => {
      const key = `${item.element_tag || "DIV"}:${item.element_id || ""}:${item.element_text || ""}`;
      const existing = elementClicks.get(key) || {
        tag: item.element_tag || "HTML",
        text: item.element_text || (item.element_id ? `#${item.element_id}` : "Клік на порожнечу"),
        count: 0,
      };
      existing.count += 1;
      elementClicks.set(key, existing);
    });

    const topElements = Array.from(elementClicks.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return { total, topElements };
  }, [interactions]);

  return (
    <Row gutter={[24, 24]}>
      {/* Filters Sidebar */}
      <Col span={24}>
        <Card bordered={false} className="shadow-soft">
          <Space size={16} wrap style={{ width: "100%", justifyContent: "space-between" }}>
            <Space size={16} wrap>
              <div>
                <Text type="secondary" style={{ display: "block", marginBottom: 6, fontSize: 12 }}>
                  Користувач для аналізу
                </Text>
                <Select
                  showSearch
                  allowClear
                  placeholder="Усі користувачі"
                  style={{ width: 280 }}
                  value={selectedUser}
                  onChange={setSelectedUser}
                  optionFilterProp="children"
                  filterOption={(input, option) =>
                    String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                  }
                  options={[
                    { label: "Усі користувачі", value: "" },
                    ...users.map((u) => ({
                      label: u.display_label ? `${u.display_label} (${u.full_name})` : u.full_name,
                      value: u.id,
                    })),
                  ]}
                />
              </div>

              <div>
                <Text type="secondary" style={{ display: "block", marginBottom: 6, fontSize: 12 }}>
                  Екран Mini App
                </Text>
                <Select
                  style={{ width: 240 }}
                  value={selectedPage}
                  onChange={setSelectedPage}
                  options={[
                    { label: "Екран входу (PIN-код)", value: "/login" },
                    { label: "Головна (Форма відгуку)", value: "/" },
                  ]}
                />
              </div>
            </Space>

            <Statistic
              title="Кліків завантажено"
              value={stats.total}
              valueStyle={{ color: token.colorPrimary, fontWeight: "bold" }}
            />
          </Space>
        </Card>
      </Col>

      {/* Heatmap Visualizer */}
      <Col xs={24} md={10} lg={9} xl={8} style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ position: "relative", width: 340, height: 600 }} className="phone-container">
          {/* Mobile phone frame */}
          <div className="absolute inset-0 border-[8px] border-slate-800 rounded-[36px] bg-slate-950 shadow-2xl pointer-events-none z-30" />
          {/* Inner screen container */}
          <div className="absolute inset-[8px] rounded-[28px] overflow-hidden bg-slate-100 z-10 select-none">
            {/* 1. LOGIN SCREEN MOCKUP */}
            {selectedPage === "/login" && (
              <div className="h-full flex flex-col items-center justify-center bg-white px-4 pb-8 pt-10 text-center font-sans text-slate-800">
                <div className="text-3xl mb-1">🌸</div>
                <div className="text-[20px] font-bold tracking-tight text-slate-900 font-display leading-none">
                  Галя слухає
                </div>
                <div className="text-[12px] text-slate-400 mt-1">Введи свій PIN</div>
                
                {/* Dots indicator */}
                <div className="flex gap-2.5 mt-6 mb-4">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <span key={i} className="h-3 w-3 rounded-full border border-slate-300 bg-slate-50" />
                  ))}
                </div>

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-3.5 mt-2 max-w-[210px]">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].map((key, i) => (
                    <div
                      key={i}
                      className={`h-[50px] w-[50px] rounded-full flex items-center justify-center text-[18px] font-medium ${
                        key === "OK"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-50 text-slate-800 border border-slate-200/50"
                      }`}
                    >
                      {key}
                    </div>
                  ))}
                </div>
                <div className="text-[10px] text-slate-400 mt-8 max-w-[180px] leading-tight">
                  Якщо забула PIN — попроси адміна в чаті.
                </div>
              </div>
            )}

            {/* 2. MAIN FEEDBACK FORM MOCKUP */}
            {selectedPage === "/" && (
              <div className="h-full flex flex-col bg-slate-50 px-3 py-4 text-left font-sans text-[12px] text-slate-800 overflow-y-auto">
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="font-bold text-slate-900">🌸 Галя слухає</span>
                  <span className="text-[10px] bg-slate-200 px-1.5 py-0.5 rounded text-slate-600">Магазин 18</span>
                </div>

                {/* Categories */}
                <div className="mt-3">
                  <div className="font-medium text-slate-500 mb-1.5">Категорія фідбеку</div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { name: "Не вистачає", color: "bg-rose-100" },
                      { name: "Постачання", color: "bg-orange-100" },
                      { name: "Ідея", color: "bg-emerald-100" },
                      { name: "Підгледіла", color: "bg-sky-100" },
                      { name: "Поломка", color: "bg-amber-100" },
                      { name: "Голос клієнта", color: "bg-indigo-100" },
                    ].map((cat, i) => (
                      <div
                        key={i}
                        className={`p-2 rounded-lg border border-slate-200 text-center font-medium ${cat.color}`}
                      >
                        {cat.name}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Comment Textarea */}
                <div className="mt-3">
                  <div className="font-medium text-slate-500 mb-1">Коментар</div>
                  <div className="h-14 bg-white border border-slate-200 rounded-lg p-1.5 text-slate-300">
                    Опишіть ситуацію детальніше...
                  </div>
                </div>

                {/* Photo Attach */}
                <div className="mt-3 bg-white border border-dashed border-slate-300 rounded-lg p-2.5 text-center text-slate-400">
                  📸 Додати фото
                </div>

                {/* Submit button */}
                <div className="mt-auto pt-3">
                  <div className="h-9 bg-rose-500 text-white rounded-lg flex items-center justify-center font-bold text-[13px]">
                    Надіслати фідбек
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Canvas Overlay for Heatmap drawing */}
          <canvas
            ref={canvasRef}
            width={324}
            height={584}
            style={{
              position: "absolute",
              left: 8,
              top: 8,
              width: "calc(100% - 16px)",
              height: "calc(100% - 16px)",
              zIndex: 20,
              pointerEvents: "none",
              borderRadius: "28px",
            }}
          />
        </div>
      </Col>

      {/* Click Analytics Sidebar */}
      <Col xs={24} md={14} lg={15} xl={16}>
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <Card title="Популярні елементи для натискання" bordered={false} className="shadow-soft">
              {stats.total === 0 ? (
                <Alert
                  message="Немає даних"
                  description="За вказаними фільтрами не знайдено зафіксованих кліків."
                  type="info"
                  showIcon
                />
              ) : (
                <Table
                  dataSource={stats.topElements.map((item, idx) => ({ ...item, key: idx }))}
                  pagination={false}
                  size="small"
                  columns={[
                    {
                      title: "Елемент",
                      dataIndex: "text",
                      render: (text, row) => (
                        <Space>
                          <Tag color="cyan">{row.tag}</Tag>
                          <Text strong>{text}</Text>
                        </Space>
                      ),
                    },
                    {
                      title: "Кількість натискань",
                      dataIndex: "count",
                      align: "right",
                      width: 180,
                      render: (count) => (
                        <Text strong style={{ color: token.colorPrimary }}>
                          {count}
                        </Text>
                      ),
                    },
                  ]}
                />
              )}
            </Card>
          </Col>

          {/* Guidelines info */}
          <Col span={24}>
            <Card title="Як читати теплову карту?" bordered={false} className="shadow-soft">
              <div className="text-[13px] leading-relaxed text-ink-600 space-y-2">
                <p>
                  📍 <strong>Червоні та оранжеві зони</strong> на макеті смартфона зліва показують найвищу щільність кліків. Жовті та прозорі ореоли відображають менш часті натискання.
                </p>
                <p>
                  💻 Дані збираються асинхронно через клієнтську бібліотеку перехоплення подій у реальному часі. Координати зберігаються як відсоток від ширини та висоти екрану (`x_ratio` та `y_ratio`), тому вони ідеально масштабуються на будь-яких розмірах дисплеїв.
                </p>
                <p>
                  🔒 Дані доступні лише для супер-адміністратора та використовуються для аналізу UX-перешкод, наприклад, помилок вводу PIN-коду чи промахів повз кнопки категорій.
                </p>
              </div>
            </Card>
          </Col>
        </Row>
      </Col>
    </Row>
  );
}
