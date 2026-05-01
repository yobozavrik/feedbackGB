"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { identifyUser, track } from "@/lib/analytics";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"];
const PIN_LENGTH = 6;
const PIN_MIN_LENGTH = 4;

interface LoginUser {
  id: string;
  full_name: string;
  role: "seller" | "admin";
}

export function PinPad() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";

  const [users, setUsers] = useState<LoginUser[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/auth/users", { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j) => {
        if (Array.isArray(j?.users)) setUsers(j.users as LoginUser[]);
      })
      .catch(() => {});
    return () => ctrl.abort();
  }, []);

  async function submit(nextPin: string) {
    if (!userId) {
      setErr("Оберіть користувача");
      return;
    }
    setBusy(true);
    setErr(null);
    track("login_submit_click", { user_id: userId, pin_length: nextPin.length });
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, pin: nextPin }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        error?: string;
        user?: { uid: string; full_name: string; role: string; store_id: number | null };
      };
      if (!r.ok) {
        track("login_failure", {
          user_id: userId,
          status: r.status,
          reason: j.error ?? null,
        });
        setErr(j.error || "Невірний PIN");
        setShake(true);
        setTimeout(() => setShake(false), 250);
        setTimeout(() => setPin(""), 200);
        setBusy(false);
        return;
      }
      if (j.user?.uid) {
        identifyUser(j.user.uid, {
          full_name: j.user.full_name,
          role: j.user.role,
          store_id: j.user.store_id,
        });
      }
      track("login_success", {
        role: j.user?.role ?? null,
        store_id: j.user?.store_id ?? null,
      });
      router.replace(next);
      router.refresh();
    } catch {
      track("login_failure", { user_id: userId, status: 0, reason: "network" });
      setErr("Не вдалось увійти");
      setPin("");
      setBusy(false);
    }
  }

  const tap = (k: string) => {
    if (busy) return;
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate?.(8);
    }
    if (k === "⌫") {
      setPin((p) => p.slice(0, -1));
    } else if (k === "OK") {
      if (pin.length >= PIN_MIN_LENGTH) void submit(pin);
    } else if (k && pin.length < PIN_LENGTH) {
      setPin((p) => (p + k).slice(0, PIN_LENGTH));
    }
  };

  const selectedUser = users.find((u) => u.id === userId);

  return (
    <main className="flex min-h-[100svh] flex-col items-center justify-center px-6 pb-8 pt-12">
      <div className="mb-3 text-4xl" aria-hidden>
        🌸
      </div>
      <h1 className="font-display text-[30px] font-bold leading-none tracking-tight grad-text">
        Галя слухає
      </h1>
      <p className="mt-2 text-[14px] text-ink-500">
        {userId ? "Введи свій PIN" : "Оберіть себе зі списку"}
      </p>

      {!userId ? (
        <div className="mt-8 w-full max-w-xs space-y-2">
          {users.length === 0 ? (
            <p className="text-center text-sm text-ink-500">
              Завантаження користувачів…
            </p>
          ) : (
            users.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  setUserId(u.id);
                  setPin("");
                  setErr(null);
                }}
                className="w-full rounded-2xl bg-elev px-4 py-3 text-left text-sm font-medium text-ink-900 shadow-soft transition hover:bg-brand-50 active:scale-[0.98]"
              >
                <span>{u.full_name}</span>
                {u.role === "admin" ? (
                  <span className="ml-2 text-[10px] text-brand-500">(адмін)</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-2 text-[12px] text-ink-500">
            <span>{selectedUser?.full_name ?? ""}</span>
            <button
              type="button"
              onClick={() => {
                setUserId(null);
                setPin("");
                setErr(null);
              }}
              className="underline"
            >
              змінити
            </button>
          </div>

          <div
            className={`mt-8 flex gap-3 ${shake ? "animate-shake" : ""}`}
            aria-live="polite"
            aria-label={`PIN: ${pin.length} з ${PIN_LENGTH} цифр`}
          >
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
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
                  k === "⌫" ? "Стерти" : k === "OK" ? "Увійти" : k ? `Цифра ${k}` : undefined
                }
                className={`h-[68px] w-[68px] rounded-2xl text-[22px] font-medium transition-all duration-150 ${
                  !k
                    ? "invisible"
                    : k === "OK"
                      ? "bg-brand-100 text-brand-700 shadow-soft active:scale-95"
                      : "bg-elev text-ink-900 shadow-soft hover:bg-brand-50 active:scale-95"
                } ${busy ? "opacity-50" : ""}`}
              >
                {k}
              </button>
            ))}
          </div>
        </>
      )}

      <p className="mt-10 max-w-xs text-center text-[11px] leading-relaxed text-ink-500">
        Якщо забула PIN — попроси адміна (Галя) у чаті.
      </p>
    </main>
  );
}
