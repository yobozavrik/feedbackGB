import { CartProvider } from "@/components/raw-materials/CartContext";
import { CartBar } from "@/components/raw-materials/CartBar";

export default function RawMaterialsOrderLayout({ children }: { children: React.ReactNode }) {
  return (
    <CartProvider>
      <div className="pb-20">{children}</div>
      <CartBar />
    </CartProvider>
  );
}
