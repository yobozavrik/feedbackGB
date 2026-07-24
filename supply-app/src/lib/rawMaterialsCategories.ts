// Studio food photos (see docs/supply-app/STITCH_BRIEF_RAW_MATERIALS.md) keyed
// by the zakupki.workshop_categories.name they represent. Categories are now
// per-workshop, real DB rows (not a fixed UI list) — this is a cosmetic
// lookup only, matched by normalized name with a safe fallback.
const PHOTO_BY_NORMALIZED_NAME: Record<string, string> = {
  "м'ясо та птиця": "/raw-materials/meat-poultry.png",
  "риба та морепродукти": "/raw-materials/fish-seafood.png",
  "молочні продукти та сири": "/raw-materials/dairy-cheese.png",
  "овочі, зелень і гриби": "/raw-materials/vegetables-herbs-mushrooms.png",
  "фрукти, ягоди та горіхи": "/raw-materials/fruits-berries-nuts.png",
  "крупи, борошно та сухі продукти": "/raw-materials/dry-goods.png",
  "хлібобулочні вироби": "/raw-materials/bakery.png",
  "соуси, спеції та приправи": "/raw-materials/sauces-spices.png",
};

const FALLBACK_PHOTO = "/raw-materials/other-raw.png";

function normalizeCategoryName(name: string): string {
  return name.trim().toLowerCase().replace(/[‘’']/g, "'");
}

export function photoForCategoryName(name: string): string {
  return PHOTO_BY_NORMALIZED_NAME[normalizeCategoryName(name)] ?? FALLBACK_PHOTO;
}
