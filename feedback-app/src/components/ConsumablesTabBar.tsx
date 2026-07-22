"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheckIcon, PackageIcon } from "@/components/icons";

// Bottom tab bar for the consumables hub (Замовлення / Мої заявки), per the
// Stitch "Мої заявки" mockup. Only shown on hub pages — the active ordering
// flow and sub-pages (detail) keep their own task footers.
const TABS = [
  { href: "/feedback/consumables_request", label: "Замовлення", Icon: PackageIcon },
  { href: "/my-requests", label: "Мої заявки", Icon: ClipboardCheckIcon },
];

export function ConsumablesTabBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-[#c1c6d7] bg-white/90 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur-xl">
      {TABS.map(({ href, label, Icon }) => {
        const active = pathname === href || (href === "/my-requests" && pathname.startsWith("/my-requests"));
        return (
          <Link
            key={href}
            href={href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-1 text-[11px] font-medium ${active ? "text-[#0058bc]" : "text-[#717786]"}`}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={24} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
