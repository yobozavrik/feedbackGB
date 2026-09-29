"use client";

import { Alert, Card, Input, Select, Space, Statistic, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { SupplyPriceReadModel, SupplyPriceRow } from "@/lib/admin/posterSupplyPrices";

const moneyFormat = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amountFormat = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 3 });
const unitLabel: Record<SupplyPriceRow["unit"], string> = { kg: "кг", l: "л", p: "шт" };

function money(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "Н/Д" : `${moneyFormat.format(value / 100)} ₴`;
}

function dateLabel(value: string | null): string {
  if (!value) return "Немає у знімку";
  const [date, time] = value.replace("T", " ").split(" ");
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year}${time ? ` ${time.slice(0, 5)}` : ""}`;
}

function priceDelta(value: number | null): ReactNode {
  if (value === null) return <Typography.Text type="secondary">Н/Д</Typography.Text>;
  const text = `${value > 0 ? "+" : ""}${moneyFormat.format(value / 100)} ₴`;
  return <Typography.Text type={value > 0 ? "danger" : value < 0 ? "success" : "secondary"}>{text}</Typography.Text>;
}

export function FoodCostSupplyPrices({ data }: { data: SupplyPriceReadModel }) {
  const [search, setSearch] = useState("");
  const [changeFilter, setChangeFilter] = useState<"all" | "increased" | "decreased" | "unchanged" | "no-comparison">("all");
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("uk");
    return data.rows.filter((row) => {
      const matchesText = !needle || (row.ingredientName ?? "").toLocaleLowerCase("uk").includes(needle) || String(row.ingredientId).includes(needle);
      const matchesChange = changeFilter === "all" ||
        (changeFilter === "no-comparison" && row.deltaMinor === null) ||
        (changeFilter === "increased" && row.deltaMinor !== null && row.deltaMinor > 0) ||
        (changeFilter === "decreased" && row.deltaMinor !== null && row.deltaMinor < 0) ||
        (changeFilter === "unchanged" && row.deltaMinor === 0);
      return matchesText && matchesChange;
    });
  }, [data.rows, search, changeFilter]);
  const columns: ColumnsType<SupplyPriceRow> = [
    { title: "Інгредієнт", key: "ingredient", fixed: "left", width: 270, render: (_, row) => <Space direction="vertical" size={0}>
      <Typography.Text>{row.ingredientName ?? `Інгредієнт #${row.ingredientId}`}</Typography.Text>
      <Typography.Text type="secondary" className="text-xs">Poster ID {row.ingredientId}{row.ingredientName ? " · назва з поточного каталогу Poster" : " · назву не знайдено в поточному каталозі"}</Typography.Text>
    </Space> },
    { title: "Од.", dataIndex: "unit", width: 70, render: (unit: SupplyPriceRow["unit"]) => unitLabel[unit] },
    { title: `Середньозважена · ${data.days} дн.`, dataIndex: "currentWeightedPriceMinor", width: 170,
      render: (value: number | null, row) => value === null ? <Typography.Text type="secondary">Немає закупівель</Typography.Text> : `${money(value)} / ${unitLabel[row.unit]}` },
    { title: "Попереднє рівне вікно", dataIndex: "previousWeightedPriceMinor", width: 180,
      render: (value: number | null, row) => value === null ? <Typography.Text type="secondary">{data.previous.status === "complete" ? "Немає закупівель" : "Н/Д · вікно недоступне"}</Typography.Text> : `${money(value)} / ${unitLabel[row.unit]}` },
    { title: "Зміна", dataIndex: "deltaMinor", width: 110, render: (value) => priceDelta(value) },
    { title: "Зміна, %", dataIndex: "deltaPercent", width: 105, render: (value: number | null) => value === null
      ? <Typography.Text type="secondary">Н/Д</Typography.Text>
      : <Typography.Text type={value > 0 ? "danger" : value < 0 ? "success" : "secondary"}>{value > 0 ? "+" : ""}{moneyFormat.format(value)} %</Typography.Text> },
    { title: `Остання накладна у знімку до ${dateLabel(data.snapshot?.to ?? null)}`, dataIndex: "lastPriceMinor", width: 240, render: (value: number | null, row) => value === null
      ? "Немає у знімку" : <Space direction="vertical" size={0}><span>{money(value)} / {unitLabel[row.unit]}</span><Typography.Text type="secondary" className="text-xs">Накладна {dateLabel(row.lastSupplyDate)} · #{row.lastSupplyId}</Typography.Text></Space> },
    { title: `Кількість · ${data.days} дн.`, dataIndex: "currentQuantity", width: 125, render: (value: number, row) => row.currentWeightedPriceMinor === null ? "—" : `${amountFormat.format(value)} ${unitLabel[row.unit]}` },
    { title: "Сума · грн", dataIndex: "currentSumMinor", width: 120, render: (value: number, row) => row.currentWeightedPriceMinor === null ? "—" : money(value) },
    { title: "Накладних", dataIndex: "currentSupplyCount", width: 100, render: (value: number, row) => row.currentWeightedPriceMinor === null ? "—" : value },
  ];

  return <Space direction="vertical" size="middle" className="w-full">
    <Alert type="info" showIcon message="Закупівельні ціни · не фудкост продажів"
      description="Середньозважена ціна розраховується як сума закупівлі ÷ кількість з накладних за календарною датою Poster. «Остання в знімку» — остання підтверджена накладна у збереженому знімку, це не ціна зараз. Дані охоплюють усю мережу; магазинний фільтр на закупівлі не поширюється." />
    {!data.snapshot ? <Alert type="warning" showIcon message="Немає перевіреного знімка накладних"
      description="Ціни не розраховано. Перевірте доступність повного завершеного знімка постачань." /> : <>
      <Card size="small" title="Покриття даних">
        <Space wrap size="large">
          <Statistic title="Поточне вікно" value={data.current.status === "complete" ? `${dateLabel(data.current.from)} — ${dateLabel(data.current.to)}` : "Н/Д"} />
          <Statistic title="Документів у вікні" value={data.current.documentCount} />
          <Statistic title="Позицій з назвою Poster" value={`${data.namedPurchasedIds} / ${data.purchasedIds}`} />
          <Statistic title="Повний знімок" value={`${data.snapshot.fetchedDocuments} / ${data.snapshot.expectedDocuments}`} />
          <Statistic title="Завершено" value={dateLabel(data.snapshot.completedAt.slice(0, 19).replace("T", " "))} />
        </Space>
        <Typography.Paragraph type="secondary" className="mb-0 mt-3">
          Знімок: {dateLabel(data.snapshot.from)} — {dateLabel(data.snapshot.to)}. Список охоплює інгредієнти з накладних; для {data.purchasedIds - data.namedPurchasedIds} з {data.purchasedIds} придбаних ID у поточному каталозі немає назви, тому показано ID. Історичні назви в накладних не зберігалися.
        </Typography.Paragraph>
      </Card>
      {data.status !== "complete" && <Alert type="warning" showIcon message="Поточне вікно не покривається знімком"
        description={`Період ${data.current.from} — ${data.current.to} недоступний за наявними накладними. Часткові підсумки не показано.`} />}
      {data.previous.status !== "complete" && <Alert type="warning" showIcon message="Попереднє рівне вікно недоступне"
        description={`Для ${data.days} днів потрібно ${data.previous.from} — ${data.previous.to}; знімок починається ${data.snapshot.from}. Попередня ціна та зміна показані як Н/Д.`} />}
      {data.status === "complete" && <Card size="small" title={<Space wrap><span>Інгредієнти з накладних</span><Tag>Закупівельна середньозважена ціна</Tag></Space>}>
        <Space direction="vertical" size="middle" className="w-full">
          <Space wrap className="w-full">
            <Input.Search aria-label="Пошук інгредієнта" className="min-w-64 flex-1" placeholder="Пошук за назвою або Poster ID" allowClear onChange={(event) => setSearch(event.target.value)} />
            <Select aria-label="Фільтр зміни закупівельної ціни" className="min-w-52" value={changeFilter}
              onChange={setChangeFilter} options={[{ value: "all", label: "Усі зміни" }, { value: "increased", label: "Ціна зросла" },
                { value: "decreased", label: "Ціна знизилась" }, { value: "unchanged", label: "Без зміни" }, { value: "no-comparison", label: "Без порівняння" }]} />
          </Space>
          <Table rowKey={(row) => `${row.ingredientId}:${row.unit}`} columns={columns} dataSource={rows} size="small"
            scroll={{ x: 1400 }} pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100], showTotal: (total) => `${total} інгредієнтів` }}
            locale={{ emptyText: search || changeFilter !== "all" ? "За обраними умовами нічого не знайдено" : "За обраний період закупівель немає" }} />
        </Space>
      </Card>}
    </>}
  </Space>;
}
