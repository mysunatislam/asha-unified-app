import {
  FOODS,
  NUTRIENTS,
  RECIPE_TEMPLATES,
  CALCULATOR_VERSION,
  FOOD_DATA_VERSION,
  getFood,
  searchFoods,
  calculateMeal,
  templateMeal,
  toGrams,
  checkPhotoQuality,
  foodVisionStatus,
} from "./foods.js";

/** A real offline manual meal journal. Food vision is intentionally unavailable. */
export function mount(host, context) {
  const doc = host.ownerDocument;
  const bn = context.language?.() === "bn";
  const t = (en, bangla) => (bn ? bangla : en);
  let disposed = false,
    draft = [],
    assumptions = [],
    correctsId = null,
    photoQuality = null;
  let previewUrl = null,
    photoGeneration = 0,
    historyGeneration = 0;
  const root = doc.createElement("section");
  root.setAttribute("aria-label", t("Nutrition", "পুষ্টি"));
  host.replaceChildren(root);
  const make = (tag, text, className, parent = root) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    parent?.append(node);
    return node;
  };
  const button = (text, handler, parent = root, primary = false) => {
    const node = make(
      "button",
      text,
      primary ? "primary" : "secondary",
      parent,
    );
    node.type = "button";
    node.addEventListener("click", handler);
    return node;
  };
  const field = (text, type, parent, value = "") => {
    const label = make("label", undefined, "field", parent);
    make("span", text, undefined, label);
    const input = make("input", undefined, undefined, label);
    input.type = type;
    input.value = value;
    return input;
  };
  const select = (text, options, parent) => {
    const label = make("label", undefined, "field", parent);
    make("span", text, undefined, label);
    const input = make("select", undefined, undefined, label);
    for (const [value, name] of options) {
      const option = make("option", name, undefined, input);
      option.value = value;
    }
    return input;
  };
  const announce = (text) => {
    if (!disposed) context.notify?.(text);
  };
  const number = (label, parent, value, step = "1") => {
    const input = field(label, "number", parent, value);
    input.min = "0";
    input.max = "20000";
    input.step = step;
    input.inputMode = "decimal";
    return input;
  };
  make("h2", t("Nutrition", "পুষ্টি"));
  make(
    "p",
    t(
      "Choose foods, confirm portions, and save your meal.",
      "খাবার বাছুন, পরিমাণ নিশ্চিত করুন এবং সংরক্ষণ করুন।",
    ),
    "muted",
  );

  const composer = make("form", undefined, "card");
  const heading = make(
    "h3",
    t("Log a meal", "খাবার লিখুন"),
    undefined,
    composer,
  );
  const mealName = field(t("Meal name", "খাবারের নাম"), "text", composer);
  mealName.maxLength = 100;
  mealName.placeholder = t("Lunch, snack…", "দুপুরের খাবার, নাশতা…");

  const templateChoice = select(
    t("Start with an editable recipe", "পরিবর্তনযোগ্য উপকরণ তালিকা"),
    [
      ["", t("Choose a recipe", "খাবার বাছুন")],
      ...RECIPE_TEMPLATES.map((recipe) => [
        recipe.id,
        bn ? recipe.bn : recipe.en,
      ]),
    ],
    composer,
  );
  button(
    t("Use recipe", "তালিকা ব্যবহার করুন"),
    () => {
      if (!templateChoice.value) return;
      const recipe = templateMeal(templateChoice.value);
      draft = recipe.ingredients;
      assumptions = recipe.assumptions;
      const label = RECIPE_TEMPLATES.find(
        (item) => item.id === templateChoice.value,
      );
      mealName.value = bn ? label.bn : label.en;
      renderIngredients();
      renderSummary();
    },
    composer,
  );

  const foodSearch = field(
    t("Search food · English or বাংলা", "খাবার খুঁজুন · বাংলা বা English"),
    "search",
    composer,
  );
  foodSearch.autocomplete = "off";
  const foodChoice = select(
    t("Food and preparation", "খাবার এবং প্রস্তুতি"),
    [],
    composer,
  );
  const searchStatus = make("p", "", "muted", composer);
  searchStatus.setAttribute("role", "status");
  const updateSearch = () => {
    const matches = searchFoods(foodSearch.value);
    foodChoice.replaceChildren();
    for (const food of matches) {
      const option = make(
        "option",
        bn ? food.bn : food.en,
        undefined,
        foodChoice,
      );
      option.value = food.id;
    }
    searchStatus.textContent = matches.length
      ? ""
      : t(
          "No match. Try an ingredient such as rice or dal.",
          "মেলেনি। ভাত বা ডালের মতো উপকরণ খুঁজুন।",
        );
    addFood.disabled = !matches.length;
  };
  foodSearch.addEventListener("input", updateSearch);
  const portionFields = make("div", undefined, "actions", composer);
  const amount = number(t("Amount", "পরিমাণ"), portionFields, "100", ".1");
  const unit = select(
    t("Unit", "একক"),
    [
      ["g", t("grams", "গ্রাম")],
      ["serving", t("servings", "সার্ভিং")],
    ],
    portionFields,
  );
  const servingGrams = number(
    t("Grams in one serving (confirm)", "এক সার্ভিংয়ে গ্রাম (নিশ্চিত করুন)"),
    portionFields,
    "100",
    ".1",
  );
  servingGrams.closest("label").hidden = true;
  unit.addEventListener("change", () => {
    servingGrams.closest("label").hidden = unit.value !== "serving";
  });
  const addFood = button(
    t("Add ingredient", "উপকরণ যোগ করুন"),
    () => {
      try {
        if (!getFood(foodChoice.value))
          throw new Error(t("Choose an ingredient.", "উপকরণ বাছুন।"));
        const grams = toGrams(amount.value, unit.value, servingGrams.value);
        if (!grams)
          throw new Error(
            t("Enter a positive amount.", "শূন্যের বেশি পরিমাণ লিখুন।"),
          );
        draft.push({
          foodId: foodChoice.value,
          grams,
          minGrams: grams,
          maxGrams: grams,
        });
        renderIngredients();
        renderSummary();
      } catch (error) {
        errorStatus.textContent = error.message;
      }
    },
    composer,
  );
  const ingredientsHost = make("div", undefined, undefined, composer);
  make(
    "p",
    t(
      "Use edible weights. For oil and salt, enter only what remains in your serving.",
      "খাওয়ার উপযোগী অংশের ওজন দিন। তেল ও লবণের ক্ষেত্রে শুধু আপনার খাবারের অংশে যতটুকু আছে তা দিন।",
    ),
    "muted",
    composer,
  );
  const cooking = select(
    t(
      "Cooking method (recorded, no automatic multiplier)",
      "রান্নার ধরন (কোনো স্বয়ংক্রিয় গুণক নেই)",
    ),
    [
      ["as listed", t("As listed in food reference", "খাবারের বিবরণ অনুযায়ী")],
      ["boiled", t("Boiled", "সেদ্ধ")],
      ["steamed", t("Steamed", "ভাপে")],
      ["fried", t("Fried · confirm retained oil", "ভাজা · তেলের পরিমাণ দিন")],
      ["curry", t("Curry · confirm ingredients", "ঝোল · উপকরণ নিশ্চিত করুন")],
      ["other", t("Other", "অন্যান্য")],
    ],
    composer,
  );
  const notes = field(
    t("Notes / missing ingredients", "নোট / বাদ থাকা উপকরণ"),
    "text",
    composer,
  );
  notes.maxLength = 500;
  const summary = make("div", undefined, "notice", composer);
  summary.setAttribute("aria-live", "polite");
  const errorStatus = make("p", "", "notice", composer);
  errorStatus.setAttribute("role", "alert");
  const confirmLabel = make("label", undefined, "field", composer);
  const confirmed = make("input", undefined, undefined, confirmLabel);
  confirmed.type = "checkbox";
  make(
    "span",
    t(
      "I checked the ingredients, weights, oil and salt.",
      "উপকরণ, ওজন, তেল ও লবণ যাচাই করেছি।",
    ),
    undefined,
    confirmLabel,
  );
  const save = make(
    "button",
    t("Confirm and save meal", "নিশ্চিত করে সংরক্ষণ"),
    "primary",
    composer,
  );
  save.type = "submit";
  const reset = button(t("Clear draft", "খসড়া মুছুন"), resetDraft, composer);

  const photo = make("section", undefined, "card");
  make(
    "h3",
    t("Optional meal photo", "খাবারের ছবি (ঐচ্ছিক)"),
    undefined,
    photo,
  );
  make(
    "p",
    t(
      "Local light and detail check. Photo food recognition is not installed; no image is uploaded or saved.",
      "ডিভাইসেই আলো ও ছবির স্পষ্টতা যাচাই। ছবি থেকে খাবার শনাক্তকরণ নেই; ছবি আপলোড বা সংরক্ষণ করা হয় না।",
    ),
    "muted",
    photo,
  );
  const file = field(
    t("Take or choose photo", "ছবি তুলুন বা বাছুন"),
    "file",
    photo,
  );
  file.accept = "image/*";
  file.setAttribute("capture", "environment");
  const preview = make("img", undefined, undefined, photo);
  preview.alt = t(
    "Your meal photo, kept only for this view",
    "খাবারের ছবি, শুধু এই ভিউতে রাখা",
  );
  preview.hidden = true;
  preview.style.maxWidth = "100%";
  preview.style.maxHeight = "240px";
  const quality = make("p", "", "notice", photo);
  quality.setAttribute("role", "status");
  const qualityLabels = {
    low_light: t("Too dark: try brighter light.", "ছবি অন্ধকার: আলো বাড়ান।"),
    overexposed: t(
      "Very bright: avoid glare.",
      "অতিরিক্ত উজ্জ্বল: প্রতিফলন এড়ান।",
    ),
    low_detail_or_blur: t(
      "Low detail or blur: hold still and focus.",
      "কম স্পষ্ট বা ঝাপসা: স্থির হয়ে ফোকাস করুন।",
    ),
    low_resolution: t(
      "Small image: use a larger photo.",
      "ছবি ছোট: বড় ছবি দিন।",
    ),
  };
  file.addEventListener("change", async () => {
    const generation = ++photoGeneration;
    photoQuality = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.hidden = true;
    preview.removeAttribute("src");
    const selected = file.files?.[0];
    if (!selected) {
      quality.textContent = "";
      return;
    }
    if (selected.size > 20 * 1024 * 1024) {
      quality.textContent = t(
        "Choose an image below 20 MB.",
        "২০ মেগাবাইটের ছোট ছবি দিন।",
      );
      return;
    }
    try {
      const url = URL.createObjectURL(selected);
      previewUrl = url;
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });
      if (disposed || generation !== photoGeneration) return;
      const scale = Math.min(
        1,
        640 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      const canvas = doc.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const drawing = canvas.getContext("2d", { willReadFrequently: true });
      if (!drawing) throw new Error("Canvas unavailable");
      drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
      photoQuality = checkPhotoQuality(
        drawing.getImageData(0, 0, canvas.width, canvas.height).data,
        canvas.width,
        canvas.height,
      );
      preview.src = url;
      preview.hidden = false;
      quality.textContent = photoQuality.warnings.length
        ? photoQuality.warnings.map((key) => qualityLabels[key]).join(" ")
        : t(
            "Light and detail check passed. Food identity, ingredients and occlusion are still unverified.",
            "আলো ও স্পষ্টতার পরীক্ষা পাস। খাবারের পরিচয়, উপকরণ ও আড়াল থাকা এখনও যাচাই হয়নি।",
          );
    } catch {
      if (!disposed && generation === photoGeneration)
        quality.textContent = t(
          "This photo could not be decoded. Try JPEG or PNG; manual logging still works.",
          "ছবিটি পড়া যায়নি। JPEG বা PNG দিন; হাতে খাবার লেখা যাবে।",
        );
    }
  });
  function clearPhoto() {
    photoGeneration++;
    photoQuality = null;
    file.value = "";
    quality.textContent = "";
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    preview.hidden = true;
    preview.removeAttribute("src");
  }
  button(t("Remove photo", "ছবি মুছুন"), clearPhoto, photo);
  const vision = foodVisionStatus();
  photo.dataset.visionAvailable = String(vision.available);

  const history = make("section", undefined, "card");
  make("h3", t("Meal history", "আগের খাবার"), undefined, history);
  const historyHost = make("div", undefined, undefined, history);
  make(
    "p",
    t(
      "Reference: USDA FoodData Central (CC0). Recipe templates are editable ingredient estimates. Amount ranges are not clinical confidence intervals.",
      "সূত্র: USDA FoodData Central (CC0)। রান্নার তালিকা পরিবর্তনযোগ্য উপকরণের হিসাব। পরিমাণের সীমা ক্লিনিক্যাল আস্থার সীমা নয়।",
    ),
    "muted",
  );

  function renderIngredients() {
    ingredientsHost.replaceChildren();
    if (!draft.length)
      make(
        "p",
        t("No ingredients yet.", "এখনও উপকরণ নেই।"),
        "muted",
        ingredientsHost,
      );
    draft.forEach((item, index) => {
      const ref = getFood(item.foodId);
      const card = make("fieldset", undefined, "card", ingredientsHost);
      make("legend", bn ? ref.bn : ref.en, undefined, card);
      const fields = make("div", undefined, "actions", card);
      const grams = number(
        t("Chosen grams", "নির্বাচিত গ্রাম"),
        fields,
        item.grams,
        ".1",
      );
      const min = number(
        t("Minimum grams", "সর্বনিম্ন গ্রাম"),
        fields,
        item.minGrams,
        ".1",
      );
      const max = number(
        t("Maximum grams", "সর্বোচ্চ গ্রাম"),
        fields,
        item.maxGrams,
        ".1",
      );
      grams.addEventListener("input", () => {
        if (
          Number(item.minGrams) === Number(item.grams) &&
          Number(item.maxGrams) === Number(item.grams)
        ) {
          min.value = max.value = grams.value;
          item.minGrams = item.maxGrams = grams.value;
        }
        item.grams = grams.value;
        renderSummary();
      });
      min.addEventListener("input", () => {
        item.minGrams = min.value;
        renderSummary();
      });
      max.addEventListener("input", () => {
        item.maxGrams = max.value;
        renderSummary();
      });
      button(
        t("Remove ingredient", "উপকরণ বাদ দিন"),
        () => {
          draft.splice(index, 1);
          renderIngredients();
          renderSummary();
        },
        card,
      );
      const source = make(
        "a",
        t("Food reference ↗", "খাদ্য তথ্যের সূত্র ↗"),
        "muted",
        card,
      );
      source.href = ref.source.url;
      source.target = "_blank";
      source.rel = "noopener noreferrer";
    });
  }

  const currentMeal = () =>
    calculateMeal({
      ingredients: draft,
      cookingMethod: cooking.value,
      assumptions,
    });
  function renderSummary() {
    confirmed.checked = false;
    summary.replaceChildren();
    errorStatus.textContent = "";
    if (!draft.length) {
      summary.textContent = t(
        "Add ingredients to see a calculation.",
        "হিসাব দেখতে উপকরণ যোগ করুন।",
      );
      return;
    }
    try {
      const calculated = currentMeal();
      make(
        "strong",
        t("Estimated nutrients for this meal", "এই খাবারের আনুমানিক পুষ্টি"),
        undefined,
        summary,
      );
      const list = make("dl", undefined, undefined, summary);
      for (const [key, bounds] of Object.entries(calculated.nutrients)) {
        make("dt", bn ? NUTRIENTS[key].bn : NUTRIENTS[key].en, undefined, list);
        const range =
          Math.abs(bounds.max - bounds.min) > 0.001
            ? `${format(bounds.min)}–${format(bounds.max)}`
            : `≈ ${format(bounds.min)}`;
        make("dd", `${range} ${bounds.unit}`, undefined, list);
      }
      if (assumptions.length)
        make("p", assumptions.join(" "), "muted", summary);
      make(
        "p",
        t(
          "If the portion is uncertain, edit minimum and maximum grams. No uncertainty is inferred from the photo.",
          "পরিমাণ অনিশ্চিত হলে সর্বনিম্ন ও সর্বোচ্চ গ্রাম দিন। ছবি থেকে অনিশ্চয়তা অনুমান করা হয় না।",
        ),
        "muted",
        summary,
      );
    } catch (error) {
      errorStatus.textContent = error.message;
    }
  }
  cooking.addEventListener("change", renderSummary);

  function resetDraft() {
    clearPhoto();
    draft = [];
    assumptions = [];
    correctsId = null;
    mealName.value = "";
    notes.value = "";
    templateChoice.value = "";
    cooking.value = "as listed";
    heading.textContent = t("Log a meal", "খাবার লিখুন");
    save.textContent = t("Confirm and save meal", "নিশ্চিত করে সংরক্ষণ");
    renderIngredients();
    renderSummary();
  }

  composer.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!confirmed.checked) {
      errorStatus.textContent = t(
        "Check the ingredients and confirm before saving.",
        "সংরক্ষণের আগে উপকরণ যাচাই করে নিশ্চিত করুন।",
      );
      return;
    }
    save.disabled = reset.disabled = true;
    try {
      const meal = currentMeal();
      const record = {
        module: "nutrition",
        source: "user",
        units: "meal",
        value: {
          ...meal,
          name: mealName.value.trim().slice(0, 100) || t("Meal", "খাবার"),
          notes: notes.value.trim().slice(0, 500),
          ...(correctsId ? { corrects_id: correctsId } : {}),
          ...(photoQuality ? { photo_quality: photoQuality } : {}),
          raw_media_retained: false,
        },
        interval: {
          min: meal.nutrients.kcal.min,
          max: meal.nutrients.kcal.max,
          units: "kcal",
          basis: "user-entered ingredient weight bounds",
        },
        model_id: "deterministic-food-table",
        model_version: CALCULATOR_VERSION,
        correction_status: correctsId ? "corrected" : "confirmed",
        consent_scope: "nutrition",
      };
      await context.store.add(record);
      if (disposed) return;
      announce(t("Meal saved.", "খাবার সংরক্ষিত হয়েছে।"));
      resetDraft();
      await renderHistory();
    } catch (error) {
      if (!disposed)
        errorStatus.textContent =
          error.message ||
          t("Meal could not be saved.", "খাবার সংরক্ষণ করা যায়নি।");
    } finally {
      if (!disposed) save.disabled = reset.disabled = false;
    }
  });

  async function renderHistory() {
    const generation = ++historyGeneration;
    try {
      const records = await context.store.list("nutrition");
      if (disposed || generation !== historyGeneration) return;
      historyHost.replaceChildren();
      if (!records.length) {
        make(
          "p",
          t(
            "No saved meals in this session.",
            "এই সেশনে কোনো খাবার সংরক্ষিত নেই।",
          ),
          "muted",
          historyHost,
        );
        return;
      }
      const corrected = new Set(
        records.map((record) => record.value?.corrects_id).filter(Boolean),
      );
      for (const record of records) {
        const meal = record.value;
        if (!meal || !Array.isArray(meal.ingredients)) continue;
        const card = make("article", undefined, "card", historyHost);
        make("h4", meal.name || t("Meal", "খাবার"), undefined, card);
        const timestamp = new Date(record.timestamp);
        make(
          "p",
          Number.isNaN(timestamp.valueOf())
            ? ""
            : timestamp.toLocaleString(bn ? "bn-BD" : "en-GB"),
          "muted",
          card,
        );
        const kcal = meal.nutrients?.kcal;
        if (kcal && Number.isFinite(kcal.min) && Number.isFinite(kcal.max))
          make(
            "p",
            `≈ ${format(kcal.min)}–${format(kcal.max)} kcal`,
            undefined,
            card,
          );
        if (corrected.has(record.id))
          make(
            "p",
            t(
              "Previous version · a correction is saved separately.",
              "আগের সংস্করণ · সংশোধন আলাদাভাবে সংরক্ষিত।",
            ),
            "muted",
            card,
          );
        const actions = make("div", undefined, "actions", card);
        button(
          t("Correct meal", "খাবার সংশোধন"),
          () => {
            if (meal.ingredients.some((item) => !getFood(item.foodId))) {
              announce(
                t(
                  "This saved record needs an unavailable food reference.",
                  "সংরক্ষিত তথ্যের একটি খাবারের সূত্র পাওয়া যাচ্ছে না।",
                ),
              );
              return;
            }
            clearPhoto();
            draft = meal.ingredients.map((item) => ({
              foodId: item.foodId,
              grams: item.grams,
              minGrams: item.minGrams ?? item.grams,
              maxGrams: item.maxGrams ?? item.grams,
            }));
            assumptions = Array.isArray(meal.assumptions)
              ? meal.assumptions.slice(0, 8)
              : [];
            correctsId = record.id;
            mealName.value = meal.name || "";
            notes.value = meal.notes || "";
            cooking.value = meal.cookingMethod || "as listed";
            if (!cooking.value) cooking.value = "other";
            heading.textContent = t(
              "Correct a saved meal",
              "সংরক্ষিত খাবার সংশোধন",
            );
            save.textContent = t(
              "Confirm and save correction",
              "নিশ্চিত করে সংশোধন সংরক্ষণ",
            );
            renderIngredients();
            renderSummary();
            mealName.focus();
          },
          actions,
        );
        const remove = button(
          t("Delete meal", "খাবার মুছুন"),
          async () => {
            remove.disabled = true;
            try {
              await context.store.remove(record.id);
              if (!disposed) {
                announce(t("Meal deleted.", "খাবার মুছে ফেলা হয়েছে।"));
                await renderHistory();
              }
            } catch (error) {
              announce(
                error.message ||
                  t("Could not delete meal.", "খাবার মুছতে পারিনি।"),
              );
              if (!disposed) remove.disabled = false;
            }
          },
          actions,
        );
      }
    } catch (error) {
      if (!disposed && generation === historyGeneration) {
        historyHost.textContent =
          error.message ||
          t("History unavailable.", "আগের খাবার দেখা যাচ্ছে না।");
      }
    }
  }
  function format(value) {
    return new Intl.NumberFormat(bn ? "bn-BD" : "en-GB", {
      maximumFractionDigits: value < 10 ? 1 : 0,
    }).format(value);
  }
  updateSearch();
  renderIngredients();
  renderSummary();
  void renderHistory();
  root.dataset.foodDatabaseVersion = FOOD_DATA_VERSION;
  root.dataset.referenceCount = String(FOODS.length);
  return () => {
    disposed = true;
    photoGeneration++;
    historyGeneration++;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    preview.removeAttribute("src");
    root.remove();
  };
}
