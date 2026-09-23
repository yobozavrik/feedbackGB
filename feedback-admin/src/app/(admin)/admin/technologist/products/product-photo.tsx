"use client";

import { PictureOutlined } from "@ant-design/icons";
import { theme } from "antd";
import { useEffect, useState } from "react";
import { posterPhotoUrl } from "@/lib/admin/productCatalog";

export function ProductPhoto({ photo, name, className = "" }: { photo: string | null; name: string; className?: string }) {
  const { token } = theme.useToken();
  const url = posterPhotoUrl(photo);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!url || failed) return <div className={`flex items-center justify-center rounded-lg ${className}`} style={{ background: token.colorFillTertiary, color: token.colorTextTertiary }} aria-label={`Фото для ${name} відсутнє`}><PictureOutlined className="text-2xl" /></div>;
  // Product photos come from the existing POS catalog and can be on its CDN.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={name} loading="lazy" onError={() => setFailed(true)} style={{ background: token.colorFillTertiary }} className={`rounded-lg object-cover ${className}`} />;
}
