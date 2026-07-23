"use client";

import { useState } from "react";

export function PinLogin() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin }) });
      if (res.ok) window.location.assign("/home");
      else setError("Вхід недоступний. Перевірте PIN або зверніться до супер-адміністратора.");
    } catch {
      setError("Не вдалося з’єднатися з сервером.");
    } finally {
      setLoading(false);
    }
  }

  return <form className="stack" onSubmit={submit}>
    <label htmlFor="pin">PIN-код</label>
    <input id="pin" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} aria-describedby="pin-help" />
    <p id="pin-help" className="muted">Шість цифр. Доступ видає лише супер-адміністратор.</p>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <button className="primary" disabled={loading || pin.length !== 6} type="submit">{loading ? "Перевіряємо…" : "Увійти"}</button>
  </form>;
}
