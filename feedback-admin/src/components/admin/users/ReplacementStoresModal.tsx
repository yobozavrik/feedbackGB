"use client";

import { App, Modal, Select, Spin } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { AdminUser } from "@/app/(admin)/admin/users/page";
import { fetchReplacementStores, grantReplacementStore, revokeReplacementStore } from "@/lib/adminUsersApi";

export function ReplacementStoresModal({ target, stores, onClose }: { target: AdminUser | null; stores: Array<{ id: number; name: string }>; onClose: () => void }) {
  const { message } = App.useApp();
  const [initialIds, setInitialIds] = useState<number[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target) return;
    setLoading(true);
    void fetchReplacementStores(target.id).then((result) => {
      if (!result.ok) {
        message.error(result.error ?? "Не вдалося завантажити магазини для заміни");
        return;
      }
      const ids = result.permissions.filter((permission) => permission.revoked_at == null).map((permission) => permission.store_id);
      setInitialIds(ids);
      setSelectedIds(ids);
    }).finally(() => setLoading(false));
  }, [target, message]);

  const options = useMemo(() => stores.map((store) => ({ label: store.name, value: store.id })), [stores]);
  const save = async () => {
    if (!target) return;
    setSaving(true);
    const added = selectedIds.filter((id) => !initialIds.includes(id));
    const removed = initialIds.filter((id) => !selectedIds.includes(id));
    for (const storeId of added) {
      const result = await grantReplacementStore(target.id, storeId);
      if (!result.ok) { message.error(result.error ?? "Не вдалося видати доступ"); setSaving(false); return; }
    }
    for (const storeId of removed) {
      const result = await revokeReplacementStore(target.id, storeId);
      if (!result.ok) { message.error(result.error ?? "Не вдалося відкликати доступ"); setSaving(false); return; }
    }
    setSaving(false);
    message.success("Магазини для заміни збережено");
    onClose();
  };

  return <Modal open={target != null} title={`Магазини для заміни: ${target?.full_name ?? ""}`} okText="Зберегти" cancelText="Скасувати" confirmLoading={saving} onCancel={onClose} onOk={() => void save()} destroyOnClose>
    {loading ? <div className="py-8 text-center"><Spin /></div> : <>
      <p className="mb-3 text-sm text-gray-600">Ці магазини дають право відправити «Фото звіт», але не є підтвердженням зміни.</p>
      <Select mode="multiple" className="w-full" placeholder="Виберіть магазини" options={options} value={selectedIds} onChange={setSelectedIds} />
    </>}
  </Modal>;
}
