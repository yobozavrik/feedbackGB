import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  signSupplySession,
  verifySupplySession,
  type SupplySession,
} from "@/lib/session";

const base: SupplySession = {
  uid: "11111111-1111-1111-1111-111111111111",
  full_name: "Тест",
  role: "supply_worker",
  facility_id: null,
  iat: Date.now(),
};

const prevSecret = process.env.SUPPLY_SESSION_SECRET;
const prevEnv = process.env.NODE_ENV;

beforeEach(() => {
  process.env.SUPPLY_SESSION_SECRET = "x".repeat(40);
});
afterEach(() => {
  process.env.SUPPLY_SESSION_SECRET = prevSecret;
  (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
});

describe("supply session", () => {
  it("round-trips a valid session", async () => {
    const token = await signSupplySession(base);
    const out = await verifySupplySession(token);
    expect(out?.uid).toBe(base.uid);
    expect(out?.role).toBe("supply_worker");
  });

  it("rejects a tampered signature", async () => {
    const token = await signSupplySession(base);
    const [body] = token.split(".");
    expect(await verifySupplySession(`${body}.deadbeef`)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const token = await signSupplySession({ ...base, iat: Date.now() - 13 * 60 * 60 * 1000 });
    expect(await verifySupplySession(token)).toBeNull();
  });

  it("rejects an iat in the future", async () => {
    const token = await signSupplySession({ ...base, iat: Date.now() + 5 * 60 * 1000 });
    expect(await verifySupplySession(token)).toBeNull();
  });

  it("rejects an unknown role", async () => {
    const token = await signSupplySession({ ...base, role: "seller" as SupplySession["role"] });
    expect(await verifySupplySession(token)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSupplySession(base);
    process.env.SUPPLY_SESSION_SECRET = "y".repeat(40);
    expect(await verifySupplySession(token)).toBeNull();
  });

  it("returns null for undefined/empty token", async () => {
    expect(await verifySupplySession(undefined)).toBeNull();
    expect(await verifySupplySession("")).toBeNull();
  });
});
