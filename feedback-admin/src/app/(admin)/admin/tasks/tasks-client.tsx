"use client";

import { Segmented } from "antd";
import { useState } from "react";
import { AdminClient } from "../admin-client";
import type { CategoryMeta } from "@/lib/feedFormat";
import type { AdminOption, FeedRow } from "../page";

interface Props {
  myRows: FeedRow[];
  availableRows: FeedRow[];
  stores: string[];
  categories: CategoryMeta[];
  admins: AdminOption[];
  currentAdminId: string;
}

type Tab = "mine" | "available";

/**
 * Splits "Мої завдання" into two views:
 *   - "Мої завдання": feedback.assigned_to === me (unchanged behavior).
 *   - "Доступні в моїх напрямках": unassigned feedback that falls under a
 *     direction I share with other admins (see
 *     feedback-admin/docs/ADMIN_DIRECTIONS_PLAN.md). Picking one via the
 *     FeedDrawer "Відповідальний" control claims it — it then moves to
 *     "Мої завдання" for me and disappears from this tab for everyone else.
 *
 * Both tabs reuse AdminClient (same table/drawer/realtime component as the
 * main feed) — only one is mounted at a time, so there's no duplicate
 * realtime subscription.
 */
export function TasksClient({ myRows, availableRows, stores, categories, admins, currentAdminId }: Props) {
  const [tab, setTab] = useState<Tab>("mine");

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Segmented<Tab>
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          size="large"
          options={[
            { label: `Мої завдання (${myRows.length})`, value: "mine" },
            { label: `Доступні в моїх напрямках (${availableRows.length})`, value: "available" },
          ]}
        />
      </div>

      {tab === "mine" ? (
        <AdminClient
          rows={myRows}
          stores={stores}
          admins={admins}
          currentAdminId={currentAdminId}
          assignedToMeOnly
          categories={categories}
        />
      ) : (
        <AdminClient
          rows={availableRows}
          stores={stores}
          admins={admins}
          currentAdminId={currentAdminId}
          categories={categories}
        />
      )}
    </>
  );
}
