/** Offline ingredient reference, not a food-recognition model or diet prescription. */
export const FOOD_DATA_VERSION = "usda-sr-legacy-asha-2026-11-10";
export const CALCULATOR_VERSION = "1.0.0";
export const NUTRIENTS = Object.freeze({
  kcal: { en: "Energy", bn: "শক্তি", unit: "kcal" },
  protein: { en: "Protein", bn: "প্রোটিন", unit: "g" },
  fat: { en: "Fat", bn: "চর্বি", unit: "g" },
  carbohydrate: { en: "Carbohydrate", bn: "শর্করা", unit: "g" },
  fiber: { en: "Fibre", bn: "আঁশ", unit: "g" },
  sodium: { en: "Sodium", bn: "সোডিয়াম", unit: "mg" },
});

function food(id, fdcId, en, bn, description, values, aliases = []) {
  return Object.freeze({
    id,
    fdcId,
    en,
    bn,
    description,
    aliases: Object.freeze(aliases),
    per100g: Object.freeze(
      Object.fromEntries(
        Object.keys(NUTRIENTS).map((key, i) => [key, values[i]]),
      ),
    ),
    source: Object.freeze({
      publisher: "USDA FoodData Central",
      type: "SR Legacy",
      published: "2019-04-01",
      retrieved: "2026-11-10",
      license: "CC0-1.0",
      url: `https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients`,
    }),
  });
}

// Per 100 g edible food, in this order: kcal, protein/fat/carbohydrate/fibre (g), sodium (mg).
// Food state is part of its identity. Cooked rice must never be matched to dry rice.
export const FOODS = Object.freeze([
  food(
    "rice-cooked",
    168878,
    "Rice · cooked",
    "ভাত · রান্না করা",
    "Rice, white, long-grain, regular, enriched, cooked",
    [130, 2.69, 0.28, 28.2, 0.4, 1],
    ["bhat", "ভাত", "সাদা ভাত"],
  ),
  food(
    "lentils-boiled",
    172421,
    "Lentils · boiled, unsalted",
    "মসুর ডাল · সেদ্ধ, লবণ ছাড়া",
    "Lentils, mature seeds, cooked, boiled, without salt",
    [116, 9.02, 0.38, 20.1, 7.9, 2],
    ["dal", "daal", "ডাল", "মসুর"],
  ),
  food(
    "potato-boiled",
    170440,
    "Potato · boiled, peeled, unsalted",
    "আলু · সেদ্ধ, খোসা ও লবণ ছাড়া",
    "Potatoes, boiled, cooked without skin, flesh, without salt",
    [86, 1.71, 0.1, 20, 1.8, 5],
    ["alu", "aloo", "আলু"],
  ),
  food(
    "banana",
    173944,
    "Banana · edible portion",
    "কলা · খোসা ছাড়া",
    "Bananas, raw",
    [89, 1.09, 0.33, 22.8, 2.6, 1],
    ["kola", "কলা"],
  ),
  food(
    "chicken-roasted",
    171477,
    "Chicken breast · roasted, skinless",
    "মুরগির বুকের মাংস · রোস্ট, চামড়া ছাড়া",
    "Chicken, broilers or fryers, breast, meat only, cooked, roasted",
    [165, 31, 3.57, 0, 0, 74],
    ["chicken", "মুরগি"],
  ),
  food(
    "tilapia-cooked",
    175177,
    "Tilapia · cooked, dry heat",
    "তেলাপিয়া · শুকনো তাপে রান্না",
    "Fish, tilapia, cooked, dry heat",
    [128, 26.2, 2.65, 0, 0, 56],
    ["fish", "mach", "maach", "মাছ", "তেলাপিয়া"],
  ),
  food(
    "carrot-raw",
    170393,
    "Carrot · raw",
    "গাজর · কাঁচা",
    "Carrots, raw",
    [41, 0.93, 0.24, 9.58, 2.8, 69],
    ["gajor", "গাজর"],
  ),
  food(
    "spinach-raw",
    168462,
    "Spinach · raw",
    "পালং শাক · কাঁচা",
    "Spinach, raw",
    [23, 2.86, 0.39, 3.63, 2.2, 79],
    ["palong", "শাক", "পালং"],
  ),
  food(
    "soybean-oil",
    171411,
    "Soybean oil · retained in serving",
    "সয়াবিন তেল · আপনার অংশে থাকা",
    "Oil, soybean, salad or cooking",
    [884, 0, 100, 0, 0, 0],
    ["oil", "tel", "তেল", "সয়াবিন"],
  ),
  food(
    "salt",
    173468,
    "Table salt · retained in serving",
    "লবণ · আপনার অংশে থাকা",
    "Salt, table",
    [0, 0, 0, 0, 0, 38800],
    ["salt", "lobon", "লবণ"],
  ),
  food(
    "sugar",
    169655,
    "Granulated sugar",
    "চিনি",
    "Sugars, granulated",
    [387, 0, 0, 100, 0, 1],
    ["sugar", "chini", "চিনি"],
  ),
]);

