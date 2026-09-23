"use client";

import { AppstoreOutlined } from "@ant-design/icons";
import { Alert, Card, Empty, Tag, Typography } from "antd";
import Link from "next/link";
import { productCategoryHref } from "@/lib/admin/productCatalog";

export interface ProductCategory { id: string; name: string; sortOrder: number; productCount: number; }

export function ProductCategoryCards({ categories, error }: { categories: ProductCategory[]; error: string | null }) {
  if (error) return <Alert type="error" showIcon message="Не вдалося завантажити категорії" description={error} />;
  if (!categories.length) return <Empty className="py-12" description="Категорій у каталозі немає" />;
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {categories.map((category) => <Link key={category.id} href={productCategoryHref(category.id)} className="block rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"><Card hoverable className="h-full" size="small">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Typography.Text strong className="block truncate text-base">{category.name}</Typography.Text>
          <Typography.Text type="secondary" className="mt-1 block text-xs">{category.id === "__unknown" ? "Категорію не вказано" : `ID: ${category.id}`}</Typography.Text>
        </div>
        <AppstoreOutlined className="text-lg text-brand-600" />
      </div>
      <div className="mt-4"><Tag color="blue">{category.productCount} {category.productCount === 1 ? "продукт" : "продуктів"}</Tag></div>
    </Card></Link>)}
  </div>;
}
