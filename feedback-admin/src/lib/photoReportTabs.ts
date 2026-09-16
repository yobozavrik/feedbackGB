export const PHOTO_REPORT_TAB_KEYS = ["daily", "stores", "attendance"] as const;

export type PhotoReportTabKey = (typeof PHOTO_REPORT_TAB_KEYS)[number];

export function photoReportTabKey(value: string | undefined): PhotoReportTabKey {
  return PHOTO_REPORT_TAB_KEYS.includes(value as PhotoReportTabKey)
    ? value as PhotoReportTabKey
    : "daily";
}
