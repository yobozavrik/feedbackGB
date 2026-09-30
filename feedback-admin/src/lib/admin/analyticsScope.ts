/** Current-selected-roster scope. Historical applicability is explicitly not inferred. */
export type AnalyticsScope = { spotIds: number[] | null; historicalRosterVerified: false };

function validateSelectedIds(ids: number[] | null): void {
  if (ids !== null && (!ids.length || ids.length > 100 ||
    ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length)) {
    throw new Error("invalid_analytics_scope");
  }
}

export function parseAnalyticsScope(params: URLSearchParams): AnalyticsScope {
  if (params.getAll("spot_id").length > 1 || params.getAll("spot_ids").length > 1) {
    throw new Error("duplicate_analytics_scope");
  }
  if (params.has("spot_id") && params.has("spot_ids")) throw new Error("conflicting_analytics_scope");
  const raw = params.get("spot_ids") ?? params.get("spot_id");
  if (raw === null || raw === "all") return { spotIds: null, historicalRosterVerified: false };
  const parts = raw.split(",");
  if (!parts.length || parts.length > 100 || (params.has("spot_id") && parts.length !== 1) ||
      parts.some(value => !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))) {
    throw new Error("invalid_analytics_scope");
  }
  const ids = parts.map(Number);
  if (new Set(ids).size !== ids.length) throw new Error("invalid_analytics_scope");
  return { spotIds: ids.sort((a, b) => a - b), historicalRosterVerified: false };
}

export function resolveAnalyticsSpotIds(scope: AnalyticsScope, verifiedCurrentIds: readonly number[]): number[] {
  validateSelectedIds(scope.spotIds);
  if (!verifiedCurrentIds.length || verifiedCurrentIds.length > 100 ||
      verifiedCurrentIds.some(id => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(verifiedCurrentIds).size !== verifiedCurrentIds.length) throw new Error("invalid_analytics_roster");
  if (scope.spotIds && scope.spotIds.some(id => !verifiedCurrentIds.includes(id))) throw new Error("unknown_analytics_spot");
  return [...(scope.spotIds ?? verifiedCurrentIds)].sort((a, b) => a - b);
}

export function applyAnalyticsScopeQuery(params: URLSearchParams, scope: AnalyticsScope): URLSearchParams {
  validateSelectedIds(scope.spotIds);
  const result = new URLSearchParams(params);
  result.delete("spot_id"); result.delete("spot_ids");
  result.set("spot_ids", scope.spotIds === null ? "all" : scope.spotIds.join(","));
  return result;
}
