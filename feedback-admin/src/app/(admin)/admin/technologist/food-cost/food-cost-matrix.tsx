"use client";

import { useMemo, useState } from "react";
import { Alert, Card, Empty, Input, InputNumber, Segmented, Select, Space, Statistic, Table, Tag, Typography, theme as antdTheme } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { CommandCenterView } from "@/lib/admin/foodcostCommandCenter";
import { foodcostMatrixBand, foodcostMatrixCategoryOptions, foodcostMatrixDomain, foodcostMatrixFocusDomain, foodcostMatrixProfit, foodcostMatrixRate, foodcostMatrixViewport, normalizeFoodcostMatrixTableScope, selectFoodcostMatrixRows, type FoodcostMatrixDomain, type FoodcostMatrixMethod, type FoodcostMatrixProduct, type FoodcostMatrixTableScope, type FoodcostMatrixViewportMode } from "@/lib/admin/foodcostMatrix";
import { productHref } from "@/lib/admin/productCatalog";
import { parseFoodcostMatrixCategoryKey, parseFoodcostMatrixMethod, pushFoodcostMatrixUrlState,
  type FoodcostMatrixCategoryKey } from "@/lib/admin/foodcostMatrixUrl";
import { FoodcostRate, FoodcostStatusTag, formatFoodcostPercent } from "@/components/admin/foodcost/FoodcostStatus";

const amountFormat = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const countFormat = new Intl.NumberFormat("uk-UA");
const methodOptions = [
  { value: "profit", label: "За прибутком товарів" },
  { value: "netto", label: "Без ПДВ Poster" },
] as const;

function money(minor: number | null): string {
  return minor === null || !Number.isFinite(minor) ? "Н/Д" : `${amountFormat.format(minor / 100)} ₴`;
}

function cardHref(row: FoodcostMatrixProduct, spotId: number | null, days: number,
  method: FoodcostMatrixMethod, categoryKey: FoodcostMatrixCategoryKey): string {
  const params = new URLSearchParams({ tab: "foodcost", days: String(days), method, return_to: "matrix" });
  if (spotId !== null) params.set("spot_id", String(spotId));
  if (categoryKey !== "all") params.set("category_id", categoryKey);
  return `${productHref(row.productId)}?${params.toString()}`;
}

