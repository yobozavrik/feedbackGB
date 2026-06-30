"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function InteractionTracker() {
  const pathname = usePathname();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      try {
        const target = e.target as HTMLElement | null;
        if (!target) return;

        // 1. Calculate relative coordinates
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const xRatio = Math.max(0.0, Math.min(1.0, e.clientX / (viewportW || 1)));
        const yRatio = Math.max(0.0, Math.min(1.0, e.clientY / (viewportH || 1)));

        // 2. Resolve target element info
        // Traverse up to find a semantic element if we clicked on text/span inside it
        let current: HTMLElement | null = target;
        let foundTag = target.tagName;
        let foundId = target.id || null;
        let foundText = target.innerText || target.textContent || "";

        while (current && current.parentElement && current !== document.body) {
          const tag = current.tagName.toUpperCase();
          if (["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA"].includes(tag) || current.getAttribute("role") === "button" || current.classList.contains("cursor-pointer")) {
            foundTag = tag;
            foundId = current.id || foundId;
            foundText = current.innerText || current.textContent || foundText;
            break;
          }
          current = current.parentElement;
        }

        // Clean text content
        const cleanText = foundText.replace(/\s+/g, " ").trim().slice(0, 100);

        // 3. Send event in the background
        const payload = {
          page_path: pathname || window.location.pathname || "/",
          element_tag: foundTag,
          element_id: foundId,
          element_text: cleanText || null,
          x_ratio: parseFloat(xRatio.toFixed(3)),
          y_ratio: parseFloat(yRatio.toFixed(3)),
          viewport_w: viewportW,
          viewport_h: viewportH,
        };

        // Use sendBeacon if available for reliable unload dispatching, otherwise use fetch
        if (typeof navigator !== "undefined" && navigator.sendBeacon) {
          const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
          navigator.sendBeacon("/api/analytics/interactions", blob);
        } else {
          fetch("/api/analytics/interactions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          }).catch(() => {});
        }
      } catch (err) {
        // Silently swallow client tracking errors to prevent breaking the UI
        console.warn("[analytics] tracker error:", err);
      }
    }

    window.addEventListener("click", handleClick, { passive: true });
    return () => {
      window.removeEventListener("click", handleClick);
    };
  }, [pathname]);

  return null;
}
