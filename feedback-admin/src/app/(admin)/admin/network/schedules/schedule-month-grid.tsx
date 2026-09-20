"use client";

import { theme as antdTheme, Tooltip } from "antd";
import type { DragEvent } from "react";
import { useMemo, useState } from "react";
import { isSaturdayOrSunday, kyivDateTimeParts, kyivMonthDates, moveSameDayShiftToKyivDate, ukraineHolidayName } from "@/lib/scheduleTime";
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

function calendarDayKind(date: string) {
  const holidayName = ukraineHolidayName(date);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return { holidayName, isSaturday: !holidayName && weekday === 6, isSunday: !holidayName && weekday === 0 };
}

function shiftHours(shift: Shift) {
  return `${kyivDateTimeParts(shift.starts_at).time}–${kyivDateTimeParts(shift.ends_at).time}`;
}

function isOvernight(shift: Shift) {
  return kyivDateTimeParts(shift.starts_at).date !== kyivDateTimeParts(shift.ends_at).date;
}

export function ScheduleMonthGrid({ stores, month, shifts, readonly, onRequestMove, onEdit, onError }: Props) {
  const { token } = antdTheme.useToken();
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

  const gridBorder = `1px solid ${token.colorBorderSecondary}`;
  const headerStyle = { background: token.colorFillTertiary, borderColor: token.colorBorderSecondary, color: token.colorTextSecondary };
  const regularCellStyle = { background: token.colorBgContainer, borderColor: token.colorBorderSecondary };
  const saturdayCellStyle = { background: token.colorInfoBg, borderColor: token.colorBorderSecondary };
  const sundayCellStyle = { background: token.colorFillSecondary, borderColor: token.colorBorderSecondary };
  const holidayCellStyle = { background: token.colorErrorBg, borderColor: token.colorErrorBorder, color: token.colorErrorText };

  return <div className="overflow-x-auto rounded-lg" style={{ border: gridBorder }}>
    <div className="min-w-[980px] xl:min-w-0">
      <div className="grid" style={{ gridTemplateColumns: `76px repeat(${stores.length}, minmax(0, 1fr))` }}>
        <div className="sticky left-0 top-0 z-30 border-b border-r px-1 py-1 text-[10px] font-medium" style={headerStyle}>Дата</div>
        {stores.map((store) => <Tooltip key={store.id} title={store.name}><div className="sticky top-0 z-20 truncate border-b border-r px-1 py-1 text-center text-[10px] font-medium" style={headerStyle}>{store.name}</div></Tooltip>)}
        {dates.map((date) => {
          const label = dayLabel(date);
          const calendar = calendarDayKind(date);
          const dayStyle = calendar.holidayName ? holidayCellStyle : calendar.isSaturday ? saturdayCellStyle : calendar.isSunday ? sundayCellStyle : regularCellStyle;
          const dayTitle = calendar.holidayName ?? (isSaturdayOrSunday(date) ? "Календарний вихідний — мережа працює за графіком" : undefined);
          return <div key={date} className="contents">
            <Tooltip title={dayTitle}><div className="sticky left-0 z-10 border-b border-r px-1 py-1 text-[10px] font-medium" style={dayStyle}><div>{label.day}.{date.slice(5, 7)}</div><div className="text-[9px] font-normal opacity-75">{calendar.holidayName ? "свято" : label.weekday}</div></div></Tooltip>
            {stores.map((store) => {
              const cellShifts = scheduledByCell.get(`${store.id}:${date}`) ?? [];
              const shown = cellShifts.slice(0, 1);
              const hiddenCount = cellShifts.length - shown.length;
              return <div key={store.id} onDragOver={(event) => { if (!readonly) event.preventDefault(); }} onDrop={(event) => dropInto(event, store.id, date)} className="min-h-7 border-b border-r p-px" style={dayStyle}>
              {shown.map((shift) => {
                const overnight = isOvernight(shift);
                return <Tooltip key={shift.shift_id} title={`${shift.employee_full_name} · ${shiftHours(shift)}${shift.is_replacement ? " · Заміна" : ""}`}>
                  <div draggable={!readonly && !overnight} role="button" tabIndex={0} onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && !readonly) { event.preventDefault(); onEdit(shift); } }} onDoubleClick={() => { if (!readonly) onEdit(shift); }} onDragStart={(event) => startDrag(event, shift)} onDragEnd={() => setDraggedShift(null)} className={`truncate rounded px-1 py-0.5 text-[10px] leading-3 ${readonly || overnight ? "cursor-default" : "cursor-grab"}`} style={{ background: shift.is_replacement ? token.colorWarningBg : token.colorInfoBg, color: shift.is_replacement ? token.colorWarningText : token.colorInfoText }}>
                    {shift.employee_full_name}
                  </div>
                </Tooltip>;
              })}
              {hiddenCount > 0 ? <Tooltip title={cellShifts.slice(1).map((shift) => shift.employee_full_name).join(", ")}><div className="truncate px-1 text-[9px]" style={{ color: token.colorTextSecondary }}>+{hiddenCount}</div></Tooltip> : null}
              </div>;
            })}
          </div>;
        })}
      </div>
    </div>
  </div>;
}
