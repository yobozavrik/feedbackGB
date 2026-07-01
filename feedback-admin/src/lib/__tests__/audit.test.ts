import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFrom = vi.fn();
vi.mock("@/lib/supabase", () => ({
  getServerSupabase: vi.fn(),
}));

import { getServerSupabase } from "@/lib/supabase";
import { ipFromRequest, logAudit, uaFromRequest } from "../audit";

describe("logAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing (no throw, no insert) when Supabase is not configured", async () => {
    vi.mocked(getServerSupabase).mockReturnValue(null as any);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      logAudit("auth.login.success", { actorUserId: "u1" }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[audit] Supabase not configured; event dropped:",
      "auth.login.success",
    );
  });

  it("inserts a row with actor = actorUserId when provided", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertMock });
    vi.mocked(getServerSupabase).mockReturnValue({ from: mockFrom } as any);

    await logAudit("admin.user.pin_reset", {
      actorUserId: "admin-1",
      targetUserId: "user-2",
      targetType: "user",
      ip: "1.2.3.4",
      userAgent: "test-ua",
      meta: { note: "reset" },
    });

    expect(mockFrom).toHaveBeenCalledWith("audit_log");
    expect(insertMock).toHaveBeenCalledWith({
      action: "admin.user.pin_reset",
      actor: "admin-1",
      actor_user_id: "admin-1",
      target_user_id: "user-2",
      target_type: "user",
      feedback_id: null,
      ip: "1.2.3.4",
      user_agent: "test-ua",
      meta: { note: "reset" },
    });
  });

  it("falls back actor to meta.actor_label when actorUserId is absent", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertMock });
    vi.mocked(getServerSupabase).mockReturnValue({ from: mockFrom } as any);

    await logAudit("auth.login.failure", {
      meta: { actor_label: "anon-scraper", ip_attempts_remaining: 3 },
    });

    const row = insertMock.mock.calls[0]![0];
    expect(row.actor).toBe("anon-scraper");
    expect(row.actor_user_id).toBeNull();
  });

  it("falls back actor to 'service_role' when neither actorUserId nor meta.actor_label is given", async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertMock });
    vi.mocked(getServerSupabase).mockReturnValue({ from: mockFrom } as any);

    await logAudit("admin.mirror_to_drive", {});

    const row = insertMock.mock.calls[0]![0];
    expect(row.actor).toBe("service_role");
  });

  it("never throws when the insert itself fails (fire-and-forget)", async () => {
    const insertMock = vi
      .fn()
      .mockResolvedValue({ error: { code: "23503", message: "fk violation" } });
    mockFrom.mockReturnValue({ insert: insertMock });
    vi.mocked(getServerSupabase).mockReturnValue({ from: mockFrom } as any);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      logAudit("admin.feedback.note", { feedbackId: "f-1" }),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[audit] insert failed",
      expect.objectContaining({ action: "admin.feedback.note", code: "23503" }),
    );
  });
});

describe("ipFromRequest", () => {
  it("returns the first address from x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.5, 70.41.3.18, 150.172.238.178" },
    });
    expect(ipFromRequest(req)).toBe("203.0.113.5");
  });

  it("trims whitespace around the first address", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "  203.0.113.5  , 70.41.3.18" },
    });
    expect(ipFromRequest(req)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "198.51.100.7" },
    });
    expect(ipFromRequest(req)).toBe("198.51.100.7");
  });

  it("returns null when neither header is present", () => {
    const req = new Request("http://localhost");
    expect(ipFromRequest(req)).toBeNull();
  });
});

describe("uaFromRequest", () => {
  it("returns the user-agent header as-is when under the length limit", () => {
    const req = new Request("http://localhost", {
      headers: { "user-agent": "Mozilla/5.0 Test" },
    });
    expect(uaFromRequest(req)).toBe("Mozilla/5.0 Test");
  });

  it("returns null when the header is absent", () => {
    const req = new Request("http://localhost");
    expect(uaFromRequest(req)).toBeNull();
  });

  it("truncates to the default max length (500)", () => {
    const longUa = "A".repeat(600);
    const req = new Request("http://localhost", {
      headers: { "user-agent": longUa },
    });
    const result = uaFromRequest(req);
    expect(result).toHaveLength(500);
    expect(result).toBe("A".repeat(500));
  });

  it("respects a custom maxLen", () => {
    const req = new Request("http://localhost", {
      headers: { "user-agent": "0123456789" },
    });
    expect(uaFromRequest(req, 5)).toBe("01234");
  });
});
