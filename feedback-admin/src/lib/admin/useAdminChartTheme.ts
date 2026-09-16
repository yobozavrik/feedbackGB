"use client";

import { useMemo } from "react";
import { useAdminTheme } from "@/components/admin/AdminThemeProvider";

/**
 * N5 — `@ant-design/plots` charts (funnel Sankey/Bar/Heatmap, StoreDrawer
 * Line/Pie, photo-report Column/Heatmap) draw through G2's own canvas/SVG
 * renderer, which can't resolve CSS custom properties — passing
 * `var(--ink-500)` as an axis color is a no-op. G2 ships a matched
 * "classicDark" theme (axis/grid/label colors tuned for a dark canvas)
 * alongside its default "classic" one, so switching between the two
 * built-in presets is the correct fix here, not hand-rolling hex values
 * that would drift from theme.ts over time.
 */
export function useAdminChartTheme(): { type: "classic" | "classicDark" } {
  const { resolved } = useAdminTheme();
  return useMemo(
    () => ({ type: resolved === "dark" ? "classicDark" : "classic" }),
    [resolved],
  );
}
