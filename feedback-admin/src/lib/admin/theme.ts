import { theme as antdTheme, type ThemeConfig } from "antd";

/**
 * Antd 5 tokens for the FeedbackGB admin cosmetic refresh.
 * Source of truth: `feedback-admin/docs/cosmetic-refresh/ADMIN_COSMETIC_REFRESH_PLAN.md`.
 *
 * `baseToken` holds everything that does not depend on light/dark (radii,
 * sizes, type scale, motion — plan IDs T1, T3, T5). `adminLightTheme` and
 * `adminDarkTheme` layer color tokens (T2, N2) and component tokens
 * (S1–S3, S9, B1–B4, C1–C5, D1–D3) on top, once per theme.
 */
const baseToken: ThemeConfig["token"] = {
  // T1 — one radius scale: 6 controls / 4 small / 12 containers / 2 hairline.
  borderRadius: 6,
  borderRadiusSM: 4,
  borderRadiusLG: 12,
  borderRadiusXS: 2,

  // B1 — control heights: 32 small, 36 default, 40 large.
  controlHeight: 36,
  controlHeightSM: 32,
  controlHeightLG: 40,

  // T3 — type scale. Only Inter in the admin; weights stop at 600.
  fontFamily:
    "var(--font-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif",
  fontSize: 14,
  fontSizeSM: 13,
  fontSizeLG: 16,
  fontSizeHeading4: 20,
  fontWeightStrong: 600,
  lineHeight: 1.5714,

  // T5 — one set of durations/easings for every transition in the admin.
  motionDurationFast: "0.15s",
  motionDurationMid: "0.2s",
  motionDurationSlow: "0.3s",
  motionEaseInOut: "cubic-bezier(0.4, 0, 0.2, 1)",
  motionEaseOut: "cubic-bezier(0, 0, 0.2, 1)",

  // B4 — 3px focus ring instead of antd's default 2px/10%.
  lineWidthFocus: 3,
  controlOutlineWidth: 3,
};

const baseComponents: ThemeConfig["components"] = {
  Layout: {
    headerHeight: 56, // S9 — header/logo now 56px, was 58px.
  },
  Menu: {
    // S1 — 32px items, 6px radius, 13px label, 16px icon.
    itemHeight: 32,
    itemMarginBlock: 2,
    itemMarginInline: 0,
    itemPaddingInline: 10,
    itemBorderRadius: 6,
    fontSize: 13,
    iconSize: 16,
    collapsedIconSize: 16,
    iconMarginInlineEnd: 10,
    // S4 — group title (Робота / Мережа / Аналітика / Система).
    groupTitleFontSize: 11,
  },
  Button: {
    // B1 — padding/icon sizes per control height.
    fontWeight: 500,
    paddingInline: 14,
    paddingInlineSM: 10,
    onlyIconSize: 16,
    onlyIconSizeSM: 14,
    iconGap: 6, // B3
    // B2 — no colored shadow on primary/danger; a faint neutral one on default.
    primaryShadow: "none",
    dangerShadow: "none",
  },
  Segmented: {
    // C1 — neutral track, selected segment on the surface color with a soft shadow.
    trackPadding: 3,
    borderRadius: 8,
    borderRadiusSM: 6,
  },
  Tabs: {
    // C2 — selected tab uses text color, not the accent; smaller gutter.
    horizontalItemGutter: 24,
    titleFontSize: 14,
  },
  Pagination: {
    // C3
    itemSize: 32,
    itemSizeSM: 28,
  },
  Select: {
    // C5 — 32px options, selected row gets a neutral fill + bold weight.
    optionHeight: 32,
    optionSelectedFontWeight: 500,
    optionPadding: "6px 10px",
  },
  Dropdown: {
    paddingBlock: 6,
  },
  Table: {
    // D1 — neutral header (not cream), 40px header row, tighter cell padding.
    cellPaddingBlock: 10,
    cellPaddingInline: 14,
    headerBorderRadius: 12,
    headerSplitColor: "transparent",
  },
  Card: {
    borderRadiusLG: 12, // T1
  },
  Modal: {
    borderRadiusLG: 12, // T1
  },
  Drawer: {},
};

