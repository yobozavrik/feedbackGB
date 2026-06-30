import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE, isSuperAdmin } from "@/lib/session";
import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { buildFunnelSnapshot } from "@/lib/posthog/funnel";
import { FunnelClient } from "./funnel-client";

export const dynamic = "force-dynamic";

const DEFAULT_PERIOD_DAYS = 30 as const;

export default async function FunnelPage() {
  const sess = await verifySession(cookies().get(SESSION_COOKIE)?.value);
  const isSuper = sess && isSuperAdmin(sess.role);

  return (
    <AdminPageContainer
      title="Воронка"
      subTitle="Де відвалюються користувачі — від PIN-логіну до збереженого фідбеку. Дані з PostHog."
    >
      {!isSuper ? (
        <div className="card p-6 text-center">
          <div className="text-3xl">🔒</div>
          <h2 className="mt-3 text-lg font-bold text-ink-900">Доступ обмежено</h2>
          <p className="mt-2 text-[14px] text-ink-500 max-w-md mx-auto">
            Цей розділ доступний виключно для ролі <strong>Супер-адмін</strong>.
          </p>
        </div>
      ) : (
        <FunnelClient initial={await buildFunnelSnapshot(DEFAULT_PERIOD_DAYS)} />
      )}
    </AdminPageContainer>
  );
}
