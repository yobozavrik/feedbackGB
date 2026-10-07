import { UtilityReadingsWorkspace } from "./utility-readings-workspace";
import { notFound } from "next/navigation";
import { utilityReadingsEnabled } from "@/lib/admin/utilityFeature";

export const dynamic = "force-dynamic";

export default function UtilityReadingsPage() {
  if (!utilityReadingsEnabled()) notFound();
  return <UtilityReadingsWorkspace />;
}
