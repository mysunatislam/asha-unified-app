import test from "node:test";
import assert from "node:assert/strict";
import {
  FOODS,
  FOOD_DATA_VERSION,
  NUTRIENTS,
  RECIPE_TEMPLATES,
  getFood,
  searchFoods,
  calculateMeal,
  toGrams,
  templateMeal,
  checkPhotoQuality,
  foodVisionStatus,
} from "../app/everyday/foods.js";

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const item = (foodId, grams, minGrams = grams, maxGrams = grams) => ({
  foodId,
  grams,
  minGrams,
  maxGrams,
});

test("nutrition reference records have traceable USDA IDs, units, states and a pinned local version", () => {
  assert.equal(FOODS.length, 11);
  assert.match(FOOD_DATA_VERSION, /2026-11-10/);
  assert.equal(new Set(FOODS.map((food) => food.id)).size, FOODS.length);
  assert.equal(new Set(FOODS.map((food) => food.fdcId)).size, FOODS.length);
  for (const ref of FOODS) {
    assert.ok(ref.en && ref.bn && ref.description);
    assert.equal(ref.source.license, "CC0-1.0");
    assert.equal(ref.source.type, "SR Legacy");
    assert.equal(ref.source.retrieved, "2026-11-10");
    assert.ok(ref.source.url.includes(String(ref.fdcId)));
    for (const key of Object.keys(NUTRIENTS))
      assert.ok(Number.isFinite(ref.per100g[key]) && ref.per100g[key] >= 0);
  }
  assert.match(getFood("rice-cooked").description, /cooked/);
  assert.match(getFood("spinach-raw").description, /raw/);
  assert.match(getFood("tilapia-cooked").description, /tilapia/);
});

test("English, transliteration, Bangla and multiple-term search use the same ingredient records", () => {
  assert.equal(searchFoods("ভাত")[0].id, "rice-cooked");
  assert.equal(searchFoods("bhat")[0].id, "rice-cooked");
  assert.equal(searchFoods("lentils unsalted")[0].id, "lentils-boiled");
  assert.equal(searchFoods("ডাল")[0].id, "lentils-boiled");
  assert.equal(searchFoods("  SOYBEAN oil  ")[0].id, "soybean-oil");
  assert.equal(searchFoods("unknown magic food").length, 0);
  assert.equal(searchFoods("").length, FOODS.length);
});

test("portions use grams or explicitly declared serving grams, without hidden spoon or cup conversions", () => {
  close(toGrams(150), 150);
  close(toGrams("1.5", "serving", 120), 180);
  assert.throws(() => toGrams(1, "serving"), /number/);
  assert.throws(() => toGrams(1, "serving", 0), /greater than zero/);
  assert.throws(() => toGrams(1, "cup"), /grams or a declared/);
  assert.throws(() => toGrams(20000, "serving", 20000), /between/);
  for (const bad of ["", " ", null, true, [], {}, NaN, Infinity, -1])
    assert.throws(() => toGrams(bad));
});

test("arithmetic nutrient ranges come from ingredient gram bounds and preserve source provenance", () => {
  const meal = calculateMeal({
    ingredients: [
      item("rice-cooked", 150, 120, 180),
      item("lentils-boiled", 100),
    ],
  });
  close(meal.nutrients.kcal.min, 156 + 116);
  close(meal.nutrients.kcal.max, 234 + 116);
  close(meal.nutrients.protein.min, 2.69 * 1.2 + 9.02);
  close(meal.nutrients.fiber.max, 0.4 * 1.8 + 7.9);
  assert.equal(meal.nutrients.sodium.unit, "mg");
  assert.equal(meal.ingredients[0].fdcId, 168878);
  assert.equal(meal.ingredients[0].source.publisher, "USDA FoodData Central");
  assert.equal(meal.databaseVersion, FOOD_DATA_VERSION);
  assert.ok(meal.assumptions.some((note) => note.includes("not quantified")));
});

test("retained oil and salt corrections alter relevant nutrients with correct units", () => {
  const plain = calculateMeal({ ingredients: [item("rice-cooked", 100)] });
  const corrected = calculateMeal({
    ingredients: [
      item("rice-cooked", 100),
      item("soybean-oil", 10),
      item("salt", 1),
    ],
  });
  close(corrected.nutrients.kcal.min - plain.nutrients.kcal.min, 88.4);
  close(corrected.nutrients.fat.min - plain.nutrients.fat.min, 10);
  close(corrected.nutrients.sodium.min - plain.nutrients.sodium.min, 388);
  close(corrected.nutrients.protein.min, plain.nutrients.protein.min);
  const uncertainOil = calculateMeal({
    ingredients: [item("rice-cooked", 100), item("soybean-oil", 5, 0, 10)],
  });
  close(uncertainOil.nutrients.kcal.min, 130);
  close(uncertainOil.nutrients.kcal.max, 218.4);
});

