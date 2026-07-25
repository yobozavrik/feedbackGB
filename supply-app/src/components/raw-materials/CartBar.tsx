"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "./CartContext";

const CART_PATH = "/home/supply/order/cart";

export function CartBar() {
  const { totalCount, items } = useCart();
  const pathname = usePathname();

  if (totalCount === 0 || pathname === CART_PATH) return null;

  return (
    <Link
      href={CART_PATH}
      className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between border-t border-ink-300/20 bg-brand-500 px-4 py-3.5 text-white shadow-soft active:bg-brand-600"
    >
      <span className="flex items-center gap-2 text-[15px] font-semibold">
        <span aria-hidden>🧺</span>
        Кошик · {items.length} поз. · {formatQty(totalCount)} од.
      </span>
      <span aria-hidden className="text-[18px]">→</span>
    </Link>
  );
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}
