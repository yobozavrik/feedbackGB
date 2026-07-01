import type { ThemeConfig } from "antd";

/**
 * Antd 5 tokens mapped to the approved FeedbackGB admin redesign.
 * Source of truth: `FeedbackGB админ-панель редизайн/FeedbackGB Admin.dc.html`.
 */
export const adminTheme: ThemeConfig = {
  token: {
    colorPrimary: "#e85a8a",
    colorInfo: "#e85a8a",
    colorSuccess: "#16a34a",
    colorWarning: "#f4a261",
    colorError: "#dc2626",

    colorBgBase: "#fdf8f3", // bg
    colorBgLayout: "#fdf8f3",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#ffffff",

    colorText: "#2b1b1b",
    colorTextSecondary: "#5a4848",
    colorTextTertiary: "#8c7a7a",
    colorTextQuaternary: "#d8c8c8",

    colorBorder: "#f0e6dc",
    colorBorderSecondary: "#f6ece2",
    boxShadow: "0 1px 2px rgba(43,27,27,.04), 0 4px 16px rgba(43,27,27,.05)",
    boxShadowSecondary:
      "0 1px 2px rgba(43,27,27,.04), 0 4px 16px rgba(43,27,27,.05)",

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
      headerHeight: 58,
    },
    Menu: {
      itemBg: "#ffffff",
      itemColor: "#5a4848",
      itemSelectedBg: "#fde7ee",
      itemSelectedColor: "#d54a78",
      itemHoverBg: "#fbf3eb",
      itemHoverColor: "#2b1b1b",
      itemBorderRadius: 10,
      itemMarginBlock: 3,
    },
    Button: {
      borderRadius: 12,
      controlHeight: 36,
      fontWeight: 500,
    },
    Card: {
      borderRadiusLG: 16,
      boxShadow: "0 1px 2px rgba(43,27,27,.04), 0 4px 16px rgba(43,27,27,.05)",
    },
    Table: {
      borderRadius: 12,
      headerBg: "#fbf3eb",
      headerColor: "#5a4848",
      headerSplitColor: "#f0e6dc",
      rowHoverBg: "#fbf3eb",
      cellPaddingBlock: 13,
      cellPaddingInline: 14,
    },
    Drawer: {
      colorBgElevated: "#ffffff",
      colorSplit: "#f0e6dc",
    },
    Modal: {
      borderRadiusLG: 16,
    },
  },
};
