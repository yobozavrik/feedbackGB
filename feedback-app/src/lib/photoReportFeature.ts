/**
 * Deliberately opt-in: until release acceptance, photo reports must not be
 * reachable through either the UI or a hand-crafted API request.
 */
export function isPhotoReportEnabled(): boolean {
  return process.env.PHOTO_REPORT_ENABLED === "true";
}
