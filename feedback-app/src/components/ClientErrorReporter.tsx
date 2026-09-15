"use client";

import { useEffect } from "react";

const MAX_MESSAGE = 500;
const MAX_STACK = 2_000;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  // Never let accidental PINs or bearer tokens reach persisted telemetry.
  return value
    .replace(/\b\d{6,}\b/g, "[redacted-number]")
    .replace(/bearer\s+[\w.-]+/gi, "Bearer [redacted]")
    .slice(0, max);
}

function report(kind: "error" | "unhandledrejection", value: unknown) {
  const error = value instanceof Error ? value : null;
  void fetch("/api/telemetry/client-error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    keepalive: true,
    body: JSON.stringify({
      kind,
      route: window.location.pathname,
      message: text(error?.message ?? String(value), MAX_MESSAGE),
      stack: text(error?.stack, MAX_STACK),
    }),
  }).catch(() => undefined);
}

/** Captures otherwise invisible browser crashes without collecting form data. */
export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => report("error", event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => report("unhandledrejection", event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
