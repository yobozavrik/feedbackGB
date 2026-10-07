import { UtilityReadingsWorkspace } from "./utility-readings-workspace";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function UtilityReadingsPage() {
  if (process.env.NEXT_PUBLIC_UTILITY_READINGS_ENABLED !== "true") notFound();
  return <UtilityReadingsWorkspace />;
}
