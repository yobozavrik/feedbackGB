"use client";

import { useState } from "react";

const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"];

export function PinPad({ disabled = false }: { disabled?: boolean }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  async function submit(value: string) {
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });
      if (!response.ok) throw new Error();
      // Keep `busy` true through the navigation so no further taps register.
      window.location.assign("/home");
    } catch {
      setError("Вхід недоступний. Зверніться до супер-адміністратора.");
      setShake(true);
      // Hold the pad disabled until the shake finishes AND the pin is cleared,
      // so digits typed during the animation can't be swallowed mid-reset.
      setTimeout(() => {
        setShake(false);
        setPin("");
        setBusy(false);
      }, 250);
    }
  }

  function tap(key: string) {
    if (busy || disabled) return;
    navigator.vibrate?.(8);
    if (key === "⌫") return setPin((value) => value.slice(0, -1));
    if (key === "OK") {
      if (pin.length === 6) void submit(pin);
      return;
    }
    if (pin.length < 6) {
      const next = pin + key;
      setPin(next);
      if (next.length === 6) void submit(next);
    }
  }

  return (
    <main className="flex min-h-[100svh] flex-col items-center justify-center px-6 pb-8 pt-12">
      <div className="mb-3 text-4xl" aria-hidden>🏭</div>
      <h1 className="text-center text-[30px] font-bold leading-none tracking-tight grad-text">Галя: Цех і склад</h1>
      <p className="mt-2 text-[14px] text-ink-500">Введи свій PIN</p>
      <div
        className={`mt-8 flex gap-3 ${shake ? "animate-shake" : ""}`}
        role="img"
        aria-label={`Введено ${pin.length} з 6 цифр`}
      >
        {Array.from({ length: 6 }).map((_, index) => (
          <span
            key={index}
            className={`h-4 w-4 rounded-full border-2 transition-all ${index < pin.length ? "border-brand-500 bg-brand-500" : "border-ink-300/50 bg-elev"}`}
          />
        ))}
      </div>
      <div
        className="mt-3 min-h-5 text-center text-[13px] font-medium text-brand-600"
        role="alert"
        aria-live="assertive"
      >
        {error ?? (disabled ? "Модуль ще не активовано. Зверніться до супер-адміністратора." : " ")}
      </div>
      <div className="mt-6 grid grid-cols-3 gap-3">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            disabled={busy || disabled}
            aria-label={key === "⌫" ? "Стерти" : key === "OK" ? "Підтвердити" : key}
            onClick={() => tap(key)}
            className={`${key === "OK" ? "bg-brand-50 text-brand-500" : "bg-elev text-ink-900"} h-[68px] w-[68px] rounded-xl text-[22px] font-medium shadow-soft transition-all active:scale-95 disabled:opacity-50`}
          >
            {key}
          </button>
        ))}
      </div>
      <p className="mt-10 max-w-xs text-center text-[11px] leading-relaxed text-ink-500">
        Якщо забули PIN — зверніться до супер-адміністратора.
      </p>
    </main>
  );
}
