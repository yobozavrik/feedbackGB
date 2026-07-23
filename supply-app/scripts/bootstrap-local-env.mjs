import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, ".env.local");
const adminEnv = resolve(root, "..", "feedback-admin", ".env.local");

if (existsSync(target)) throw new Error("supply-app/.env.local already exists; it was not changed.");
if (!existsSync(adminEnv)) throw new Error("feedback-admin/.env.local is required for local bootstrap.");

const source = readFileSync(adminEnv, "utf8");
const take = (key) => source.match(new RegExp(`^${key}=(.+)$`, "m"))?.[1]?.trim();
const url = take("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = take("SUPABASE_SERVICE_ROLE_KEY");
if (!url || !serviceKey) throw new Error("Admin local env does not contain required Supabase variables.");

writeFileSync(target, [
  `NEXT_PUBLIC_SUPABASE_URL=${url}`,
  `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
  `SUPPLY_SESSION_SECRET=${randomBytes(32).toString("base64url")}`,
  "",
].join("\n"), { encoding: "utf8", mode: 0o600 });
console.log("supply-app/.env.local created with separate Supply session secret.");
