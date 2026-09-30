/** Keep post-login navigation inside this application. Hash fragments are not
 * needed for server routes and are deliberately discarded. */
export function safeLoginNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\r\n\0]/.test(value)) return "/";
  try {
    const parsed = new URL(value, "https://feedbackgb.invalid");
    if (parsed.origin !== "https://feedbackgb.invalid") return "/";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}
