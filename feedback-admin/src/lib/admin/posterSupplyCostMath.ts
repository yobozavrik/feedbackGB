export type SupplyLine = {
  ingredientId: number;
  unit: "kg" | "l" | "p";
  quantity: number;
  sumMinor: number;
};

export type SupplyAverage = {
  ingredientId: number;
  unit: "kg" | "l" | "p";
  totalQuantity: number;
  totalSumMinor: number;
  supplyCount: number;
};

export type RecipeAmount = { brutto: number | null; unit: string | null };

export function kyivSupplyWindow(now: Date): { from: string; to: string } {
  const to = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
  const first = new Date(`${to}T00:00:00Z`);
  first.setUTCDate(first.getUTCDate() - 29);
  return { from: first.toISOString().slice(0, 10), to };
}

export function parseSupplyLines(value: unknown): SupplyLine[] {
  if (!Array.isArray(value)) throw new Error("invalid_supply_lines");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("invalid_supply_line");
    const row = item as Record<string, unknown>;
    const ingredientId = Number(row.ingredient_id);
    const quantity = Number(row.supply_ingredient_num);
    const sumMinor = Number(row.supply_ingredient_sum);
    const unit = row.ingredient_unit;
    if (!Number.isSafeInteger(ingredientId) || ingredientId <= 0 ||
      !Number.isFinite(quantity) || quantity <= 0 ||
      !Number.isSafeInteger(sumMinor) || sumMinor < 0 ||
      (unit !== "kg" && unit !== "l" && unit !== "p")) throw new Error("invalid_supply_line");
    return { ingredientId, quantity, sumMinor, unit };
  });
}

export function aggregateSupplyLines(documents: SupplyLine[][]): SupplyAverage[] {
  const groups = new Map<string, SupplyAverage>();
  for (const lines of documents) {
    const seen = new Set<string>();
    for (const line of lines) {
      const key = `${line.ingredientId}:${line.unit}`;
      const group = groups.get(key) ?? {
        ingredientId: line.ingredientId, unit: line.unit,
        totalQuantity: 0, totalSumMinor: 0, supplyCount: 0,
      };
      group.totalQuantity += line.quantity;
      group.totalSumMinor += line.sumMinor;
      if (!seen.has(key)) group.supplyCount += 1;
      groups.set(key, group);
      seen.add(key);
    }
  }
  return [...groups.values()];
}

export function recipeQuantityInSupplyUnit(recipe: RecipeAmount, supplyUnit: SupplyAverage["unit"]): number | null {
  const amount = recipe.brutto;
  if (amount === null || !Number.isFinite(amount) || amount < 0) return null;
  if (recipe.unit === supplyUnit) return amount;
  if (recipe.unit === "g" && supplyUnit === "kg") return amount / 1000;
  if (recipe.unit === "ml" && supplyUnit === "l") return amount / 1000;
  return null;
}

export function costFromSupplyAverage(recipe: RecipeAmount, average: SupplyAverage): number | null {
  const quantity = recipeQuantityInSupplyUnit(recipe, average.unit);
  if (quantity === null || average.totalQuantity <= 0) return null;
  return (average.totalSumMinor / average.totalQuantity) * quantity;
}
