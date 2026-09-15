import { beforeEach, describe, expect, it, vi } from "vitest";

let session: { uid: string } | null = null;
const getServerSupabase = vi.fn();

vi.mock("@/lib/adminAuth", () => ({
  requireAdminSession: vi.fn(async () => session),
}));

vi.mock("@/lib/supabase", () => ({
  getServerSupabase,
}));

describe("photo galleries are admin-only", () => {
  beforeEach(() => {
    session = null;
    getServerSupabase.mockReset();
  });

  it("rejects an anonymous daily gallery request before touching the database", async () => {
    const { GET } = await import("@/app/api/admin/photo-report/gallery/route");
    const response = await GET(new Request("http://localhost/api/admin/photo-report/gallery?store_id=1&date=2026-09-15"));
    expect(response.status).toBe(403);
    expect(getServerSupabase).not.toHaveBeenCalled();
  });

  it("rejects an anonymous daily summary request before touching the database", async () => {
    const { GET } = await import("@/app/api/admin/photo-report/route");
    const response = await GET(new Request("http://localhost/api/admin/photo-report?date=2026-09-15"));
    expect(response.status).toBe(403);
    expect(getServerSupabase).not.toHaveBeenCalled();
  });

  it("rejects an anonymous feedback-record gallery request before touching the database", async () => {
    const { GET } = await import("@/app/api/admin/feedback/[id]/photos/route");
    const response = await GET(
      new Request("http://localhost/api/admin/feedback/00000000-0000-0000-0000-000000000001/photos"),
      { params: { id: "00000000-0000-0000-0000-000000000001" } },
    );
    expect(response.status).toBe(403);
    expect(getServerSupabase).not.toHaveBeenCalled();
  });

  it("rejects malformed daily-gallery parameters for an authenticated admin", async () => {
    session = { uid: "admin-1" };
    const { GET } = await import("@/app/api/admin/photo-report/gallery/route");
    const response = await GET(new Request("http://localhost/api/admin/photo-report/gallery?store_id=bad&date=today"));
    expect(response.status).toBe(400);
    expect(getServerSupabase).not.toHaveBeenCalled();
  });

  it("rejects malformed daily-summary parameters for an authenticated admin", async () => {
    session = { uid: "admin-1" };
    const { GET } = await import("@/app/api/admin/photo-report/route");
    const response = await GET(new Request("http://localhost/api/admin/photo-report?date=today"));
    expect(response.status).toBe(400);
    expect(getServerSupabase).not.toHaveBeenCalled();
  });
});
