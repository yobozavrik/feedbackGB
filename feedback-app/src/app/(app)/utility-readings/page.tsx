import { Header } from "@/components/Header";
import { notFound } from "next/navigation";
import { UtilityReadingsForm } from "./utility-readings-form";
import { utilityReadingsEnabled } from "@/lib/utilityFeature";

export const dynamic = "force-dynamic";

export default function UtilityReadingsPage() {
  if (!utilityReadingsEnabled()) notFound();
  return <main>
    <Header back={{ href: "/", label: "На головну" }} subtitle="Показники комунальних послуг" />
    <UtilityReadingsForm />
  </main>;
}
