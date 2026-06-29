"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
      className="rounded-full px-2 py-0.5 text-ink-500 underline-offset-2 hover:text-ink-700 hover:underline"
    >
      вийти
    </button>
  );
}
