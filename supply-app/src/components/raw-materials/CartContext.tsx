"use client";

import { createContext, useContext, useMemo, useState } from "react";

export interface CartItem {
  ingredientId: string;
  name: string;
  unit: string;
  quantity: number;
}

interface CartContextValue {
  items: CartItem[];
  totalCount: number;
  getQuantity: (ingredientId: string) => number;
  upsertItem: (item: CartItem) => void;
  removeItem: (ingredientId: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

/** Lives in supply-app/src/app/home/supply/order/layout.tsx so the cart
 * survives navigation between the category list, individual categories and
 * the review screen — Next.js keeps a shared layout mounted across nested
 * route transitions, so plain React state here is enough (no localStorage /
 * server draft needed). */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  const value = useMemo<CartContextValue>(
    () => ({
      items,
      totalCount: items.reduce((sum, i) => sum + i.quantity, 0),
      getQuantity: (ingredientId) => items.find((i) => i.ingredientId === ingredientId)?.quantity ?? 0,
      upsertItem: (item) =>
        setItems((prev) => {
          const idx = prev.findIndex((i) => i.ingredientId === item.ingredientId);
          if (item.quantity <= 0) return prev.filter((i) => i.ingredientId !== item.ingredientId);
          if (idx === -1) return [...prev, item];
          const next = [...prev];
          next[idx] = item;
          return next;
        }),
      removeItem: (ingredientId) => setItems((prev) => prev.filter((i) => i.ingredientId !== ingredientId)),
      clear: () => setItems([]),
    }),
    [items],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
