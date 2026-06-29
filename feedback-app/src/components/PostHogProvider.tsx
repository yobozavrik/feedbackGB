"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import { identifyUser } from "@/lib/analytics";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

/**
 * Initialise PostHog once per browser session. The provider is mounted at
 * the root of the app (`src/app/layout.tsx`) so every page benefits.
 *
 * Privacy choices:
 *   * `mask_all_inputs: true` — input values (PIN, comment text) are never
 *     captured in autocapture or session replay.
 *   * `capture_pageview: false` — we send `$pageview` ourselves on every
 *     client-side route change so SPA navigation is captured (autocapture
 *     only does the initial document load).
 *   * Session replay enabled in production only — preview/staging is too
 *     noisy and the recordings have no business value there.
 */
export function PostHogProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (!POSTHOG_KEY) return; // Not configured — silently no-op.
    if (posthog.__loaded) return; // Already initialised on a previous render.
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      person_profiles: "identified_only",
      capture_pageview: false,
      capture_pageleave: true,
      autocapture: {
        // Don't capture <input>, <textarea>, <select> values.
        dom_event_allowlist: ["click", "submit", "change"],
      },
      session_recording: {
        maskAllInputs: true,
        maskInputOptions: { password: true, email: true, text: true },
      },
      disable_session_recording:
        process.env.NEXT_PUBLIC_VERCEL_ENV !== "production",
      loaded: (ph) => {
        // Bootstrap user identity on the very first page if a session
        // cookie is already set. The /api/auth/me route returns uid
        // exactly for this purpose.
        fetch("/api/auth/me")
          .then((r) => (r.ok ? r.json() : null))
          .then((data) => {
            if (data?.user?.uid) {
              identifyUser(data.user.uid, {
                full_name: data.user.full_name,
                role: data.user.role,
                store_id: data.user.store_id,
              });
            }
          })
          .catch(() => {
            // /api/auth/me is best-effort — analytics still works without it.
          });
        if (process.env.NODE_ENV === "development") {
          ph.debug(false);
        }
      },
    });
  }, []);

  return <PHProvider client={posthog}>{children}<PageViewTracker /></PHProvider>;
}

/**
 * Sends a `$pageview` event on every client-side navigation. Mounted as a
 * sibling so it shares the PostHog provider context.
 */
function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!posthog.__loaded) return;
    const url =
      typeof window !== "undefined"
        ? `${pathname}${searchParams?.toString() ? `?${searchParams.toString()}` : ""}`
        : pathname;
    posthog.capture("$pageview", { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}
