import type { AuditRow } from "@/app/(admin)/admin/audit/page";

// Pure formatting/parsing helpers for the audit page. No JSX, no I/O.

/** Same-day events show time only; older ones a compact date+time. */
export function formatTime(iso: string): string {
  const t = new Date(iso);
  const now = new Date();
  const sameDay =
    t.getFullYear() === now.getFullYear() &&
    t.getMonth() === now.getMonth() &&
    t.getDate() === now.getDate();
  if (sameDay) {
    return t.toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return t.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function readAppSurface(meta: AuditRow["meta"]): string | null {
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>).app_surface;
  return typeof value === "string" ? value : null;
}

export function appSurfaceLabel(surface: string | null): {
  label: string;
  color: string;
} | null {
  if (surface === "web_app") return { label: "Веб-апп", color: "green" };
  if (surface === "admin_panel") return { label: "Адмінка", color: "magenta" };
  return null;
}

export interface GeoIpMeta {
  country?: string | null;
  city?: string | null;
  asn?: string | null;
  isp?: string | null;
}

export function readGeo(meta: AuditRow["meta"]): GeoIpMeta | null {
  if (!meta || typeof meta !== "object") return null;
  const raw = (meta as Record<string, unknown>).geoip;
  if (!raw || typeof raw !== "object") return null;
  return raw as GeoIpMeta;
}
