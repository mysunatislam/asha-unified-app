# Nutrition data, calculations and release boundaries

Version: `usda-sr-legacy-asha-2026-11-10`. Calculator: `1.0.0`. Verified on 2026-11-10.

## Shipped source records

The small offline ingredient subset comes from the official [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide/), SR Legacy records published 2019-04-01. Each bundled record preserves its FDC identifier, original description, preparation state, retrieval date and source link. Bangladesh names are ASHA translations/search aliases; they do not make US reference ingredients laboratory measurements of Bangladeshi meals.

USDA states its FDC data are public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), with attribution requested. Citation: U.S. Department of Agriculture, Agricultural Research Service. FoodData Central, 2019. https://fdc.nal.usda.gov/.

| FDC ID                                                           | Original food description                                       | kcal | Protein g | Fat g | Carbohydrate g | Fibre g | Sodium mg |
| ---------------------------------------------------------------- | --------------------------------------------------------------- | ---: | --------: | ----: | -------------: | ------: | --------: |
| [168878](https://fdc.nal.usda.gov/food-details/168878/nutrients) | Rice, white, long-grain, regular, enriched, cooked              |  130 |      2.69 |  0.28 |           28.2 |     0.4 |         1 |
| [172421](https://fdc.nal.usda.gov/food-details/172421/nutrients) | Lentils, mature seeds, cooked, boiled, without salt             |  116 |      9.02 |  0.38 |           20.1 |     7.9 |         2 |
| [170440](https://fdc.nal.usda.gov/food-details/170440/nutrients) | Potatoes, boiled, cooked without skin, flesh, without salt      |   86 |      1.71 |   0.1 |             20 |     1.8 |         5 |
| [173944](https://fdc.nal.usda.gov/food-details/173944/nutrients) | Bananas, raw                                                    |   89 |      1.09 |  0.33 |           22.8 |     2.6 |         1 |
| [171477](https://fdc.nal.usda.gov/food-details/171477/nutrients) | Chicken, broilers or fryers, breast, meat only, cooked, roasted |  165 |        31 |  3.57 |              0 |       0 |        74 |
| [175177](https://fdc.nal.usda.gov/food-details/175177/nutrients) | Fish, tilapia, cooked, dry heat                                 |  128 |      26.2 |  2.65 |              0 |       0 |        56 |
| [170393](https://fdc.nal.usda.gov/food-details/170393/nutrients) | Carrots, raw                                                    |   41 |      0.93 |  0.24 |           9.58 |     2.8 |        69 |
| [168462](https://fdc.nal.usda.gov/food-details/168462/nutrients) | Spinach, raw                                                    |   23 |      2.86 |  0.39 |           3.63 |     2.2 |        79 |
| [171411](https://fdc.nal.usda.gov/food-details/171411/nutrients) | Oil, soybean, salad or cooking                                  |  884 |         0 |   100 |              0 |       0 |         0 |
| [173468](https://fdc.nal.usda.gov/food-details/173468/nutrients) | Salt, table                                                     |    0 |         0 |     0 |              0 |       0 |     38800 |
| [169655](https://fdc.nal.usda.gov/food-details/169655/nutrients) | Sugars, granulated                                              |  387 |         0 |     0 |            100 |       0 |         1 |

All values above are per **100 g edible food**, not per serving. Numeric zero is a reported zero, never an imputed missing value. Selected API nutrient numbers: 208 energy kcal, 203 protein g, 204 fat g, 205 carbohydrate g, 291 fibre g, 307 sodium mg. The six values were verified directly against the official API. The public sample key was used for development verification; the shipped module has no API key and makes no nutrition-data network request.

## Bangladesh data audit

The official [FAO directory entry for the 2013 Food Composition Table for Bangladesh](https://www.fao.org/food-composition/tables-and-databases/detail/%28country--date%29-title-1/en) provides free access to the University of Dhaka table. Its [PDF](https://www.fao.org/fileadmin/templates/food_composition/documents/FCT_10_2_14_final_version.pdf) credits Shaheen and colleagues, INFS/CARS, University of Dhaka. An explicit commercial redistribution licence was not established in this audit. Free access alone is insufficient to assume that licence. No numbers from that table are bundled. Obtain written reuse terms and complete food-matching/quality review before importing it. FAO's directory is a catalogue, not endorsement of each included dataset.

## Deterministic calculation

For each nutrient: `sum(reference_per_100g × ingredient_grams / 100)`. The lower and upper totals use user-confirmed lower and upper ingredient weights. Exact entered weights yield equal bounds, displayed with an approximation mark because reference food composition itself varies. Bounds are **not statistical or clinical confidence intervals**, and do not quantify ingredient mismatch, food-table or recipe error.

- Servings require a user-declared grams-per-serving value. No spoon, plate or cup volume is silently converted to grams.
- Cooking method is stored as a correction note. The calculator does not invent nutrient retention, oil absorption or water-loss coefficients. Raw and cooked entries remain distinct.
- Oil and salt refer to amounts retained **in the consumed serving**, not everything added to a pan. They are ordinary editable ingredients so they are not silently counted twice.
- Rice, dal, fish curry, potato bhorta, vegetables and chicken rice/biryani templates are ASHA-authored assembly examples. They are not analytical recipe records. Gravy, water and unlisted ingredients must be considered by the user; templates describe omissions and proxies.
- Corrections create a separate confirmed record linked to the original via `value.corrects_id`. History labels the earlier version; it does not rewrite past evidence. Each calculation retains ingredient FDC sources and database/calculator versions.
- The module uses the shared evidence store and its consent/persistence controls. Raw photo media is neither uploaded nor stored. Only generic quality metrics may be attached to a confirmed meal. Delete removes the selected meal record; exported records retain source metadata.

## Photo check and missing model

Optional camera/file input is decoded locally at up to 640 pixels on the long side. Mean luminance and Laplacian variance flag low light, excessive brightness, low detail/possible blur and small images. Thresholds are engineering heuristics, **not validated food-image acceptance criteria**. Uniform food can have low detail without blur; glare and occlusion can be missed. Occlusion remains `unknown`.

No food-trained classifier or portion estimator is installed. The adapter returns `available: false`; it produces no guessed label, confidence or grams. Manual search, recipe editing, calculation, confirmation and history are functional offline. Do not present this as automatic photo nutrition estimation.

## Validation and release requirements

Unit tests check units, invalid inputs, source provenance, deterministic nutrient ranges, retained oil/salt, recipe corrections, image-quality heuristics and recognition abstention. These verify software behavior, not food-recognition or nutrition accuracy.

Before enabling image recognition: obtain licensed food-trained weights; document architecture, training datasets, model hash, preprocessing and calibration; evaluate a held-out Bangladeshi-food set for top-1/top-3 accuracy, macro-F1, expected calibration error, per-dish performance, abstention and correction rate. Portion/nutrition validation requires weighed meals, retained-oil measurements, grams MAE, kcal MAE and interval coverage. Record p50/p95 latency and memory on representative low-end Android devices. None of these model/clinical accuracy or device benchmark results is claimed here.
