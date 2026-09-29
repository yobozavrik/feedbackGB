import { beforeEach, describe, expect, it, vi } from "vitest";
const { auth, from, configured } = vi.hoisted(() => ({ auth: vi.fn(), from: vi.fn(), configured: { value: true } }));
vi.mock("@/lib/adminAuth", () => ({ requireAdminSession: auth }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: () => configured.value ? { from } : null }));
import { GET, POST, PATCH } from "../route";
const uid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const input = { title: "Task", description: "", due_at: "2026-09-29T12:00:00Z", remind_at: null, status: "planned" };
function chain(result: unknown) {
  const query: Record<string, any> = {};
  for (const name of ["select", "eq", "in", "is", "lte", "gte", "lt", "order", "limit", "insert", "update"]) query[name] = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => result);
  query.single = vi.fn(async () => result);
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return query;
}
const req = (method: string, body: unknown, origin = "http://localhost") => new Request("http://localhost/api/admin/calendar", { method, headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });
let user: ReturnType<typeof chain>; let tasks: ReturnType<typeof chain>;
beforeEach(() => {
  vi.clearAllMocks(); configured.value = true; auth.mockResolvedValue({ uid, role: "admin" });
  user = chain({ data: { id: uid }, error: null }); tasks = chain({ data: [], error: null });
  from.mockImplementation(name => name === "users" ? user : tasks);
});
describe("calendar owner-scoped API", () => {
  it("denies unauthenticated reads", async () => { auth.mockResolvedValue(null); expect((await GET(new Request("http://localhost/api?mode=reminders"))).status).toBe(403); expect(from).not.toHaveBeenCalled(); });
  it("denies inactive owner", async () => { from.mockReturnValue(chain({ data: null, error: null })); expect((await GET(new Request("http://localhost/api?mode=reminders"))).status).toBe(403); });
  it("returns unavailable without DB", async () => { configured.value = false; expect((await POST(req("POST", input))).status).toBe(503); });
  it("scopes reminders to session owner and planned/unseen", async () => { expect((await GET(new Request("http://localhost/api?mode=reminders&owner_id=other"))).status).toBe(200); expect(tasks.eq).toHaveBeenCalledWith("owner_id", uid); expect(tasks.eq).toHaveBeenCalledWith("status", "planned"); expect(tasks.is).toHaveBeenCalledWith("reminder_seen_at", null); });
  it("bounds calendar query", async () => { expect((await GET(new Request("http://localhost/api?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z"))).status).toBe(200); expect(tasks.eq).toHaveBeenCalledWith("owner_id", uid); expect(tasks.limit).toHaveBeenCalledWith(1001); });
  it("rejects invalid range", async () => expect((await GET(new Request("http://localhost/api"))).status).toBe(400));
  it("creates with owner from cookie only", async () => { expect((await POST(req("POST", input))).status).toBe(201); expect(tasks.insert).toHaveBeenCalledWith({ ...input, due_at: "2026-09-29T12:00:00.000Z", owner_id: uid }); });
  it("rejects owner injection", async () => { expect((await POST(req("POST", { ...input, owner_id: id }))).status).toBe(400); expect(tasks.insert).not.toHaveBeenCalled(); });
  it("rejects cross-origin writes", async () => { expect((await POST(req("POST", input, "https://other.example"))).status).toBe(403); expect(from).not.toHaveBeenCalled(); });
  it("patch scopes id,owner and version", async () => { expect((await PATCH(req("PATCH", { ...input, id, row_version: 2 }))).status).toBe(200); expect(tasks.eq).toHaveBeenCalledWith("owner_id", uid); expect(tasks.eq).toHaveBeenCalledWith("id", id); expect(tasks.eq).toHaveBeenCalledWith("row_version", 2); });
  it("conflicts for missing/foreign/stale task without revealing details", async () => { tasks = chain({ data: null, error: null }); expect((await PATCH(req("PATCH", { ...input, id, row_version: 1 }))).status).toBe(409); });
  it("acknowledges own task", async () => { expect((await PATCH(req("PATCH", { id, row_version: 1, acknowledge: true }))).status).toBe(200); expect(tasks.eq).toHaveBeenCalledWith("owner_id", uid); expect(tasks.update.mock.calls[0][0]).toHaveProperty("reminder_seen_at"); });
  it("rejects acknowledge plus owner injection", async () => expect((await PATCH(req("PATCH", { id, row_version: 1, acknowledge: true, owner_id: uid }))).status).toBe(400));
  it("handles missing migration without DB detail leaks", async () => { tasks = chain({ data: null, error: { code: "42P01", message: "secret DB details" } }); const response = await GET(new Request("http://localhost/api?mode=reminders")); expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("secret"); });
  it("does not silently truncate month", async () => { tasks = chain({ data: Array(1001).fill({}), error: null }); expect((await GET(new Request("http://localhost/api?from=2026-09-01T00:00:00Z&to=2026-10-01T00:00:00Z"))).status).toBe(422); });
});