function ScatterMatrix({ rows, method, categoryKey, domain, onChoose, token, spotId, days }: {
  rows: FoodcostMatrixProduct[]; method: FoodcostMatrixMethod; onChoose: (row: FoodcostMatrixProduct) => void;
  categoryKey: FoodcostMatrixCategoryKey;
  domain: FoodcostMatrixDomain | null; token: ReturnType<typeof antdTheme.useToken>["token"]; spotId: number | null; days: number;
}) {
  const [active, setActive] = useState<FoodcostMatrixProduct | null>(null);
  if (!domain) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Немає товарів з оплаченою сумою та доступною обраною методикою для діаграми." />;
  const width = 1000;
  const height = 530;
  const margin = { left: 82, right: 28, top: 28, bottom: 66 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const yMin = domain.yMin === domain.yMax ? domain.yMin - 1 : domain.yMin;
  const yMax = domain.yMin === domain.yMax ? domain.yMax + 1 : domain.yMax;
  const xPos = (value: number) => margin.left + (value - domain.xMin) / (domain.xMax - domain.xMin) * plotWidth;
  const yPos = (valueMinor: number) => margin.top + (yMax - valueMinor / 100) / (yMax - yMin) * plotHeight;
  const xTicks = Array.from({ length: 6 }, (_, index) => domain.xMin + (domain.xMax - domain.xMin) * index / 5);
  const yTicks = Array.from({ length: 5 }, (_, index) => yMin + (yMax - yMin) * index / 4);
  const maxPaid = rows.reduce((maximum, row) => Math.max(maximum, row.payedSumMinor), 0);
  const colors = { green: token.colorSuccess, yellow: token.colorWarning, red: token.colorError };
  const details = (row: FoodcostMatrixProduct) => `${row.productName}${row.productNameConflict ? " (назва відрізняється між рядками)" : ""}; Poster ID ${row.productId}; оплачено ${money(row.payedSumMinor)}; прибуток для осі Y за обраною методикою ${money(foodcostMatrixProfit(row, method))}; прибуток без ПДВ Poster ${money(row.profitNettoMinor)}; фудкост за прибутком ${formatFoodcostPercent(row.foodCostPercent)}; фудкост без ПДВ ${formatFoodcostPercent(row.nettoFoodCostPercent)}.`;
  const selectPoint = (row: FoodcostMatrixProduct) => {
    setActive(row);
    if (row.currentCatalogPresent) onChoose(row);
  };

  return <Space direction="vertical" size="small" className="w-full">
    <div className="overflow-x-auto rounded-md border border-default">
      <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`Матриця фудкосту: X — ${methodOptions.find((item) => item.value === method)?.label}, Y — прибуток Poster у гривнях; розмір кола відповідає сумі paid.`}
        className="block min-w-[720px] w-full">
        <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} fill={token.colorBgContainer} stroke={token.colorBorderSecondary} />
        {xTicks.map((tick) => <g key={`xgrid:${tick}`}>
          <line x1={xPos(tick)} x2={xPos(tick)} y1={margin.top} y2={margin.top + plotHeight} stroke={token.colorBorderSecondary} strokeDasharray="3 4" />
          <text x={xPos(tick)} y={height - margin.bottom + 22} fill={token.colorTextSecondary} fontSize="12" textAnchor="middle">{amountFormat.format(tick)}%</text>
        </g>)}
        {yTicks.map((tick) => <g key={`ygrid:${tick}`}>
          <line x1={margin.left} x2={margin.left + plotWidth} y1={yPos(tick * 100)} y2={yPos(tick * 100)} stroke={token.colorBorderSecondary} strokeDasharray="3 4" />
          <text x={margin.left - 10} y={yPos(tick * 100) + 4} fill={token.colorTextSecondary} fontSize="12" textAnchor="end">{amountFormat.format(tick)} ₴</text>
        </g>)}
        {[35, 45].map((limit) => <g key={`limit:${limit}`}>
          <line x1={xPos(limit)} x2={xPos(limit)} y1={margin.top} y2={margin.top + plotHeight}
            stroke={limit === 35 ? token.colorWarning : token.colorError} strokeWidth="2" />
          <text x={xPos(limit) + 4} y={margin.top + 14} fill={limit === 35 ? token.colorWarning : token.colorError} fontSize="12">{limit}%</text>
        </g>)}
        {domain.yMin <= 0 && domain.yMax >= 0 && <line x1={margin.left} x2={margin.left + plotWidth} y1={yPos(0)} y2={yPos(0)} stroke={token.colorTextSecondary} strokeWidth="2" />}
        <text x={margin.left + plotWidth / 2} y={height - 16} fill={token.colorText} fontSize="13" textAnchor="middle">
          Фудкост · {methodOptions.find((item) => item.value === method)?.label}
        </text>
        <text transform={`translate(18 ${margin.top + plotHeight / 2}) rotate(-90)`} fill={token.colorText} fontSize="13" textAnchor="middle">Прибуток Poster · {method === "profit" ? "за прибутком" : "без ПДВ"}, ₴</text>
        {rows.map((row) => {
          const rate = foodcostMatrixRate(row, method);
          const profit = foodcostMatrixProfit(row, method);
          if (row.payedSumMinor <= 0 || rate === null || !Number.isFinite(rate) || profit === null || !Number.isFinite(profit)) return null;
          const radius = Math.max(3.5, Math.sqrt(row.payedSumMinor / maxPaid) * 13);
          const band = foodcostMatrixBand(row, method);
          const fill = band === "unknown" ? token.colorTextSecondary : colors[band];
          return <circle key={row.productId} cx={xPos(rate)} cy={yPos(profit)} r={radius}
            fill={fill} fillOpacity={0.78} stroke={token.colorBgContainer} strokeWidth="1.5"
            role="button" tabIndex={0} aria-label={details(row)} aria-describedby="foodcost-matrix-active-point"
            onMouseEnter={() => setActive(row)} onFocus={() => setActive(row)} onClick={() => selectPoint(row)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectPoint(row); } }}>
            <title>{details(row)}</title>
          </circle>;
        })}
      </svg>
    </div>
    <Space wrap size={[8, 4]}>
      <Tag color="success">&lt;35% · нижче межі</Tag><Tag color="warning">35–45% · зона уваги</Tag><Tag color="error">&gt;45% · вище межі</Tag>
      <Typography.Text type="secondary" className="text-xs">Вертикалі — 35% і 45%; горизонталь — прибуток 0 ₴. Площа кола зростає пропорційно оплаченої сумі.</Typography.Text>
    </Space>
    {active && <Card id="foodcost-matrix-active-point" size="small" title={active.productName} extra={<Typography.Text type="secondary">Poster ID {active.productId}</Typography.Text>}>
      <Space wrap size="large">
        <span>Оплачено: <strong>{money(active.payedSumMinor)}</strong></span>
        <span>Прибуток для осі Y: <strong>{money(foodcostMatrixProfit(active, method))}</strong></span>
        <span>Прибуток без ПДВ Poster: <strong>{money(active.profitNettoMinor)}</strong></span>
        <span>Фудкост за прибутком: <FoodcostRate value={active.foodCostPercent} /></span>
        <span>Фудкост без ПДВ: <FoodcostRate value={active.nettoFoodCostPercent} /></span>
        {active.currentCatalogPresent ? <Link href={cardHref(active, spotId, days, method, categoryKey)}>Відкрити картку продукту</Link>
          : <Tag>Продукт відсутній у поточному каталозі; картка недоступна</Tag>}
      </Space>
    </Card>}
  </Space>;
}