// T2 — accent darkened to #c93a6f for AA contrast (#e85a8a on white is 3.35:1,
// below the 4.5:1 minimum). Info separated from the accent (was == primary,
// so every "info" surface read as pink). Warning darkened (#f4a261 on white
// is 2.06:1). Background moved off the cream tint toward a neutral warm gray.
export const adminLightTheme: ThemeConfig = {
  token: {
    ...baseToken,
    colorPrimary: "#c93a6f",
    colorInfo: "#2563eb",
    colorSuccess: "#15803d",
    colorWarning: "#b45309",
    colorError: "#dc2626",

    colorBgBase: "#f7f6f5",
    colorBgLayout: "#f7f6f5",
    colorBgContainer: "#ffffff",
    colorBgElevated: "#ffffff",

    colorText: "#1f1a1a",
    colorTextSecondary: "#5c5552",
    colorTextTertiary: "#766d69",
    colorTextQuaternary: "#b3aba7",

    colorBorder: "#e6e2df",
    colorBorderSecondary: "#efecea",

    colorFillSecondary: "rgba(31,26,26,0.05)",
    colorFillTertiary: "rgba(31,26,26,0.04)",
    controlItemBgHover: "rgba(31,26,26,0.05)",
    controlOutline: "rgba(201,58,111,0.28)",

    // T4 — cards/tables sit flush against the page (border only); shadow is
    // reserved for things that float over the page (popovers, dropdowns).
    boxShadow: "0 8px 24px rgba(16,12,12,.12), 0 2px 6px rgba(16,12,12,.08)",
    boxShadowSecondary:
      "0 8px 24px rgba(16,12,12,.12), 0 2px 6px rgba(16,12,12,.08)",
  },
  components: {
    ...baseComponents,
    Layout: {
      ...baseComponents.Layout,
      bodyBg: "#f7f6f5",
      headerBg: "#ffffff",
      siderBg: "#ffffff",
    },
    Menu: {
      ...baseComponents.Menu,
      itemBg: "#ffffff",
      itemColor: "#5c5552",
      itemHoverColor: "#1f1a1a",
      itemHoverBg: "rgba(31,26,26,0.05)",
      itemSelectedBg: "rgba(31,26,26,0.06)",
      itemSelectedColor: "#1f1a1a",
      itemActiveBg: "rgba(31,26,26,0.08)",
      groupTitleColor: "#766d69",
    },
    Button: {
      ...baseComponents.Button,
      defaultShadow: "0 1px 2px rgba(16,12,12,.05)",
      defaultHoverBg: "rgba(31,26,26,0.04)",
      defaultHoverBorderColor: "#e6e2df",
      defaultHoverColor: "#1f1a1a",
      defaultActiveBg: "rgba(31,26,26,0.07)",
      defaultActiveBorderColor: "#e6e2df",
      defaultActiveColor: "#1f1a1a",
      textHoverBg: "rgba(31,26,26,0.05)",
    },
    Segmented: {
      ...baseComponents.Segmented,
      trackBg: "rgba(31,26,26,0.04)",
      itemColor: "#5c5552",
      itemHoverColor: "#1f1a1a",
      itemHoverBg: "transparent",
      itemSelectedBg: "#ffffff",
      itemSelectedColor: "#1f1a1a",
    },
    Tabs: {
      ...baseComponents.Tabs,
      itemColor: "#5c5552",
      itemSelectedColor: "#1f1a1a",
      itemHoverColor: "#1f1a1a",
      inkBarColor: "#c93a6f",
    },
    Pagination: {
      ...baseComponents.Pagination,
      itemBg: "transparent",
      itemActiveBg: "#ffffff",
    },
    Select: {
      ...baseComponents.Select,
      optionSelectedBg: "rgba(31,26,26,0.06)",
      optionActiveBg: "rgba(31,26,26,0.04)",
      hoverBorderColor: "#b3aba7",
      activeBorderColor: "#c93a6f",
    },
    Input: {
      activeShadow: "0 0 0 3px rgba(201,58,111,0.18)",
      hoverBorderColor: "#b3aba7",
    },
    DatePicker: {
      activeShadow: "0 0 0 3px rgba(201,58,111,0.18)",
      hoverBorderColor: "#b3aba7",
    },
    Table: {
      ...baseComponents.Table,
      headerBg: "#faf9f8",
      headerColor: "#5c5552",
      rowHoverBg: "rgba(31,26,26,0.03)",
      rowSelectedBg: "rgba(201,58,111,0.06)",
      rowSelectedHoverBg: "rgba(201,58,111,0.09)",
      borderColor: "#efecea",
    },
    Drawer: {
      colorBgElevated: "#ffffff",
      colorSplit: "#e6e2df",
    },
  },
};

