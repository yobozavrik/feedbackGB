"use client";

import Link from "next/link";
import { useTelegram } from "./TelegramProvider";

export function Header({ subtitle }: { subtitle?: string }) {
  const { user } = useTelegram();
  const name = user?.first_name ?? "";

  return (
    <header className="mb-6 flex items-start justify-between gap-3">
      <div>
        <Link href="/" className="inline-flex items-center gap-2">
          <span className="text-2xl">💖</span>
          <span className="font-display text-xl font-bold tracking-tight grad-text">
            Галя слухає
          </span>
        </Link>
        <p className="mt-1 text-sm text-ink-500">
          {subtitle ?? (name ? `Привіт, ${name}!` : "Розкажи, що відбувається в магазині")}
        </p>
      </div>
      {name ? (
        <div className="card flex h-11 w-11 items-center justify-center text-base font-semibold text-blush-500">
          {name.slice(0, 1).toUpperCase()}
        </div>
      ) : null}
    </header>
  );
}
