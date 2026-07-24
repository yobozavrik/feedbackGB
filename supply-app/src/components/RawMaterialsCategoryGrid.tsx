import Image from "next/image";
import Link from "next/link";
import { photoForCategoryName } from "@/lib/rawMaterialsCategories";

export interface WorkshopCategory {
  id: string;
  name: string;
}

export function RawMaterialsCategoryGrid({ categories }: { categories: WorkshopCategory[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {categories.map((category) => (
        <Link
          key={category.id}
          href={`/home/supply/order/${category.id}`}
          className="group flex h-16 flex-row items-center gap-2.5 rounded-lg border border-ink-300/20 bg-elev px-2.5 shadow-soft transition-all active:scale-95"
        >
          <span className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-lg ring-2 ring-transparent transition-all group-active:ring-[#FFA854]">
            <Image
              src={photoForCategoryName(category.name)}
              alt=""
              fill
              sizes="40px"
              className="object-cover mix-blend-multiply"
            />
          </span>
          <span className="text-[11px] font-medium leading-tight text-ink-900">{category.name}</span>
        </Link>
      ))}
    </div>
  );
}
