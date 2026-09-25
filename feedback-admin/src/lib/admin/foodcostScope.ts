export function parseFoodcostSpotId(raw: string | null): number | undefined {
  if (raw === null || raw === "all") return undefined;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error("invalid_foodcost_spot");
  const spotId = Number(raw);
  if (!Number.isSafeInteger(spotId)) throw new Error("invalid_foodcost_spot");
  return spotId;
}