export function FoodCostMatrix({ data, days }: { data: CommandCenterView; days: number }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { token } = antdTheme.useToken();
  const matrix = data.matrix;
  const method = parseFoodcostMatrixMethod(searchParams.get("method"));
  const categoryKey = parseFoodcostMatrixCategoryKey(searchParams.get("category_id"));
  const [search, setSearch] = useState("");
  const [minimumPaid, setMinimumPaid] = useState<number | null>(0);
  const [viewportMode, setViewportMode] = useState<FoodcostMatrixViewportMode>("focus");
  const [tableScope, setTableScope] = useState<FoodcostMatrixTableScope>("all");
  const selection = useMemo(() => selectFoodcostMatrixRows(matrix?.products ?? [], {
    method, categoryKey, search, minimumPaidMinor: Math.round((minimumPaid ?? 0) * 100),
  }), [matrix?.products, method, categoryKey, search, minimumPaid]);
  const changeStore = (value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("spot_id", value);
    router.push(`${url.pathname}${url.search}`);
  };
  const openProduct = (row: FoodcostMatrixProduct) => {
    if (!row.currentCatalogPresent) return;
    const url = new URL(cardHref(row, data.selectedSpotId, days, method, categoryKey), window.location.origin);
    router.push(`${url.pathname}${url.search}`);
  };
  const shownMethodName = methodOptions.find((item) => item.value === method)!.label;
  const columns: ColumnsType<FoodcostMatrixProduct> = [
    { title: "Продукт", dataIndex: "productName", fixed: "left", width: 270, render: (_value, row) => <Space wrap>
      {row.currentCatalogPresent ? <Link href={cardHref(row, data.selectedSpotId, days, method, categoryKey)}>{row.productName}</Link>
        : <Typography.Text>{row.productName}</Typography.Text>}
      <Typography.Text type="secondary">#{row.productId}</Typography.Text>
      {row.productNameConflict && <Tag>Назва відрізнялась у періоді</Tag>}
      {row.categoryConflict && <Tag>Категорія різнилась у модифікаціях</Tag>}
    </Space> },
    { title: "Категорія", dataIndex: "categoryName", width: 220 },
    { title: "Оплачено · грн", dataIndex: "payedSumMinor", align: "right", width: 140, sorter: (a, b) => a.payedSumMinor - b.payedSumMinor, render: money },
    { title: `Прибуток Poster · ${shownMethodName} · грн`, dataIndex: "profitMinor", align: "right", width: 210,
      sorter: (a, b) => (foodcostMatrixProfit(a, method) ?? Number.NEGATIVE_INFINITY) - (foodcostMatrixProfit(b, method) ?? Number.NEGATIVE_INFINITY),
      render: (_value, row) => money(foodcostMatrixProfit(row, method)) },
    { title: "Фудкост · за прибутком", dataIndex: "foodCostPercent", align: "right", width: 170, render: (value: number | null) => <><FoodcostRate value={value} /><FoodcostStatusTag value={value} /></> },
    { title: "Фудкост · без ПДВ Poster", dataIndex: "nettoFoodCostPercent", align: "right", width: 180, render: (value: number | null) => <><FoodcostRate value={value} /><FoodcostStatusTag value={value} /></> },
  ];
  const methodMissing = selection.missingSelectedMethod;
  const fullDomain = useMemo(() => foodcostMatrixDomain(selection.chartRows, method), [selection.chartRows, method]);
  const focusDomain = useMemo(() => foodcostMatrixFocusDomain(selection.chartRows, method), [selection.chartRows, method]);
  const activeDomain = viewportMode === "focus" ? focusDomain : fullDomain;
  const viewport = useMemo(() => foodcostMatrixViewport(selection.chartRows, method, activeDomain),
    [selection.chartRows, method, activeDomain]);
  const outsideIds = useMemo(() => new Set(viewport.outside.map((row) => row.productId)), [viewport.outside]);
  if (data.status !== "complete" || !matrix) return <Alert type="warning" showIcon message="Повний знімок продуктів недоступний"
    description={`${data.dateFrom} — ${data.dateTo}: ${countFormat.format(data.completedCells)} із ${countFormat.format(data.expectedCells)} пар дата × магазин. Матрицю за неповними даними не будуємо.`} />;

  const tableRows = tableScope === "outside" ? selection.rows.filter((row) => outsideIds.has(row.productId)) : selection.rows;
  const categoryOptions = foodcostMatrixCategoryOptions(matrix.categories, categoryKey);

  return <Space direction="vertical" size="middle" className="w-full">
    <Alert type="info" showIcon message={`Матриця продуктів · ${data.dateFrom} — ${data.dateTo}`}
      description={`Той самий повний snapshot, що й Огляд. Точки агреговані за Poster product_id з усіма модифікаціями; X — фудкост за методом «${shownMethodName}», Y — прибуток того самого методу Poster, розмір — оплачено. Поріг прибутковості не задано, тому квадрантів і бізнес-рекомендацій немає.`} />
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1"><Typography.Text type="secondary">Магазин</Typography.Text>
        <Select aria-label="Магазин матриці" className="min-w-52" value={data.selectedSpotId === null ? "all" : String(data.selectedSpotId)}
          onChange={changeStore} options={[{ value: "all", label: "Уся мережа" }, ...data.stores.map((store) => ({ value: String(store.id), label: store.name }))]} />
      </div>
      <div className="flex flex-col gap-1"><Typography.Text type="secondary">Методика X</Typography.Text>
        <Select aria-label="Методика фудкосту на осі X" className="min-w-56" value={method} onChange={(value: FoodcostMatrixMethod) => {
          pushFoodcostMatrixUrlState(window.history, window.location.href, { method: value });
        }} options={methodOptions.map((item) => ({ ...item }))} />
      </div>
      <div className="flex flex-col gap-1"><Typography.Text type="secondary">Категорія</Typography.Text>
        <Select aria-label="Категорія матриці" className="min-w-56" value={categoryOptions.some((item) => item.value === categoryKey) ? categoryKey : "all"}
          onChange={(value) => pushFoodcostMatrixUrlState(window.history, window.location.href, {
            categoryKey: parseFoodcostMatrixCategoryKey(value),
          })} options={categoryOptions} />
      </div>
      <div className="flex flex-col gap-1"><Typography.Text type="secondary">Мінімум оплачено</Typography.Text>
        <InputNumber aria-label="Мінімум оплачено для відсікання малих продажів" min={0} precision={2} value={minimumPaid}
          onChange={(value) => setMinimumPaid(value)} addonAfter="₴" />
      </div>
      <Input.Search aria-label="Пошук продукту матриці" className="min-w-64 flex-1" placeholder="Пошук за назвою або Poster ID" allowClear onChange={(event) => setSearch(event.target.value)} />
    </div>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Card size="small"><Statistic title="У фільтрі" value={selection.totalInScope} suffix="товарів" /></Card>
      <Card size="small"><Statistic title="У межах графіка / доступні" value={`${viewport.visible.length} / ${selection.chartRows.length}`} suffix="точок" /></Card>
      <Card size="small"><Statistic title="Без оплаченої суми" value={selection.nonPositivePaid} suffix="товарів" /></Card>
      <Card size="small"><Statistic title={`Фудкост недоступний · ${shownMethodName}`} value={selection.missingSelectedMethod} suffix="товарів" /></Card>
    </div>
    {selection.filteredOutByMinimum > 0 && <Alert type="info" showIcon message={`Відсічено за мінімумом оплачено: ${countFormat.format(selection.filteredOutByMinimum)} товарів`}
      description={`Поточне значення порога: ${money(Math.round((minimumPaid ?? 0) * 100))}. Зменште поріг, щоб повернути їх у таблицю та діаграму.`} />}
    {methodMissing > 0 && <Alert type="warning" showIcon message={`Для ${shownMethodName} бракує прибутку або фудкосту у ${countFormat.format(methodMissing)} товарів`}
      description="Їх залишено в таблиці як Н/Д, але не вигадано координату X чи Y і не додано до діаграми." />}
    <Card size="small" title={`Фудкост проти прибутку · ${shownMethodName}`}>
      <Space direction="vertical" size="small" className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented aria-label="Масштаб діаграми матриці" value={viewportMode} onChange={(value) => {
            const nextMode = value as FoodcostMatrixViewportMode;
            setViewportMode(nextMode);
            setTableScope((current) => normalizeFoodcostMatrixTableScope(current, nextMode));
          }}
            options={[{ label: "Фокус 0–100%", value: "focus" }, { label: "Увесь діапазон", value: "full" }]} />
          <Typography.Text type="secondary">Вісь X: {amountFormat.format(activeDomain?.xMin ?? 0)}–{amountFormat.format(activeDomain?.xMax ?? 0)}%; вісь Y: {amountFormat.format(activeDomain?.yMin ?? 0)}–{amountFormat.format(activeDomain?.yMax ?? 0)} ₴</Typography.Text>
        </div>
        {viewportMode === "focus" && viewport.outside.length > 0 && <Alert type="warning" showIcon message={`${countFormat.format(viewport.outside.length)} точок поза фокусним вікном`}
          description={`Фокус обрізає лише область відображення: X 0–100%; Y від ${amountFormat.format(activeDomain?.yMin ?? 0)} до 95-го перцентиля позитивного прибутку (${amountFormat.format(activeDomain?.yMax ?? 0)} ₴). Усі точки залишаються в таблиці. Перемкніть «Увесь діапазон» або відфільтруйте таблицю за точками поза фокусом.`} />}
        <ScatterMatrix key={`${days}:${data.selectedSpotId ?? "all"}:${method}:${categoryKey}`}
          rows={viewport.visible} method={method} categoryKey={categoryKey} domain={activeDomain} token={token}
          onChoose={openProduct} spotId={data.selectedSpotId} days={days} />
      </Space>
    </Card>
    <Card size="small" title="Товари у вибраному зрізі">
      <Typography.Paragraph type="secondary" className="mb-3">Фудкост = (оплачено − відповідний прибуток Poster) ÷ оплачено × 100; у методиці без ПДВ використовується product_profit_netto. Перемикання методики змінює і X, і Y, але знаменник лишається paid. Один продукт зводить усі рядки модифікацій за поточними правилами «Позиції».</Typography.Paragraph>
      <div className="mb-3 flex flex-wrap items-center gap-3"><Typography.Text>Показати:</Typography.Text><Segmented aria-label="Фільтр таблиці матриці"
        value={tableScope} onChange={(value) => setTableScope(value as FoodcostMatrixTableScope)}
        options={[{ label: `Усі товари (${selection.rows.length})`, value: "all" }, { label: `Поза фокусом (${viewport.outside.length})`, value: "outside", disabled: viewport.outside.length === 0 }]} /></div>
      <Table rowKey="productId" columns={columns} dataSource={tableRows} size="small" scroll={{ x: 1150 }}
        pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (total) => `${countFormat.format(total)} товарів` }}
        locale={{ emptyText: search ? "За пошуком нічого не знайдено" : "У цьому зрізі товарів немає" }} />
    </Card>
  </Space>;
}