test("cooking labels do not fabricate nutrient retention or silently change ingredient states", () => {
  const input = [item("potato-boiled", 100)];
  const fried = calculateMeal({ ingredients: input, cookingMethod: "fried" });
  const boiled = calculateMeal({ ingredients: input, cookingMethod: "boiled" });
  assert.deepEqual(fried.nutrients, boiled.nutrients);
  assert.equal(fried.cookingMethod, "fried");
  assert.ok(
    fried.assumptions.some((note) => note.includes("retention factor")),
  );
});

test("recipes are editable estimates rather than immutable or supposedly measured regional dishes", () => {
  assert.equal(RECIPE_TEMPLATES.length, 6);
  for (const recipe of RECIPE_TEMPLATES) {
    const draft = templateMeal(recipe.id);
    assert.ok(draft.assumptions.length);
    assert.ok(calculateMeal(draft).nutrients.kcal.min > 0);
    draft.ingredients[0].grams = 10;
    assert.notEqual(templateMeal(recipe.id).ingredients[0].grams, 10);
  }
  const curry = templateMeal("fish-curry");
  assert.ok(curry.assumptions.some((note) => note.includes("proxy")));
  const dal = templateMeal("dal");
  const before = calculateMeal(dal).nutrients.kcal.min;
  dal.ingredients.find((i) => i.foodId === "soybean-oil").grams = 8;
  dal.ingredients.find((i) => i.foodId === "soybean-oil").minGrams = 8;
  dal.ingredients.find((i) => i.foodId === "soybean-oil").maxGrams = 8;
  close(calculateMeal(dal).nutrients.kcal.min - before, 44.2);
  assert.throws(() => templateMeal("guessed-photo-dish"), /Unknown/);
});

test("invalid ingredients and inverted or nonnumeric ranges cannot become plausible calorie values", () => {
  for (const ingredients of [
    [],
    [item("unavailable", 100)],
    [item("rice-cooked", 0)],
    [item("rice-cooked", 100, 110, 120)],
    [item("rice-cooked", 100, 80, 90)],
    [item("rice-cooked", NaN)],
    [item("rice-cooked", 20001)],
  ]) {
    assert.throws(() => calculateMeal({ ingredients }));
  }
  assert.throws(() =>
    calculateMeal({
      ingredients: Array.from({ length: 101 }, () => item("rice-cooked", 1)),
    }),
  );
});

function pixels(width, height, value) {
  const buffer = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      buffer[offset] =
        buffer[offset + 1] =
        buffer[offset + 2] =
          typeof value === "function" ? value(x, y) : value;
      buffer[offset + 3] = 255;
    }
  return buffer;
}

test("photo quality identifies generic low-light/detail failure and abstains on food identity and occlusion", () => {
  const dark = checkPhotoQuality(pixels(200, 200, 10), 200, 200);
  assert.ok(dark.warnings.includes("low_light"));
  assert.ok(dark.warnings.includes("low_detail_or_blur"));
  assert.equal(dark.occlusion, "unknown");
  assert.equal(dark.validated, false);
  const bright = checkPhotoQuality(pixels(200, 200, 250), 200, 200);
  assert.ok(bright.warnings.includes("overexposed"));
  const sharp = checkPhotoQuality(
    pixels(200, 200, (x, y) => ((x + y) % 2 ? 180 : 60)),
    200,
    200,
  );
  assert.equal(sharp.warnings.length, 0);
  assert.ok(sharp.laplacianVariance > dark.laplacianVariance);
  assert.ok(
    checkPhotoQuality(pixels(50, 50, 100), 50, 50).warnings.includes(
      "low_resolution",
    ),
  );
  assert.throws(() => checkPhotoQuality(new Uint8Array(10), 200, 200));
  assert.throws(() => checkPhotoQuality([], 1, 1));
  const vision = foodVisionStatus();
  assert.equal(vision.available, false);
  assert.equal(vision.model_id, null);
  assert.match(vision.reason, /No licensed, validated food-trained weights/);
});

test("correction calculations do not mutate originals and repeated revisions do not duplicate assumptions", () => {
  const original = calculateMeal(templateMeal("rice"));
  const correction = calculateMeal({
    ...original,
    ingredients: [item("rice-cooked", 200)],
  });
  close(original.nutrients.kcal.min, 195);
  close(correction.nutrients.kcal.min, 260);
  const second = calculateMeal(correction);
  assert.deepEqual(second.assumptions, correction.assumptions);
});
