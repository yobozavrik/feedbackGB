"use client";

import { Card, Empty, Input, Pagination, Typography } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProductPhoto } from "../../product-photo";
import { PRODUCT_PAGE_SIZE, productHref, type CatalogProduct } from "@/lib/admin/productCatalog";

export function CategoryProducts({ categoryId, products, total, page, search, posterMissingIds }: { categoryId: string; products: CatalogProduct[]; total: number; page: number; search: string; posterMissingIds: number[] }) {
  const router = useRouter();
  const missingIds = new Set(posterMissingIds);
  function navigate(nextPage: number, nextSearch: string) {
    const params = new URLSearchParams();
    if (nextSearch) params.set("q", nextSearch);
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    router.push(`/admin/technologist/products/category/${encodeURIComponent(categoryId)}${query ? `?${query}` : ""}`);
  }
  return <>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <Input.Search key={search} defaultValue={search} placeholder="Пошук за назвою" aria-label="Пошук продуктів за назвою" allowClear onSearch={(value) => navigate(1, value.trim())} className="max-w-sm" />
      <Typography.Text type="secondary">Знайдено: {total}</Typography.Text>
    </div>
    {products.length ? <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {products.map((product) => <Link key={product.id} href={productHref(product.id)} className="block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"><Card hoverable className="h-full" size="small"><div className="flex items-start gap-3"><ProductPhoto photo={product.photo} name={product.name} className="h-20 w-20 shrink-0" /><div className="min-w-0"><Typography.Text strong className="block line-clamp-2">{product.name}</Typography.Text><Typography.Text type="secondary" className="mt-1 block text-xs">ID: {product.id}{product.unit ? ` · ${product.unit}` : ""}</Typography.Text>{missingIds.has(product.id) && <Typography.Text type="warning" className="mt-1 block text-xs">Відсутній у поточному Poster</Typography.Text>}{product.barcode && <Typography.Text type="secondary" className="mt-1 block break-all text-xs">Штрихкод: {product.barcode}</Typography.Text>}</div></div></Card></Link>)}
    </div> : <Empty className="py-12" description="Продуктів не знайдено" />}
    {total > PRODUCT_PAGE_SIZE && <div className="mt-6 flex justify-end"><Pagination current={page} pageSize={PRODUCT_PAGE_SIZE} total={total} showSizeChanger={false} onChange={(nextPage) => navigate(nextPage, search)} /></div>}
  </>;
}
