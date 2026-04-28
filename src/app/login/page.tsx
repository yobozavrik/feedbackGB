import { Suspense } from "react";
import { PinPad } from "@/components/PinPad";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100svh] items-center justify-center text-ink-500">
          Завантаження…
        </div>
      }
    >
      <PinPad />
    </Suspense>
  );
}
