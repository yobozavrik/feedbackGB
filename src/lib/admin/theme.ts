import type { ThemeConfig } from "antd";

/**
 * Antd 5 ConfigProvider tokens — мапінг наявної теплої FeedbackGB-палітри
 * (помаранчево-рожевий бренд, бежеві поверхні) на antd дизайн-токени.
 *
 * Значення синхронізовані з src/styles/globals.css (CSS-змінні `--brand-*`,
 * `--ink-*`, `--bg`, `--elev*`).
 */
export const adminTheme: ThemeConfig = {
  token: {
    colorPrimary: "#e85a8a", // brand-500 — теплий рожевий
    colorInfo: "#e85a8a",
    colorSuccess: "#16a34a",
    colorWarning: "#f4a261",
    colorError: "#dc2626",

    colorBgBase: "#fdf8f3", // bg
    colorBgLayout: "#fdf8f3",
    colorBgContainer: "#ffffff", // elev
    colorBgElevated: "#ffffff",

    colorText: "#2b1b1b", // ink-900
    colorTextSecondary: "#5a4848", // ink-700
    colorTextTertiary: "#8c7a7a", // ink-500
    colorTextQuaternary: "#c8b9b9", // ink-300

    colorBorder: "#f0e6dc",
    colorBorderSecondary: "#fbf3eb",

    borderRadius: 12,
    borderRadiusLG: 16,
    borderRadiusSM: 8,

    fontFamily:
      "var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif",
    fontSize: 14,
  },
  components: {
    Layout: {
      bodyBg: "#fdf8f3",
      headerBg: "#ffffff",
      siderBg: "#ffffff",
      headerHeight: 56,
    },
    Menu: {
      itemSelectedBg: "#fde7ee", // brand-50
      itemSelectedColor: "#d54a78", // brand-600
      itemHoverBg: "#fbf3eb", // elev-2
      itemBorderRadius: 10,
    },
    Button: {
      borderRadius: 12,
      controlHeight: 36,
      fontWeight: 500,
    },
    Card: {
      borderRadiusLG: 16,
    },
    Table: {
      borderRadius: 12,
      headerBg: "#fbf3eb",
      headerColor: "#5a4848",
    },
  },
};