// These are ASHA-authored editable assembly examples, NOT measured Bangladesh recipe entries.
// Weights refer to the edible ingredient state named above, including retained oil/salt.
export const RECIPE_TEMPLATES = Object.freeze(
  [
    {
      id: "rice",
      en: "Rice",
      bn: "ভাত",
      items: [["rice-cooked", 150]],
      assumption: "Cooked edible rice. Change the weight to your own portion.",
    },
    {
      id: "dal",
      en: "Dal · ingredient estimate",
      bn: "ডাল · উপকরণের আনুমানিক হিসাব",
      items: [
        ["lentils-boiled", 100],
        ["soybean-oil", 3],
        ["salt", 0.5],
      ],
      assumption:
        "Boiled lentil solids plus oil and salt in your portion; water adds weight, not these nutrients. Watery dal needs its lentil solids confirmed.",
    },
    {
      id: "bhorta",
      en: "Potato bhorta · ingredient estimate",
      bn: "আলু ভর্তা · উপকরণের আনুমানিক হিসাব",
      items: [
        ["potato-boiled", 120],
        ["soybean-oil", 4],
        ["salt", 0.5],
      ],
      assumption:
        "Boiled potato plus soybean oil and salt only. Onion, chilli and any other ingredients are not included.",
    },
    {
      id: "fish-curry",
      en: "Fish curry · ingredient estimate",
      bn: "মাছের ঝোল · উপকরণের আনুমানিক হিসাব",
      items: [
        ["tilapia-cooked", 100],
        ["soybean-oil", 5],
        ["salt", 0.7],
      ],
      assumption:
        "Cooked tilapia is a proxy, not all local fish. Gravy and spices are not included; adjust actual retained oil and ingredients.",
    },
    {
      id: "vegetables",
      en: "Vegetables · ingredient estimate",
      bn: "সবজি · উপকরণের আনুমানিক হিসাব",
      items: [
        ["carrot-raw", 60],
        ["spinach-raw", 40],
        ["soybean-oil", 3],
        ["salt", 0.4],
      ],
      assumption:
        "Raw ingredient weights before cooking. No nutrient-retention or water-loss factor is assumed.",
    },
    {
      id: "biryani",
      en: "Chicken rice / biryani · ingredient estimate",
      bn: "চিকেন ভাত / বিরিয়ানি · উপকরণের আনুমানিক হিসাব",
      items: [
        ["rice-cooked", 180],
        ["chicken-roasted", 75],
        ["soybean-oil", 10],
        ["salt", 1],
      ],
      assumption:
        "Assembly estimate using cooked rice and roasted skinless chicken. Ghee, yoghurt, potato and spices are not included; recipes vary greatly.",
    },
  ].map((recipe) =>
    Object.freeze({
      ...recipe,
      items: Object.freeze(recipe.items.map((item) => Object.freeze(item))),
    }),
  ),
);

export function getFood(id) {
  return FOODS.find((item) => item.id === id);
}

export function searchFoods(query = "") {
  const words = String(query)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return FOODS.filter((item) =>
    words.every((word) =>
      `${item.en} ${item.bn} ${item.description} ${item.aliases.join(" ")}`
        .toLocaleLowerCase()
        .includes(word),
    ),
  );
}

function nonNegative(value, label, max = 20000) {
  if (
    !["number", "string"].includes(typeof value) ||
    (typeof value === "string" && !value.trim()) ||
    !Number.isFinite(Number(value))
  ) {
    throw new TypeError(`${label} must be a number.`);
  }
  const n = Number(value);
  if (n < 0 || n > max)
    throw new RangeError(`${label} must be between 0 and ${max}.`);
  return n;
}

/** Serving weights are declared by the user, never inferred from the photo. */
export function toGrams(amount, unit = "g", gramsPerServing) {
  const n = nonNegative(amount, "Portion");
  if (unit === "g") return n;
  if (unit !== "serving")
    throw new RangeError("Use grams or a declared serving.");
  const serving = nonNegative(gramsPerServing, "Grams per serving");
  if (!serving)
    throw new RangeError("Grams per serving must be greater than zero.");
  return nonNegative(n * serving, "Portion grams");
}

/**
 * @param {{ingredients:Array<{foodId:string,grams:number,minGrams?:number,maxGrams?:number}>,cookingMethod?:string,assumptions?:string[]}} meal
 * Range is an arithmetic bound from declared ingredient weights, NOT a statistical confidence interval.
 */
