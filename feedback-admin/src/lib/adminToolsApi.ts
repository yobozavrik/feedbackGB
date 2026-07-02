// Client-side wrappers for the manual admin tools endpoints. Same URLs,
// methods and response parsing that tools-client.tsx had inline; network
// exceptions propagate to the caller (the tool components show them).

export async function sendReportNow(): Promise<
  { ok: true; total?: number } | { ok: false; error: string }
> {
  const res = await fetch("/api/admin/send-report-now", { method: "POST" });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    total?: number;
  };
  if (!res.ok) {
    return { ok: false, error: data.error ?? `Помилка ${res.status}` };
  }
  return { ok: true, total: data.total };
}

export async function mirrorToDriveNow(): Promise<
  | { ok: true; mirrored: number; failed: number }
  | { ok: false; error: string }
> {
  const res = await fetch("/api/admin/mirror-to-drive-now", {
    method: "POST",
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    mirrored?: number;
    failed?: number;
    skipped?: number;
  };
  if (!res.ok) {
    return { ok: false, error: data.error ?? `Помилка ${res.status}` };
  }
  return { ok: true, mirrored: data.mirrored ?? 0, failed: data.failed ?? 0 };
}