// N2 — dark variant of the same tokens. `algorithm: darkAlgorithm` derives
// every unlisted alias token (colorFill*, colorBg*, etc.) from colorBgBase;
// only the values that need a deliberate choice are listed explicitly.
export const adminDarkTheme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    ...baseToken,
    colorPrimary: "#f0719f",
    colorTextLightSolid: "#1b1818", // dark text on the light pink primary fill
    colorInfo: "#60a5fa",
    colorSuccess: "#4ade80",
    colorWarning: "#fbbf24",
    colorError: "#f87171",

    colorBgBase: "#121010",
    colorBgLayout: "#121010",
    colorBgContainer: "#1b1818",
    colorBgElevated: "#221e1e",

    colorText: "#f3eeec",
    colorTextSecondary: "#b9b0ad",
    colorTextTertiary: "#9a918d",
    colorTextQuaternary: "#5e5654",

    colorBorder: "#2e2929",
    colorBorderSecondary: "#262222",

    colorFillSecondary: "rgba(255,255,255,0.07)",
    colorFillTertiary: "rgba(255,255,255,0.05)",
    controlItemBgHover: "rgba(255,255,255,0.07)",
    controlOutline: "rgba(240,113,159,0.32)",

    boxShadow: "0 8px 24px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.35)",
    boxShadowSecondary: "0 8px 24px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.35)",
  },
  components: {
    ...baseComponents,
    Layout: {
      ...baseComponents.Layout,
      bodyBg: "#121010",
      headerBg: "#161414",
      siderBg: "#161414",
    },
    Menu: {
      ...baseComponents.Menu,
      itemBg: "#161414",
      itemColor: "#b9b0ad",
      itemHoverColor: "#f3eeec",
      itemHoverBg: "rgba(255,255,255,0.06)",
      itemSelectedBg: "rgba(255,255,255,0.08)",
      itemSelectedColor: "#f3eeec",
      itemActiveBg: "rgba(255,255,255,0.10)",
      groupTitleColor: "#9a918d",
    },
    Button: {
      ...baseComponents.Button,
      defaultShadow: "none",
      defaultHoverBg: "rgba(255,255,255,0.06)",
      defaultHoverBorderColor: "#2e2929",
      defaultHoverColor: "#f3eeec",
      defaultActiveBg: "rgba(255,255,255,0.09)",
      defaultActiveBorderColor: "#2e2929",
      defaultActiveColor: "#f3eeec",
      textHoverBg: "rgba(255,255,255,0.07)",
    },
    Segmented: {
      ...baseComponents.Segmented,
      trackBg: "rgba(255,255,255,0.05)",
      itemColor: "#b9b0ad",
      itemHoverColor: "#f3eeec",
      itemHoverBg: "transparent",
      itemSelectedBg: "#2a2525",
      itemSelectedColor: "#f3eeec",
    },
    Tabs: {
      ...baseComponents.Tabs,
      itemColor: "#b9b0ad",
      itemSelectedColor: "#f3eeec",
      itemHoverColor: "#f3eeec",
      inkBarColor: "#f0719f",
    },
    Pagination: {
      ...baseComponents.Pagination,
      itemBg: "transparent",
      itemActiveBg: "#1b1818",
    },
    Select: {
      ...baseComponents.Select,
      optionSelectedBg: "rgba(255,255,255,0.08)",
      optionActiveBg: "rgba(255,255,255,0.05)",
      hoverBorderColor: "#5e5654",
      activeBorderColor: "#f0719f",
    },
    Input: {
      activeShadow: "0 0 0 3px rgba(240,113,159,0.22)",
      hoverBorderColor: "#5e5654",
    },
    DatePicker: {
      activeShadow: "0 0 0 3px rgba(240,113,159,0.22)",
      hoverBorderColor: "#5e5654",
    },
    Table: {
      ...baseComponents.Table,
      headerBg: "#1f1b1b",
      headerColor: "#b9b0ad",
      rowHoverBg: "rgba(255,255,255,0.03)",
      rowSelectedBg: "rgba(240,113,159,0.10)",
      rowSelectedHoverBg: "rgba(240,113,159,0.14)",
      borderColor: "#262222",
    },
    Drawer: {
      colorBgElevated: "#221e1e",
      colorSplit: "#2e2929",
    },
  },
};

/**
 * @deprecated Kept for any leftover direct import; prefer `adminLightTheme`
 * / `adminDarkTheme` via `AdminThemeProvider` (N1).
 */
export const adminTheme = adminLightTheme;
