/** The first phase is live by default; an explicit false is the emergency off switch. */
export function utilityReadingsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_UTILITY_READINGS_ENABLED !== "false";
}
