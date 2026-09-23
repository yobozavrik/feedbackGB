"use client";

import { Card, Descriptions, Empty, Tabs, Typography } from "antd";
import Link from "next/link";
import { UNCATEGORIZED_ID, productCategoryHref, type CatalogProduct } from "@/lib/admin/productCatalog";
import { ProductPhoto } from "../../product-photo";
import { ProductStockPanel } from "./product-stock";
import { ProductTechCardPanel } from "./product-tech-card";
import { useState } from "react";
import { formatProductUnitUk } from "@/lib/productUnits";

function UnconnectedSection({ name }: { name: string }) {
  return <Empty className="py-12" description={`${name}: дані Poster ще не підключено до цієї картки`} />;
}

export function ProductDetail({ product, posterPhoto, photoError }: { product: CatalogProduct; posterPhoto: string | null; photoError: boolean }) {
  const categoryHref = productCategoryHref(product.category_id ?? UNCATEGORIZED_ID);
  const [activeTab, setActiveTab] = useState("stock");
  return <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
    <Card size="small" className="h-fit">
      <ProductPhoto photo={posterPhoto} name={product.name} className="mb-1 h-44 w-full" />
      <Typography.Text type="secondary" className="mb-3 block text-xs">{photoError ? "Фото Poster тимчасово недоступне" : posterPhoto ? "Фото з Poster" : "Фото відсутнє у Poster"}</Typography.Text>
      <Typography.Title level={5} className="!mb-4">{product.name}</Typography.Title>
      <Descriptions column={1} size="small" colon={false} items={[
        { key: "id", label: "ID каталогу", children: product.id },
        { key: "category", label: "Категорія", children: <Link href={categoryHref}>{product.category_name ?? "Без категорії"}</Link> },
        { key: "unit", label: "Одиниця", children: formatProductUnitUk(product.unit) ?? "—" },
        { key: "barcode", label: "Штрихкод", children: product.barcode ?? "—" },
        { key: "cost", label: "Собівартість у POS", children: product.cost ?? "—" },
      ]} />
    </Card>
    <Card size="small" className="min-w-0">
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        { key: "stock", label: "Залишки", children: activeTab === "stock" ? <ProductStockPanel key={product.id} productId={product.id} /> : null },
        { key: "characteristics", label: "Характеристики", children: <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} items={[
          { key: "name", label: "Назва", children: product.name },
          { key: "category", label: "Категорія", children: product.category_name ?? "Без категорії" },
          { key: "unit", label: "Одиниця виміру", children: formatProductUnitUk(product.unit) ?? "—" },
          { key: "barcode", label: "Штрихкод", children: product.barcode ?? "—" },
        ]} /> },
        { key: "tech", label: "Технологічна карта", children: activeTab === "tech" ? <ProductTechCardPanel key={product.id} productId={product.id} /> : null },
        { key: "stages", label: "Етапи та задачі", children: <UnconnectedSection name="Етапи та задачі" /> },
      ]} />
    </Card>
  </div>;
}
