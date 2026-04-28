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
          setPin("");
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
    if (k === "⌫") {
      setPin((p) => p.slice(0, -1));
    } else if (k && pin.length < 4) {
      setPin((p) => (p + k).slice(0, 4));
    }
  };

  return (
    <main className="flex min-h-[100svh] flex-col items-center justify-center px-6">
      <div className="mb-2 text-3xl">🌸</div>
      <h1 className="font-display text-2xl font-semibold text-ink-900">
        Галя слухає
      </h1>
      <p className="mt-1 text-sm text-ink-500">Введи свій PIN</p>

      <div className="mt-8 flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-4 w-4 rounded-full border-2 transition ${
              i < pin.length
                ? "border-blush-500 bg-blush-500"
                : "border-ink-300/40 bg-white"
            }`}
          />
        ))}
      </div>

      <div className="mt-2 h-5 text-xs text-blush-600">{err ?? "\u00A0"}</div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {KEYS.map((k, i) => (
          <button
            key={i}
            type="button"
            disabled={busy || !k}
            onClick={() => tap(k)}
            className={`h-16 w-16 rounded-2xl text-xl font-medium transition ${
              !k
                ? "invisible"
                : "border border-ink-300/30 bg-white text-ink-900 shadow-soft hover:bg-blush-50 active:scale-95"
            } ${busy ? "opacity-50" : ""}`}
          >
            {k}
          </button>
        ))}
      </div>

      <p className="mt-8 max-w-xs text-center text-[11px] leading-relaxed text-ink-500">
        Якщо забула PIN — попроси адміна (Галя) у чаті.
      </p>
    </main>
  );
}
