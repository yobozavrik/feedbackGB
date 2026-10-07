import { NextResponse } from "next/server";
import { adminUtilityContext } from "@/lib/admin/utilityAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const categories = ["electricity", "water", "heating", "other"] as const;
const uuid = (value: string | null): value is string => !!value && /^[0-9a-f-]{36}$/i.test(value);

export async function GET(req: Request) {
  if (process.env.NEXT_PUBLIC_UTILITY_READINGS_ENABLED !== "true") {
    return NextResponse.json({ error: "feature_disabled" }, { status: 404 });
  }
  const context = await adminUtilityContext();
  if ("error" in context) return NextResponse.json({ error: context.error }, { status: context.status });
  const periodId = new URL(req.url).searchParams.get("period_id");
  if (!uuid(periodId)) return NextResponse.json({ error: "invalid_period" }, { status: 400 });
  const { db } = context;
  const [periodResult, storesResult, submissionsResult] = await Promise.all([
    db.from("utility_periods").select("id,period_start,period_end,due_at,status").eq("id", periodId).maybeSingle(),
    db.from("v_stores").select("id,name,is_active", { count: "exact" }).eq("is_active", true).order("name").limit(1000),
    db.from("utility_submissions").select("id,store_id,category,review_status,revision,submitted_at", { count: "exact" })
      .eq("period_id", periodId).is("superseded_at", null).limit(1000),
  ]);
  if (periodResult.error || storesResult.error || submissionsResult.error || !periodResult.data) {
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }
  if ((storesResult.count ?? 0) > (storesResult.data?.length ?? 0)
    || (submissionsResult.count ?? 0) > (submissionsResult.data?.length ?? 0)) {
    return NextResponse.json({ error: "coverage_limit_exceeded" }, { status: 507 });
  }
  const submissions = submissionsResult.data ?? [];
  const ids = submissions.map((item) => item.id);
  const [photosResult, jobsResult] = ids.length ? await Promise.all([
    db.from("utility_photos").select("submission_id", { count: "exact" }).in("submission_id", ids).limit(1000),
    db.from("utility_delivery_jobs").select("submission_id,state,attempts,sent_at,last_error_code", { count: "exact" })
      .in("submission_id", ids).limit(1000),
  ]) : [{ data: [], error: null, count: 0 }, { data: [], error: null, count: 0 }];
  if (photosResult.error || jobsResult.error) return NextResponse.json({ error: "query_failed" }, { status: 500 });
  if ((photosResult.count ?? 0) > (photosResult.data?.length ?? 0)
    || (jobsResult.count ?? 0) > (jobsResult.data?.length ?? 0)) {
    return NextResponse.json({ error: "coverage_limit_exceeded" }, { status: 507 });
  }
  const rows = (storesResult.data ?? []).flatMap((store) => categories.map((category) => {
    const submission = submissions.find((item) => item.store_id === store.id && item.category === category) ?? null;
    return { store_id: store.id, store_name: store.name, category,
      status: submission ? "submitted" : "missing",
      photo_count: (photosResult.data ?? []).filter((photo) => photo.submission_id === submission?.id).length,
      submission, delivery: (jobsResult.data ?? []).find((job) => job.submission_id === submission?.id) ?? null };
  }));
  rows.sort((a, b) => a.store_name.localeCompare(b.store_name, "uk")
    || categories.indexOf(a.category) - categories.indexOf(b.category));
  return NextResponse.json({ period: periodResult.data, rows });
}
