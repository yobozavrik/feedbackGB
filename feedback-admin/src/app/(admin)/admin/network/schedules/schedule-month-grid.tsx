"use client";

import { EditOutlined } from "@ant-design/icons";
import { Button, Tag, Tooltip } from "antd";
import type { DragEvent } from "react";
import { useMemo, useState } from "react";
import { kyivDateTimeParts, kyivMonthDates, moveSameDayShiftToKyivDate } from "@/lib/scheduleTime";
import type { ScheduleStore, Shift } from "./schedule-workspace";

export interface GridMoveRequest {
  shift: Shift;
  targetDate: string;
  targetStoreId: number;
  startsAt: string;
  endsAt: string;
}

interface Props {
  stores: ScheduleStore[];
  month: string;
  shifts: Shift[];
  readonly: boolean;
  onRequestMove: (request: GridMoveRequest) => void;
  onEdit: (shift: Shift) => void;
  onError: (message: string) => void;
}

function dayLabel(date: string) {
  const weekday = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", weekday: "short" }).format(new Date(`${date}T12:00:00Z`));
  return { day: date.slice(-2), weekday: weekday.slice(0, 2) };
}

function shiftHours(shift: Shift) {
  return `${kyivDateTimeParts(shift.starts_at).time}–${kyivDateTimeParts(shift.ends_at).time}`;
}

function isOvernight(shift: Shift) {
  return kyivDateTimeParts(shift.starts_at).date !== kyivDateTimeParts(shift.ends_at).date;
}

export function ScheduleMonthGrid({ stores, month, shifts, readonly, onRequestMove, onEdit, onError }: Props) {
  const [draggedShift, setDraggedShift] = useState<Shift | null>(null);
  const dates = useMemo(() => kyivMonthDates(month), [month]);
  const scheduledByCell = useMemo(() => {
    const cells = new Map<string, Shift[]>();
    shifts.filter((shift) => shift.shift_status === "scheduled").forEach((shift) => {
      const date = kyivDateTimeParts(shift.starts_at).date;
      const key = `${shift.store_id}:${date}`;
      cells.set(key, [...(cells.get(key) ?? []), shift]);
    });
    return cells;
  }, [shifts]);

  const startDrag = (event: DragEvent<HTMLDivElement>, shift: Shift) => {
    if (readonly || isOvernight(shift)) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", shift.shift_id);
    setDraggedShift(shift);
  };

  const dropInto = (event: DragEvent<HTMLDivElement>, targetStoreId: number, targetDate: string) => {
    event.preventDefault();
    const shift = draggedShift;
    setDraggedShift(null);
    if (!shift || readonly) return;
    const currentDate = kyivDateTimeParts(shift.starts_at).date;
    if (shift.store_id === targetStoreId && currentDate === targetDate) return;
    try {
      const interval = moveSameDayShiftToKyivDate(shift.starts_at, shift.ends_at, targetDate);
      onRequestMove({ shift, targetStoreId, targetDate, startsAt: interval.starts_at, endsAt: interval.ends_at });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Не вдалося підготувати перенесення зміни");
    }
  };

  return <div className="overflow-x-auto rounded-lg border border-[rgb(var(--border))]">
    <div style={{ minWidth: `${Math.max(960, 180 + stores.length * 168)}px` }}>
      <div className="grid" style={{ gridTemplateColumns: `180px repeat(${stores.length}, minmax(168px, 1fr))` }}>
        <div className="sticky left-0 top-0 z-30 border-b border-r border-[rgb(var(--border))] bg-white px-3 py-3 text-sm font-medium text-ink-700">Дата \ Магазин</div>
        {stores.map((store) => <div key={store.id} className="sticky top-0 z-20 border-b border-r border-[rgb(var(--border))] bg-white px-3 py-3 text-center text-sm font-medium text-ink-800">{store.name}</div>)}
        {dates.map((date) => {
          const label = dayLabel(date);
          const weekend = ["сб", "нд"].includes(label.weekday.toLowerCase());
          return <div key={date} className="contents">
            <div className={`sticky left-0 z-10 border-b border-r border-[rgb(var(--border))] px-3 py-3 text-sm font-medium text-ink-800 ${weekend ? "bg-ink-50" : "bg-white"}`}><div>{label.day}.{date.slice(5, 7)}</div><div className="mt-0.5 text-xs font-normal text-ink-500">{label.weekday}</div></div>
            {stores.map((store) => {
              const cellShifts = scheduledByCell.get(`${store.id}:${date}`) ?? [];
              return <div key={store.id} onDragOver={(event) => { if (!readonly) event.preventDefault(); }} onDrop={(event) => dropInto(event, store.id, date)} className={`min-h-28 border-b border-r border-[rgb(var(--border))] p-1 ${weekend ? "bg-ink-50/60" : "bg-white"}`}>
              {cellShifts.map((shift) => {
                const overnight = isOvernight(shift);
                return <Tooltip key={shift.shift_id} title={`${shift.employee_full_name} · ${shiftHours(shift)}${shift.is_replacement ? " · Заміна" : ""}`}>
                  <div draggable={!readonly && !overnight} onDragStart={(event) => startDrag(event, shift)} onDragEnd={() => setDraggedShift(null)} className={`mb-1 rounded-md border-l-4 p-1.5 text-xs shadow-sm ${shift.is_replacement ? "border-l-amber-400 bg-amber-50" : "border-l-blue-500 bg-blue-50"} ${readonly || overnight ? "cursor-default" : "cursor-grab"}`}>
                    <div className="truncate font-medium text-ink-900">{shift.employee_full_name}</div>
                    <div className="mt-0.5 flex items-center justify-between gap-1 text-[11px] text-ink-600"><span>{shiftHours(shift)}</span>{shift.is_replacement ? <Tag color="gold" className="m-0 text-[10px]">Заміна</Tag> : null}</div>
                    {!readonly ? <Button type="link" size="small" className="h-auto p-0 text-[11px]" icon={<EditOutlined />} onClick={() => onEdit(shift)}>{overnight ? "Редагувати" : "Перемістити"}</Button> : null}
                  </div>
                </Tooltip>;
              })}
              </div>;
            })}
          </div>;
        })}
      </div>
    </div>
  </div>;
}
