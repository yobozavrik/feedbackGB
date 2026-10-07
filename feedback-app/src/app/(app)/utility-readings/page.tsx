import { Header } from "@/components/Header";
import { notFound } from "next/navigation";
import { UtilityReadingsForm } from "./utility-readings-form";

export const dynamic = "force-dynamic";

export default function UtilityReadingsPage() {
  if (process.env.NEXT_PUBLIC_UTILITY_READINGS_ENABLED !== "true") notFound();
  return <main>
    <Header back={{ href: "/", label: "На головну" }} subtitle="Показники комунальних послуг" />
    <UtilityReadingsForm />
  </main>;
}
