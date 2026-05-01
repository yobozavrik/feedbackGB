"use client";

import { useState } from "react";
import type { AdminUser } from "./page";

interface Props {
  users: AdminUser[];
}

export function UsersClient({ users }: Props) {
  const [list, setList] = useState<AdminUser[]>(users);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);

  const updateUser = (patch: Partial<AdminUser> & { id: string }) =>
    setList((prev) =>
      prev.map((u) => (u.id === patch.id ? { ...u, ...patch } : u)),
    );

  const handleUnlock = async (u: AdminUser) => {
    if (!confirm(`Розблокувати ${u.full_name}?`)) return;
    const res = await fetch(`/api/admin/users/${u.id}/unlock`, {
      method: "POST",
    });
    if (!res.ok) {
      alert("Не вдалося розблокувати. Спробуй ще раз.");
      return;
    }
    updateUser({ id: u.id, failed_attempts: 0, locked_until: null });
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h1 className="font-display text-[22px] font-semibold text-ink-900">
          Користувачі
        </h1>
        <span className="pill bg-elev2 text-ink-700">{list.length}</span>
      </div>

      <p className="mb-4 px-1 text-[12px] text-ink-500">
        Тут можна перевидати PIN-код, якщо людина його забула, або розблокувати
        акаунт після 10 невдалих спроб входу. Нові PIN — 6–8 цифр.
      </p>

      <ul className="space-y-3">
        {list.map((u) => (
          <UserRow
            key={u.id}
            user={u}
            onResetClick={() => setResetTarget(u)}
            onUnlockClick={() => handleUnlock(u)}
          />
        ))}
      </ul>

      {resetTarget ? (
        <ResetPinModal
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onSuccess={() => {
            updateUser({
              id: resetTarget.id,
              has_pin: true,
              failed_attempts: 0,
              locked_until: null,
            });
            setResetTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function UserRow({
  user,
  onResetClick,
  onUnlockClick,
}: {
  user: AdminUser;
  onResetClick: () => void;
  onUnlockClick: () => void;
}) {
  const isLocked =
    user.locked_until != null && new Date(user.locked_until) > new Date();
  const subtitle =
    user.role === "admin"
      ? "Адмін"
      : user.store_name
        ? `Продавчиня · ${user.store_name}`
        : "Продавчиня";

  return (
    <li className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold text-ink-900">
              {user.full_name}
            </span>
            {!user.has_pin ? (
              <span className="pill bg-amber-200/40 text-[11px] text-amber-900">
                без PIN
              </span>
            ) : null}
            {isLocked ? (
              <span className="pill bg-rose-200/40 text-[11px] text-rose-900">
                заблоковано
              </span>
            ) : null}
            {!user.is_active ? (
              <span className="pill bg-ink-300/30 text-[11px] text-ink-700">
                неактивний
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[12px] text-ink-500">{subtitle}</p>
          {user.last_login ? (
            <p className="mt-0.5 text-[11px] text-ink-500">
              Останній вхід: {new Date(user.last_login).toLocaleString("uk-UA")}
            </p>
          ) : (
            <p className="mt-0.5 text-[11px] text-ink-500">Жодного входу</p>
          )}
          {user.failed_attempts > 0 ? (
            <p className="mt-0.5 text-[11px] text-rose-700">
              Невдалих спроб: {user.failed_attempts}
              {isLocked ? ` · до ${new Date(user.locked_until!).toLocaleTimeString("uk-UA")}` : ""}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onResetClick}
          className="pill bg-ink-900 px-3 py-1.5 text-[12px] font-medium text-bg"
        >
          {user.has_pin ? "Перевидати PIN" : "Встановити PIN"}
        </button>
        {isLocked ? (
          <button
            type="button"
            onClick={onUnlockClick}
            className="pill bg-elev2 px-3 py-1.5 text-[12px] font-medium text-ink-900"
          >
            Розблокувати
          </button>
        ) : null}
      </div>
    </li>
  );
}

function ResetPinModal({
  user,
  onClose,
  onSuccess,
}: {
  user: AdminUser;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!/^\d{6,8}$/.test(pin)) {
      setError("PIN має бути 6–8 цифр.");
      return;
    }
    if (pin !== confirmPin) {
      setError("Підтвердження не співпадає.");
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/admin/users/${user.id}/pin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Помилка сервера");
      return;
    }
    onSuccess();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md animate-slide-up rounded-t-3xl bg-bg p-5 shadow-soft sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-[18px] font-semibold text-ink-900">
          {user.has_pin ? "Перевидати PIN" : "Встановити PIN"}
        </h2>
        <p className="mt-1 text-[12px] text-ink-500">
          {user.full_name} — новий код 6–8 цифр.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-[12px] text-ink-700">Новий PIN</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              className="field-input mt-1 w-full"
              placeholder="6–8 цифр"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[12px] text-ink-700">Повторити PIN</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={8}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
              className="field-input mt-1 w-full"
              placeholder="Ще раз"
            />
          </div>
          {error ? (
            <p className="text-[12px] text-rose-700">{error}</p>
          ) : null}
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 rounded-2xl bg-elev2 py-3 text-[14px] font-medium text-ink-900"
          >
            Скасувати
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-1 rounded-2xl bg-ink-900 py-3 text-[14px] font-medium text-bg disabled:opacity-50"
          >
            {submitting ? "Зберігаю..." : "Зберегти"}
          </button>
        </div>
        <p className="mt-3 text-[11px] text-ink-500">
          PIN не зберігається в логах. Скажи цей код користувачці особисто.
        </p>
      </div>
    </div>
  );
}
