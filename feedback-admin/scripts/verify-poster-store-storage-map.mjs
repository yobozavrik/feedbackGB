/** Read-only current Poster spot -> storage inventory. Prints IDs/names only. */
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const envLoader = require("@next/env");
const inheritedEnv = { ...process.env };
envLoader.loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const appEnv = { ...process.env };
envLoader.loadEnvConfig(path.resolve(process.cwd(), ".."), false, { info() {}, error() {} }, true);
const token = inheritedEnv.POSTER_TOKEN ?? appEnv.POSTER_TOKEN ?? process.env.POSTER_TOKEN;

function positiveId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("poster_mapping_invalid_id");
  return id;
}

try {
  if (process.argv.length !== 2) throw new Error("poster_mapping_arguments_not_supported");
  if (!token) throw new Error("poster_token_missing");
  const url = new URL("https://joinposter.com/api/access.getSpots");
  url.searchParams.set("token", token);
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("poster_mapping_source_unavailable");
  const body = await response.json();
  if (!body || body.error || !Array.isArray(body.response) || body.response.length < 1 || body.response.length > 100) {
    throw new Error("poster_mapping_source_invalid");
  }
  const spots = body.response.map((spot) => {
    const spotId = positiveId(spot.spot_id);
    const spotName = typeof spot.spot_name === "string" ? spot.spot_name.trim() : "";
    if (!spotName || !Array.isArray(spot.storages)) throw new Error("poster_mapping_source_invalid");
    const storageIds = spot.storages.map((storage) => positiveId(storage.storage_id));
    if (new Set(storageIds).size !== storageIds.length) throw new Error("poster_mapping_duplicate_storage");
    return { spotId, spotName, storageIds: storageIds.sort((a, b) => a - b),
      mappingStatus: storageIds.length === 1 ? "unique" : storageIds.length === 0 ? "missing" : "ambiguous" };
  }).sort((a, b) => a.spotId - b.spotId);
  if (new Set(spots.map((spot) => spot.spotId)).size !== spots.length) throw new Error("poster_mapping_duplicate_spot");
  console.log(JSON.stringify({ source: "Poster access.getSpots", capturedAt: new Date().toISOString(),
    currentRosterOnly: true, spotCount: spots.length, spots }, null, 2));
} catch (error) {
  const code = error instanceof Error && /^poster_[a-z_]{1,80}$/.test(error.message)
    ? error.message : "poster_mapping_failed";
  console.error(JSON.stringify({ status: "failed", code }));
  process.exitCode = 1;
}
