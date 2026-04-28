"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

export function PinPad() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    if (pin.length !== 4) return;
    setBusy(true);
    setErr(null);
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          setErr(j.error || "Невірний PIN");
          setShake(true);
          setTimeout(() => setShake(false), 250);
          setTimeout(() => setPin(""), 200);
          setBusy(false);
          return;
        }
        router.replace(next);
        router.refresh();
      })
      .catch(() => {
        setErr("Не вдалось увійти");
        setPin("");
        setBusy(false);
      });
  }, [pin, next, router]);

  const tap = (k: string) => {
    if (busy) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(8);
    }
    if (k === "⌫") {
      setPin((p) => p.slice(0, -1));
    } else if (k && pin.length < 4) {
      setPin((p) => (p + k).slice(0, 4));
    }
  };

  return (
    <main className="flex min-h-[100svh] flex-col items-center justify-center px-6 pb-8 pt-12">
      <div className="mb-3 text-4xl" aria-hidden>🌸</div>
      <h1 className="font-display text-[30px] font-bold leading-none tracking-tight grad-text">
        Галя слухає
      </h1>
      <p className="mt-2 text-[14px] text-ink-500">Введи свій PIN</p>

      <div
        className={`mt-10 flex gap-3 ${shake ? "animate-shake" : ""}`}
        aria-live="polite"
        aria-label={`PIN: ${pin.length} з 4 цифр`}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border-2 transition-all duration-200 ${
              busy && i === pin.length
                ? "animate-pulse-soft border-brand-500/70 bg-brand-500/40"
                : i < pin.length
                  ? "scale-110 border-brand-500 bg-brand-500"
                  : "border-ink-300/50 bg-elev"
            }`}
          />
        ))}
      </div>

      <div className="mt-3 h-5 text-[13px] font-medium text-brand-600">
        {err ?? "\u00A0"}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {KEYS.map((k, i) => (
          <button
            key={i}
            type="button"
            disabled={busy || !k}
            onClick={() => tap(k)}
            aria-label={
              k === "⌫" ? "Стерти" : k ? `Цифра ${k}` : undefined
            }
            className={`h-[68px] w-[68px] rounded-2xl text-[22px] font-medium transition-all duration-150 ${
              !k
                ? "invisible"
                : "bg-elev text-ink-900 shadow-soft hover:bg-brand-50 active:scale-95"
            } ${busy ? "opacity-50" : ""}`}
          >
            {k}
          </button>
        ))}
      </div>

      <p className="mt-10 max-w-xs text-center text-[11px] leading-relaxed text-ink-500">
        Якщо забула PIN — попроси адміна (Галя) у чаті.
      </p>
    </main>
  );
}
