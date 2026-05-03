import { AdminPageContainer } from "@/components/admin/AdminPageContainer";
import { buildFunnelSnapshot } from "@/lib/posthog/funnel";
import { FunnelClient } from "./funnel-client";

export const dynamic = "force-dynamic";

const DEFAULT_PERIOD_DAYS = 30 as const;

/**
 * /admin/funnel
 *
 * Server-rendered shell that fetches the initial PostHog funnel snapshot
 * for the default 30-day window. The client component owns period
 * switching and re-fetches via `/api/admin/funnel?period=…`.
 *
 * If `POSTHOG_PERSONAL_API_KEY` is missing the snapshot returns an error
 * field and the client renders a friendly empty state.
 */
export default async function FunnelPage() {
  const initial = await buildFunnelSnapshot(DEFAULT_PERIOD_DAYS);
  return (
    <AdminPageContainer
      title="Воронка"
      subTitle="Де відвалюються користувачі — від PIN-логіну до збереженого фідбеку. Дані з PostHog."
    >
      <FunnelClient initial={initial} />
    </AdminPageContainer>
  );
}
