"use client";

import { DesktopOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import { useAdminTheme } from "@/components/admin/AdminThemeProvider";
import type { AdminThemeMode } from "@/lib/admin/themeMode";

const OPTIONS: Array<{ mode: AdminThemeMode; icon: React.ReactNode; label: string }> = [
  { mode: "system", icon: <DesktopOutlined />, label: "Як у системі" },
  { mode: "light", icon: <SunOutlined />, label: "Світла тема" },
  { mode: "dark", icon: <MoonOutlined />, label: "Темна тема" },
];

/** H2 — three-way light/dark/system switch in the shared header. */
export function ThemeModeSwitch() {
  const { mode, setMode } = useAdminTheme();

  return (
    <div className="admin-theme-switch" role="group" aria-label="Тема">
      {OPTIONS.map((option) => (
        <Tooltip key={option.mode} title={option.label}>
          <button
            type="button"
            className={
              option.mode === mode
                ? "admin-theme-switch__btn is-active"
                : "admin-theme-switch__btn"
            }
            onClick={() => setMode(option.mode)}
            aria-label={option.label}
            aria-pressed={option.mode === mode}
          >
            {option.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
