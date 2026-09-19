import { CalendarOutlined, InfoCircleOutlined } from "@ant-design/icons";

interface PlannedDataPlaceholderProps {
  title: string;
  description: string;
  scope: "network" | "production";
}

/**
 * Honest first-stage screen: navigation is ready, but no source, API, or
 * database schema has been approved for this data yet. It deliberately does
 * not fabricate counters, schedules, workshops, or supplies.
 */
export function PlannedDataPlaceholder({
  title,
  description,
  scope,
}: PlannedDataPlaceholderProps) {
  const scopeLabel = scope === "network" ? "мережі магазинів" : "виробництва";

  return (
    <div className="card p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <CalendarOutlined style={{ fontSize: 25 }} />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-ink-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-[14px] leading-6 text-ink-500">
        {description}
      </p>
      <div className="mx-auto mt-5 flex max-w-xl items-start gap-2 rounded-card bg-elev2 p-4 text-left text-[13px] leading-5 text-ink-700">
        <InfoCircleOutlined className="mt-0.5 text-brand-600" />
        <span>
          Джерело даних для {scopeLabel} ще не підключено. Тут не показуються
          тестові графіки, KPI або статуси, щоб не вводити команду в оману.
        </span>
      </div>
    </div>
  );
}
