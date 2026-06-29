"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string | null;
  label?: string;
}

const DEFAULT_MAX = 1_000_000;

/**
 * Big tap targets for the priority flow — the seller should be able to
 * adjust quantity with one thumb. Long-press the +/- buttons to repeat.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max = DEFAULT_MAX,
  step = 1,
  unit,
  label = "Скільки",
}: Props) {
  const [text, setText] = useState<string>(formatVal(value));
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setText(formatVal(value));
  }, [value]);

  function clamp(n: number) {
    if (Number.isNaN(n)) return min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
  }

  function bump(delta: number) {
    onChange(clamp(value + delta));
  }

  function startRepeat(delta: number) {
    bump(delta);
    if (repeatTimer.current) clearInterval(repeatTimer.current);
    repeatTimer.current = setInterval(() => bump(delta), 110);
  }

  function stopRepeat() {
    if (repeatTimer.current) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  }

  return (
    <div>
      <label className="field-label">
        {label}
        {unit ? <span className="ml-1 text-ink-500">({unit})</span> : null}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Менше"
          className="btn-step"
          onPointerDown={(e) => {
            e.preventDefault();
            startRepeat(-step);
          }}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          onPointerCancel={stopRepeat}
          disabled={value <= min}
        >
          −
        </button>
        <input
          inputMode="decimal"
          aria-label={label}
          className="field-input h-13 flex-1 text-center text-[20px] font-semibold tabular-nums"
          value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(",", ".");
            setText(raw);
            const n = Number(raw);
            if (!Number.isNaN(n)) onChange(clamp(n));
          }}
          onBlur={() => setText(formatVal(value))}
        />
        <button
          type="button"
          aria-label="Більше"
          className="btn-step"
          onPointerDown={(e) => {
            e.preventDefault();
            startRepeat(step);
          }}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          onPointerCancel={stopRepeat}
          disabled={value >= max}
        >
          +
        </button>
      </div>
    </div>
  );
}

function formatVal(n: number): string {
  if (Number.isNaN(n)) return "0";
  // Strip trailing zeros (3.0 → "3", 3.5 → "3.5")
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)));
}