export function calculateMeal(meal) {
  if (!Array.isArray(meal?.ingredients) || !meal.ingredients.length)
    throw new RangeError("Add at least one ingredient.");
  if (meal.ingredients.length > 100)
    throw new RangeError("Use at most 100 ingredients.");
  const nutrients = Object.fromEntries(
    Object.keys(NUTRIENTS).map((key) => [
      key,
      { min: 0, max: 0, unit: NUTRIENTS[key].unit },
    ]),
  );
  const ingredients = meal.ingredients.map((item) => {
    const ref = getFood(item.foodId);
    if (!ref)
      throw new RangeError(
        `Unknown food reference: ${String(item.foodId).slice(0, 80)}`,
      );
    const grams = nonNegative(item.grams, "Ingredient grams");
    const minGrams =
      item.minGrams === undefined
        ? grams
        : nonNegative(item.minGrams, "Minimum grams");
    const maxGrams =
      item.maxGrams === undefined
        ? grams
        : nonNegative(item.maxGrams, "Maximum grams");
    if (minGrams > grams || maxGrams < grams)
      throw new RangeError("Weight range must contain the chosen grams.");
    for (const key of Object.keys(NUTRIENTS)) {
      const value = ref.per100g[key];
      if (!Number.isFinite(value))
        throw new TypeError(
          `Missing ${key} in ${ref.id}; do not treat missing data as zero.`,
        );
      nutrients[key].min += (value * minGrams) / 100;
      nutrients[key].max += (value * maxGrams) / 100;
    }
    return {
      foodId: ref.id,
      grams,
      minGrams,
      maxGrams,
      reference: ref.description,
      fdcId: ref.fdcId,
      source: ref.source,
    };
  });
  if (!ingredients.some((item) => item.grams > 0))
    throw new RangeError("The meal must contain a positive weight.");
  return {
    ingredients,
    nutrients,
    databaseVersion: FOOD_DATA_VERSION,
    calculatorVersion: CALCULATOR_VERSION,
    cookingMethod: String(meal.cookingMethod || "as listed").slice(0, 200),
    assumptions: [
      ...new Set([
        ...(meal.assumptions || []).map(String),
        "Edible ingredient weights and retained oil/salt must be confirmed. Hidden ingredients are not inferred.",
        "Ranges cover only entered weight bounds; recipe, variety and food-table errors are not quantified.",
        "Cooking label is recorded; no unverified nutrient-retention factor is applied.",
      ]),
    ],
  };
}

export function templateMeal(id) {
  const recipe = RECIPE_TEMPLATES.find((item) => item.id === id);
  if (!recipe) throw new RangeError("Unknown recipe.");
  return {
    name: recipe.en,
    templateId: id,
    assumptions: [recipe.assumption],
    ingredients: recipe.items.map(([foodId, grams]) => ({
      foodId,
      grams,
      minGrams: grams,
      maxGrams: grams,
    })),
  };
}

/** Generic image-quality heuristics only. They cannot establish food identity or occlusion. */
export function checkPhotoQuality(rgba, width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 3 ||
    height < 3 ||
    width * height > 4e6 ||
    !rgba ||
    rgba.length !== width * height * 4
  )
    throw new RangeError(
      "Provide an RGBA image between 3 pixels and 4 megapixels.",
    );
  const gray = new Float32Array(width * height);
  let total = 0;
  for (let i = 0; i < gray.length; i++) {
    gray[i] =
      0.2126 * rgba[i * 4] +
      0.7152 * rgba[i * 4 + 1] +
      0.0722 * rgba[i * 4 + 2];
    total += gray[i];
  }
  let lap = 0,
    lap2 = 0,
    count = 0;
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const v =
        gray[i - 1] +
        gray[i + 1] +
        gray[i - width] +
        gray[i + width] -
        4 * gray[i];
      lap += v;
      lap2 += v * v;
      count++;
    }
  const brightness = total / gray.length;
  const laplacianVariance = Math.max(0, lap2 / count - (lap / count) ** 2);
  const warnings = [];
  if (brightness < 45) warnings.push("low_light");
  if (brightness > 225) warnings.push("overexposed");
  if (laplacianVariance < 25) warnings.push("low_detail_or_blur");
  if (Math.min(width, height) < 160) warnings.push("low_resolution");
  return {
    brightness,
    laplacianVariance,
    warnings,
    occlusion: "unknown",
    heuristicVersion: "1.0.0",
    validated: false,
  };
}

export function foodVisionStatus() {
  return {
    available: false,
    model_id: null,
    reason:
      "No licensed, validated food-trained weights are installed. Choose foods and confirm amounts manually.",
  };
}
