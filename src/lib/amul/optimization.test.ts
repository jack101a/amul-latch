import test from "node:test";
import assert from "node:assert/strict";
import {
  extractProteinGrams,
  extractPackMultiplier,
  calculateProteinCostPerGram,
  formatProteinYield,
  extractNutritionInfo,
  stripHtml,
  productImageUrl,
  maskSecret,
  DEFAULT_CONFIG,
  type AppConfig,
  type TrackedProduct,
  type AmulProduct,
} from "./types.ts";
import { AmulClient, mapProduct } from "./client.ts";
import { getISTDecimalHour, calculateAdaptiveInterval, getConfig, applyConfig } from "./runtime.ts";

test("Pack Multiplier: extracts correct pack multiplier across all catalog formats", () => {
  // Milk packs
  assert.equal(extractPackMultiplier("Amul High Protein Milk, 250 mL | Pack of 32"), 32);
  assert.equal(extractPackMultiplier("Amul High Protein Milk, 250 mL | Pack of 8"), 8);

  // Cubes
  assert.equal(extractPackMultiplier("Amul High Protein Cubes 190 g | Pack of 5"), 5);

  // Peanut spread
  assert.equal(extractPackMultiplier("Amul High Protein Dark Chocolate Peanut Spread, 250 g | Pack of 2"), 2);

  // Paneer
  assert.equal(extractPackMultiplier("Amul High Protein Paneer, 400 g | Pack of 2"), 2);
  assert.equal(extractPackMultiplier("Amul High Protein Paneer, 400 g | Pack of 24"), 24);

  // Wheat Flour
  assert.equal(extractPackMultiplier("Amul High Protein Wheat Flour, 65 g | Pack of 30 Sachets"), 30);

  // Whey Protein
  assert.equal(extractPackMultiplier("Amul Whey Protein Gift Pack, 32 g | Pack of 10 sachets"), 10);
  assert.equal(extractPackMultiplier("Amul Whey Protein, 32 g | Pack of 30 Sachets"), 30);
  assert.equal(extractPackMultiplier("Amul Whey Protein, 32 g | Pack of 60 Sachets"), 60);
  assert.equal(extractPackMultiplier("Amul Chocolate Whey Protein Gift Pack, 34 g | Pack of 10 sachets"), 10);
  assert.equal(extractPackMultiplier("Amul Chocolate Whey Protein, 34 g | Pack of 30 sachets"), 30);
  assert.equal(extractPackMultiplier("Amul Chocolate Whey Protein, 34 g | Pack of 60 sachets"), 60);
  assert.equal(extractPackMultiplier("Amul Whey Protein 30 Sachets 24 g"), 30);

  // Buttermilk & Lassi & Shakes
  assert.equal(extractPackMultiplier("Amul High Protein Buttermilk, 200 mL | Pack of 30"), 30);
  assert.equal(extractPackMultiplier("Amul Kool Protein Milkshake | Chocolate, 180 mL | Pack of 8"), 8);
  assert.equal(extractPackMultiplier("Amul Kool Protein Milkshake | Chocolate, 180 mL | Pack 8"), 8);
  assert.equal(extractPackMultiplier("Amul Kool Protein Milkshake | Chocolate, 180 mL | Pack of 30"), 30);
  assert.equal(extractPackMultiplier("Amul High Protein Plain Lassi, 200 mL | Pack of 30"), 30);
  assert.equal(extractPackMultiplier("Amul High Protein Rose Lassi, 200 mL | Pack of 30"), 30);
  assert.equal(extractPackMultiplier("Amul High Protein Blueberry Shake, 200 mL | Pack of 30"), 30);

  // Single unit / default fallback
  assert.equal(extractPackMultiplier("Single Buttermilk 200 ml"), 1);
  assert.equal(extractPackMultiplier("Amul Whey Protein 1 sachet"), 1);
});

test("Protein Economics: Metafield & Description Parsing for Key Products", () => {
  // 1. High Protein Milk (35g per pack; 8 pack = 280g, 32 pack = 1120g)
  assert.equal(
    extractProteinGrams(
      "Amul High Protein Milk, 250 mL | Pack of 8",
      "amul-high-protein-milk-250-ml-or-pack-of-8",
      { benefits: "<ul><li>Fat Free</li><li>Lactose Free</li><li>35g Protein per pack</li><li>Only 225kcal per pack</li></ul>" },
      "World's highest protein milk, Amul high protein milk is truly a super milk packed with a whopping 35g of best quality milk protein in a 250ml",
    ),
    280,
  );
  assert.equal(
    extractProteinGrams(
      "Amul High Protein Milk, 250 mL | Pack of 32",
      "amul-high-protein-milk-250-ml-or-pack-of-32",
      { benefits: "<ul><li>Fat Free</li><li>Lactose Free</li><li>35g Protein per pack</li><li>Only 225kcal per pack</li></ul>" },
      "World's highest protein milk, Amul high protein milk is truly a super milk packed with a whopping 35g of best quality milk protein in a 250ml",
    ),
    1120,
  );

  // 2. High Protein Cubes (25g per 38g serving; 190g pack = 125g; 5 pack = 625g)
  assert.equal(
    extractProteinGrams(
      "Amul High Protein Cubes 190 g | Pack of 5",
      "amul-high-protein-cubes-190-g-or-pack-of-5",
      { benefits: "<ul><li><span>25g Protein per 38g serving</span></li><li><span>Milk Protein</span></li></ul>" },
      "Introducing Amul High Protein Snack: A 38 g pack of cubes has 25 g or 65% protein with just 150 kcal. It uses only milk protein.",
    ),
    625,
  );

  // 3. High Protein Peanut Spread (40% protein; 250g jar = 100g; pack of 2 = 200g)
  assert.equal(
    extractProteinGrams(
      "Amul High Protein Dark Chocolate Peanut Spread, 250 g | Pack of 2",
      "amul-high-protein-dark-chocolate-peanut-spread-250-g-or-pack-of-2",
      { benefits: "<ul><li><span>40% Protein</span></li><li><span>No Added sugar</span></li></ul>", how_to_useit: "A 25 g serving of this super tasty dark chocolate peanut spread provides 10 g protein." },
      "Introducing Amul High Protein Dark Chocolate Peanut Spread with 40% protein! One 25 g serving gives you 10 g protein",
    ),
    200,
  );

  // 4. High Protein Wheat Flour / Atta (20g protein per 65g pack; 30 pack = 600g)
  assert.equal(
    extractProteinGrams(
      "Amul High Protein Wheat Flour, 65 g | Pack of 30 Sachets",
      "amul-high-protein-wheat-flour-65-g-or-pack-of-30-sachets",
      { benefits: "<ul><li>20g &nbsp;Protein per 65g pack</li><li>No Maida</li></ul>" },
      "First of its kind, this flour comes in 30 single-serve sachets, each weighing 65 g. delivering 20g protein",
    ),
    600,
  );

  // 5. High Protein Paneer (25% protein; 400g tin = 100g; 2 pack = 200g, 24 pack = 2400g)
  assert.equal(
    extractProteinGrams(
      "Amul High Protein Paneer, 400 g | Pack of 2",
      "amul-high-protein-paneer-400-g-or-pack-of-2",
      { benefits: "<ul><li>High protein: 25%</li><li>1 cube = 1g protein</li></ul>", how_to_useit: "Every cube in this tin weighs approx. 4 g and provides 1 g of protein" },
      "The first of its kind, Amul High Protein Paneer is a low-fat and reduced calories paneer with 25% protein.",
    ),
    200,
  );
  assert.equal(
    extractProteinGrams(
      "Amul High Protein Paneer, 400 g | Pack of 24",
      "amul-high-protein-paneer-400-g-or-pack-of-24",
      { benefits: "<ul><li>High protein: 25%</li><li>1 cube = 1g protein</li></ul>", how_to_useit: "Every cube in this tin weighs approx. 4 g and provides 1 g of protein" },
      "The first of its kind, Amul High Protein Paneer is a low-fat and reduced calories paneer with 25% protein.",
    ),
    2400,
  );

  // 6. Whey Protein (25g per sachet; 10, 30, 60 sachets)
  assert.equal(
    extractProteinGrams(
      "Amul Whey Protein Gift Pack, 32 g | Pack of 10 sachets",
      "amul-whey-protein-gift-pack-32-g-or-pack-of-10-sachets",
      { benefits: "<ul><li>25g whey protein in every single serve sachet</li></ul>" },
      "provides 25 g whey protein in single serve sachet",
    ),
    250,
  );
  assert.equal(
    extractProteinGrams(
      "Amul Whey Protein, 32 g | Pack of 30 Sachets",
      "amul-whey-protein-32-g-or-pack-of-30-sachets",
      { benefits: "<ul><li>25g whey protein in every single serve sachet</li></ul>" },
      "provides 25 g whey protein",
    ),
    750,
  );
  assert.equal(
    extractProteinGrams(
      "Amul Whey Protein, 32 g | Pack of 60 Sachets",
      "amul-whey-protein-32-g-or-pack-of-60-sachets",
      { benefits: "<ul><li>25g whey protein in every single serve sachet</li></ul>" },
      "provides 25 g whey protein",
    ),
    1500,
  );
  assert.equal(
    extractProteinGrams(
      "Amul Chocolate Whey Protein, 34 g | Pack of 60 sachets",
      "amul-chocolate-whey-protein-34-g-or-pack-of-60-sachets",
      { benefits: "<ul><li>25g whey protein in every single serve sachet</li></ul>" },
      "provides 25g whey protein",
    ),
    1500,
  );

  // 7. Buttermilk (15g per 200mL; 30 pack = 450g)
  assert.equal(
    extractProteinGrams(
      "Amul High Protein Buttermilk, 200 mL | Pack of 30",
      "amul-high-protein-buttermilk-200-ml-or-pack-of-30",
      { benefits: "" },
      "Enriched with 15g of high-quality milk protein",
    ),
    450,
  );

  // 8. Kool Milkshake (10g per 180mL; 8 pack = 80g, 30 pack = 300g)
  assert.equal(
    extractProteinGrams(
      "Amul Kool Protein Milkshake | Chocolate, 180 mL | Pack of 8",
      "amul-kool-protein-milkshake-or-chocolate-180-ml-or-pack-of-8",
      { benefits: "<ul><li>10g Protein Per Pack</li></ul>" },
      "provides 10 g milk protein",
    ),
    80,
  );
  assert.equal(
    extractProteinGrams(
      "Amul Kool Protein Milkshake | Chocolate, 180 mL | Pack of 30",
      "amul-kool-protein-milkshake-or-chocolate-180-ml-or-pack-of-30",
      { benefits: "<ul><li>10g Protein Per Pack</li></ul>" },
      "provides 10 g milk protein",
    ),
    300,
  );

  // 9. Lassi (15g per 200mL; 30 pack = 450g)
  assert.equal(
    extractProteinGrams(
      "Amul High Protein Plain Lassi, 200 mL | Pack of 30",
      "amul-high-protein-plain-lassi-200-ml-or-pack-of-30",
      { benefits: "<ul><li>15g protein</li></ul>" },
      "Get 15g best quality whey protein in a 200ml pack",
    ),
    450,
  );
  assert.equal(
    extractProteinGrams(
      "Amul High Protein Rose Lassi, 200 mL | Pack of 30",
      "amul-high-protein-rose-lassi-200-ml-or-pack-of-30",
      { benefits: "<ul><li>15g protein</li></ul>" },
      "Get 15g best quality whey protein",
    ),
    450,
  );

  // 10. Blueberry Shake (20g per 200mL; 30 pack = 600g)
  assert.equal(
    extractProteinGrams(
      "Amul High Protein Blueberry Shake, 200 mL | Pack of 30",
      "amul-high-protein-blueberry-shake-200-ml-or-pack-of-30",
      { benefits: "<ul><li>20g protein</li></ul>" },
      "provides you the best quality 20g whey protein",
    ),
    600,
  );
});

test("Protein Economics: All 25 Catalog Products across 11 Categories (0 Nulls, Correct ₹/g)", () => {
  const CATALOG_25 = [
    { sku: "BTMCP11_30", name: "Amul High Protein Buttermilk, 200 mL | Pack of 30", alias: "amul-high-protein-buttermilk-200-ml-or-pack-of-30", price: 799, expectedGrams: 450, expectedCostPerGram: 1.78, category: "buttermilk" },
    { sku: "HPACP01_01", name: "Amul High Protein Wheat Flour, 65 g | Pack of 30 Sachets", alias: "amul-high-protein-wheat-flour-65-g-or-pack-of-30-sachets", price: 1200, expectedGrams: 600, expectedCostPerGram: 2.00, category: "wheat_flour" },
    { sku: "DBDCP44_02", name: "Amul Kool Protein Milkshake | Chocolate, 180 mL | Pack of 8", alias: "amul-kool-protein-milkshake-or-chocolate-180-ml-or-pack-of-8", price: 320, expectedGrams: 80, expectedCostPerGram: 4.00, category: "milkshake" },
    { sku: "DBDCP42_02", name: "Amul Kool Protein Milkshake | Kesar, 180 mL | Pack of 8", alias: "amul-kool-protein-milkshake-or-kesar-180-ml-or-pack-of-8", price: 320, expectedGrams: 80, expectedCostPerGram: 4.00, category: "milkshake" },
    { sku: "DBDCP44_30", name: "Amul Kool Protein Milkshake | Chocolate, 180 mL | Pack of 30", alias: "amul-kool-protein-milkshake-or-chocolate-180-ml-or-pack-of-30", price: 1200, expectedGrams: 300, expectedCostPerGram: 4.00, category: "milkshake" },
    { sku: "DBDCP42_30", name: "Amul Kool Protein Milkshake | Kesar, 180 mL | Pack of 30", alias: "amul-kool-protein-milkshake-or-kesar-180-ml-or-pack-of-30", price: 1200, expectedGrams: 300, expectedCostPerGram: 4.00, category: "milkshake" },
    { sku: "DBDCP43_02", name: "Amul Kool Protein Milkshake | Arabica Coffee, 180 mL | Pack of 8", alias: "amul-kool-protein-milkshake-or-arabica-coffee-180-ml-or-pack-of-8", price: 320, expectedGrams: 80, expectedCostPerGram: 4.00, category: "milkshake" },
    { sku: "DBDCP43_30", name: "Amul Kool Protein Milkshake | Arabica Coffee, 180 mL | Pack of 30", alias: "amul-kool-protein-milkshake-or-arabica-coffee-180-ml-or-pack-of-30", price: 1200, expectedGrams: 300, expectedCostPerGram: 4.00, category: "milkshake" },
    { sku: "DBDCP45_02", name: "Amul Kool Protein Milkshake | Vanilla, 180 mL | Pack of 8", alias: "amul-kool-protein-milkshake-or-vanilla-180-ml-or-pack-of-8", price: 320, expectedGrams: 80, expectedCostPerGram: 4.00, category: "milkshake" },
    { sku: "DBDCP45_01", name: "Amul Kool Protein Milkshake | Vanilla, 180 mL | Pack of 30", alias: "amul-kool-protein-milkshake-or-vanilla-180-ml-or-pack-of-30", price: 1200, expectedGrams: 300, expectedCostPerGram: 4.00, category: "milkshake" },
    { sku: "DBDCP41_30", name: "Amul High Protein Blueberry Shake, 200 mL | Pack of 30", alias: "amul-high-protein-blueberry-shake-200-ml-or-pack-of-30", price: 1800, expectedGrams: 600, expectedCostPerGram: 3.00, category: "shake" },
    { sku: "HPPCP01_02", name: "Amul High Protein Paneer, 400 g | Pack of 2", alias: "amul-high-protein-paneer-400-g-or-pack-of-2", price: 330, expectedGrams: 200, expectedCostPerGram: 1.65, category: "paneer" },
    { sku: "HPPCP01_24", name: "Amul High Protein Paneer, 400 g | Pack of 24", alias: "amul-high-protein-paneer-400-g-or-pack-of-24", price: 3960, expectedGrams: 2400, expectedCostPerGram: 1.65, category: "paneer" },
    { sku: "WPCCP04_01", name: "Amul Whey Protein Gift Pack, 32 g | Pack of 10 sachets", alias: "amul-whey-protein-gift-pack-32-g-or-pack-of-10-sachets", price: 900, expectedGrams: 250, expectedCostPerGram: 3.60, category: "whey" },
    { sku: "WPCCP06_01", name: "Amul Chocolate Whey Protein Gift Pack, 34 g | Pack of 10 sachets", alias: "amul-chocolate-whey-protein-gift-pack-34-g-or-pack-of-10-sachets", price: 920, expectedGrams: 250, expectedCostPerGram: 3.68, category: "whey" },
    { sku: "WPCCP03_01", name: "Amul Chocolate Whey Protein, 34 g | Pack of 30 sachets", alias: "amul-chocolate-whey-protein-34-g-or-pack-of-30-sachets", price: 2500, expectedGrams: 750, expectedCostPerGram: 3.33, category: "whey" },
    { sku: "LASCP61_30", name: "Amul High Protein Plain Lassi, 200 mL | Pack of 30", alias: "amul-high-protein-plain-lassi-200-ml-or-pack-of-30", price: 900, expectedGrams: 450, expectedCostPerGram: 2.00, category: "lassi" },
    { sku: "LASCP40_30", name: "Amul High Protein Rose Lassi, 200 mL | Pack of 30", alias: "amul-high-protein-rose-lassi-200-ml-or-pack-of-30", price: 900, expectedGrams: 450, expectedCostPerGram: 2.00, category: "lassi" },
    { sku: "HPMCP01_32", name: "Amul High Protein Milk, 250 mL | Pack of 32", alias: "amul-high-protein-milk-250-ml-or-pack-of-32", price: 3520, expectedGrams: 1120, expectedCostPerGram: 3.14, category: "milk" },
    { sku: "HPSCP01_01", name: "Amul High Protein Cubes 190 g | Pack of 5", alias: "amul-high-protein-cubes-190-g-or-pack-of-5", price: 400, expectedGrams: 625, expectedCostPerGram: 0.64, category: "cubes" },
    { sku: "HPCCP01_01", name: "Amul High Protein Dark Chocolate Peanut Spread, 250 g | Pack of 2", alias: "amul-high-protein-dark-chocolate-peanut-spread-250-g-or-pack-of-2", price: 500, expectedGrams: 200, expectedCostPerGram: 2.50, category: "peanut_spread" },
    { sku: "WPCCP01_01", name: "Amul Whey Protein, 32 g | Pack of 30 Sachets", alias: "amul-whey-protein-32-g-or-pack-of-30-sachets", price: 2400, expectedGrams: 750, expectedCostPerGram: 3.20, category: "whey" },
    { sku: "WPCCP02_01", name: "Amul Whey Protein, 32 g | Pack of 60 Sachets", alias: "amul-whey-protein-32-g-or-pack-of-60-sachets", price: 4200, expectedGrams: 1500, expectedCostPerGram: 2.80, category: "whey" },
    { sku: "WPCCP05_02", name: "Amul Chocolate Whey Protein, 34 g | Pack of 60 sachets", alias: "amul-chocolate-whey-protein-34-g-or-pack-of-60-sachets", price: 4500, expectedGrams: 1500, expectedCostPerGram: 3.00, category: "whey" },
    { sku: "HPMCP01_08", name: "Amul High Protein Milk, 250 mL | Pack of 8", alias: "amul-high-protein-milk-250-ml-or-pack-of-8", price: 880, expectedGrams: 280, expectedCostPerGram: 3.14, category: "milk" },
  ];

  assert.equal(CATALOG_25.length, 25, "Must test exactly 25 catalog products");

  for (const item of CATALOG_25) {
    const grams = extractProteinGrams(item.name, item.alias);
    assert.notEqual(grams, null, `Protein grams should not be null for ${item.name}`);
    assert.equal(grams, item.expectedGrams, `Mismatched protein grams for ${item.name}`);

    const costPerGram = calculateProteinCostPerGram(item.price, grams);
    assert.notEqual(costPerGram, null, `Cost per gram should not be null for ${item.name}`);
    assert.equal(costPerGram, item.expectedCostPerGram, `Mismatched cost/gram for ${item.name}`);
  }

  // Category 11: Peanut Butter
  const pbGrams = extractProteinGrams("Amul High Protein Peanut Butter, 300 g");
  assert.equal(pbGrams, 78);
  const pbCost = calculateProteinCostPerGram(300, pbGrams);
  assert.equal(pbCost, 3.85);

  // Backward compatibility: explicit 24g whey
  const whey24 = extractProteinGrams("Amul Whey Protein 30 Sachets 24 g");
  assert.equal(whey24, 720);
});

test("Protein Economics: Negative & Non-Protein Items return null", () => {
  assert.equal(extractProteinGrams("Amul Vanilla Magic Ice Cream Tub, 1 L"), null);
  assert.equal(extractProteinGrams("Amul Pure Ghee, 1 L Tin"), null);
  assert.equal(extractProteinGrams("Amul Pasteurized Butter, 500 g"), null);
  assert.equal(extractProteinGrams("Amul Taaza Homogenised Toned Milk, 1 L"), null);
  assert.equal(extractProteinGrams("Amul Gold Full Cream Fresh Milk, 500 mL"), null);
  assert.equal(extractProteinGrams("Amul Processed Cheese Block, 200 g"), null);
  assert.equal(extractProteinGrams("Amul Gulab Jamun, 1 kg Tin"), null);
  assert.equal(extractProteinGrams("Amul Mithai Mate Sweetened Condensed Milk, 200 g"), null);
  assert.equal(extractProteinGrams("Amul Dark 55% Rich Cocoa Chocolate, 150 g"), null);
  assert.equal(extractProteinGrams(""), null);
  assert.equal(extractProteinGrams("Random Non Protein Item 500g"), null);
});

test("Protein Economics: ₹/gram cost calculation precision and boundary conditions", () => {
  // Standard values
  assert.equal(calculateProteinCostPerGram(880, 280), 3.14);
  assert.equal(calculateProteinCostPerGram(3520, 1120), 3.14);
  assert.equal(calculateProteinCostPerGram(400, 625), 0.64);
  assert.equal(calculateProteinCostPerGram(500, 200), 2.50);
  assert.equal(calculateProteinCostPerGram(1200, 600), 2.00);
  assert.equal(calculateProteinCostPerGram(330, 200), 1.65);
  assert.equal(calculateProteinCostPerGram(3960, 2400), 1.65);
  assert.equal(calculateProteinCostPerGram(900, 250), 3.60);
  assert.equal(calculateProteinCostPerGram(920, 250), 3.68);
  assert.equal(calculateProteinCostPerGram(2400, 750), 3.20);
  assert.equal(calculateProteinCostPerGram(2500, 750), 3.33);
  assert.equal(calculateProteinCostPerGram(4200, 1500), 2.80);
  assert.equal(calculateProteinCostPerGram(4500, 1500), 3.00);
  assert.equal(calculateProteinCostPerGram(799, 450), 1.78);
  assert.equal(calculateProteinCostPerGram(900, 450), 2.00);
  assert.equal(calculateProteinCostPerGram(320, 80), 4.00);
  assert.equal(calculateProteinCostPerGram(1200, 300), 4.00);
  assert.equal(calculateProteinCostPerGram(1800, 600), 3.00);

  // Invalid / Zero inputs return null safely
  assert.equal(calculateProteinCostPerGram(0, 450), null);
  assert.equal(calculateProteinCostPerGram(-500, 450), null);
  assert.equal(calculateProteinCostPerGram(900, 0), null);
  assert.equal(calculateProteinCostPerGram(900, -100), null);
  assert.equal(calculateProteinCostPerGram(900, null), null);
  assert.equal(calculateProteinCostPerGram(900, undefined), null);
  assert.equal(calculateProteinCostPerGram(Number.NaN, 450), null);
  assert.equal(calculateProteinCostPerGram(900, Number.NaN), null);
});

test("Token Collision Defense: Substrings do not trigger incorrect catalog rules", () => {
  // Buttermilk has 15g per 200mL, NOT 35g liquid milk
  const buttermilkGrams = extractProteinGrams("Amul High Protein Buttermilk, 200 mL | Pack of 30");
  assert.equal(buttermilkGrams, 450); // 15 * 30, not 35 * 30 (1050)

  // Kool Milkshake has 10g per 180mL, NOT 35g liquid milk
  const milkshakeGrams = extractProteinGrams("Amul Kool Protein Milkshake | Chocolate, 180 mL | Pack of 8");
  assert.equal(milkshakeGrams, 80); // 10 * 8, not 35 * 8 (280)

  // Wheat Flour has 20g protein per sachet, NOT gross sachet weight 65g
  const attaGrams = extractProteinGrams("Amul High Protein Wheat Flour, 65 g | Pack of 30 Sachets");
  assert.equal(attaGrams, 600); // 20 * 30, not 65 * 30 (1950)

  // Whey Protein has 25g protein per sachet, NOT gross powder weight 32g / 34g
  const wheyGrams = extractProteinGrams("Amul Whey Protein, 32 g | Pack of 30 Sachets");
  assert.equal(wheyGrams, 750); // 25 * 30, not 32 * 30 (960)

  // High Protein Paneer has 100g protein per 400g tin (25%), NOT fallback 50g
  const paneerGrams = extractProteinGrams("Amul High Protein Paneer, 400 g | Pack of 2");
  assert.equal(paneerGrams, 200); // 100 * 2, not 50 * 2 (100)
});

test("Product Mapping & Discount Calculations: mapProduct parses discounts and nutrition accurately", () => {
  // 1. Discount with original_price and discounts_total (e.g. Buttermilk ₹799 vs ₹900)
  const buttermilkRaw = {
    _id: "prod_btm_1",
    sku: "BTMCP11_30",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk-200-ml-or-pack-of-30",
    price: 799,
    compare_price: "",
    original_price: 900,
    discounts_total: 101,
    available: 10,
    inventory_quantity: 10,
    inventory_low_stock_quantity: 2,
    inventory_allow_out_of_stock: false,
    metafields: { benefits: "Enriched with 15g protein" },
    description: "Amul High Protein Buttermilk 15g protein per bottle",
  };
  const buttermilkMapped = mapProduct(buttermilkRaw as any);
  assert.equal(buttermilkMapped.price, 799);
  assert.equal(buttermilkMapped.comparePrice, 900);
  assert.equal(buttermilkMapped.discountAmount, 101);
  assert.equal(buttermilkMapped.discountPct, 11);
  assert.equal(buttermilkMapped.proteinGrams, 450);
  assert.equal(buttermilkMapped.costPerGramProtein, 1.78);
  assert.equal(buttermilkMapped.proteinPerServing, 15);
  assert.equal(buttermilkMapped.inStock, true);

  // 2. Discount with compare_price > price (e.g. ₹320 vs ₹400 -> 20% discount)
  const promoItemRaw = {
    _id: "prod_promo_1",
    sku: "PROMO_SKU",
    name: "Amul Kool Protein Milkshake | Chocolate, 180 mL | Pack of 8",
    alias: "amul-kool-protein-milkshake-or-chocolate-180-ml-or-pack-of-8",
    price: 320,
    compare_price: 400,
    available: 5,
    inventory_quantity: 5,
  };
  const promoMapped = mapProduct(promoItemRaw as any);
  assert.equal(promoMapped.price, 320);
  assert.equal(promoMapped.comparePrice, 400);
  assert.equal(promoMapped.discountAmount, 80);
  assert.equal(promoMapped.discountPct, 20);
  assert.equal(promoMapped.proteinGrams, 80);
  assert.equal(promoMapped.costPerGramProtein, 4.00);

  // 3. Discount with compare_price_discount (e.g. ₹500 with ₹100 discount -> comparePrice 600)
  const compDiscRaw = {
    _id: "prod_disc_1",
    sku: "DISC_SKU",
    name: "Amul High Protein Cubes 190 g | Pack of 5",
    alias: "amul-high-protein-cubes-190-g-or-pack-of-5",
    price: 500,
    compare_price_discount: 100,
    available: 2,
    inventory_quantity: 2,
  };
  const compDiscMapped = mapProduct(compDiscRaw as any);
  assert.equal(compDiscMapped.price, 500);
  assert.equal(compDiscMapped.comparePrice, 600);
  assert.equal(compDiscMapped.discountAmount, 100);
  assert.equal(compDiscMapped.discountPct, 17);
  assert.equal(compDiscMapped.proteinGrams, 625);

  // 4. Undiscounted product (compare_price == price) -> null discounts
  const undiscountedRaw = {
    _id: "prod_regular_1",
    sku: "REG_SKU",
    name: "Amul Kool Protein Milkshake | Chocolate, 180 mL | Pack of 8",
    alias: "amul-kool-protein-milkshake-or-chocolate-180-ml-or-pack-of-8",
    price: 320,
    compare_price: 320,
    original_price: 320,
    discounts_total: 0,
    available: 10,
    inventory_quantity: 10,
  };
  const undiscountedMapped = mapProduct(undiscountedRaw as any);
  assert.equal(undiscountedMapped.comparePrice, null);
  assert.equal(undiscountedMapped.discountAmount, null);
  assert.equal(undiscountedMapped.discountPct, null);

  // 5. Undiscounted product with empty string compare_price
  const emptyCompareRaw = {
    _id: "prod_empty_cp",
    sku: "EMPTY_CP_SKU",
    name: "Amul High Protein Milk, 250 mL | Pack of 8",
    alias: "amul-high-protein-milk-250-ml-or-pack-of-8",
    price: 880,
    compare_price: "",
    original_price: "",
    discounts_total: 0,
    available: 5,
    inventory_quantity: 5,
  };
  const emptyCpMapped = mapProduct(emptyCompareRaw as any);
  assert.equal(emptyCpMapped.comparePrice, null);
  assert.equal(emptyCpMapped.discountAmount, null);
  assert.equal(emptyCpMapped.discountPct, null);

  // 6. Abnormal reverse discount (price > compare_price) -> clamp to null
  const reverseRaw = {
    _id: "prod_rev_1",
    sku: "REV_SKU",
    name: "Amul High Protein Wheat Flour, 65 g | Pack of 30 Sachets",
    alias: "amul-high-protein-wheat-flour-65-g-or-pack-of-30-sachets",
    price: 1200,
    compare_price: 1000,
    available: 4,
    inventory_quantity: 4,
  };
  const reverseMapped = mapProduct(reverseRaw as any);
  assert.equal(reverseMapped.comparePrice, null);
  assert.equal(reverseMapped.discountAmount, null);
  assert.equal(reverseMapped.discountPct, null);
});

test("Protein Yield Formatting: formatProteinYield formats output cleanly", () => {
  assert.equal(formatProteinYield("Amul Whey Protein, 32 g | Pack of 30 Sachets", "", 750), "750g · 25g/sachet");
  assert.equal(formatProteinYield("Amul High Protein Buttermilk, 200 mL | Pack of 30", "", 450), "450g · 15g/bottle");
  assert.equal(formatProteinYield("Amul High Protein Blueberry Shake, 200 mL | Pack of 30", "", 600), "600g · 20g/shake");
  assert.equal(formatProteinYield("Amul High Protein Paneer, 400 g | Pack of 2", "", 200), "200g · 100g/pack");
  assert.equal(formatProteinYield("Amul High Protein Wheat Flour, 65 g | Pack of 30 Sachets", "", 600), "600g · 20g/sachet");
  assert.equal(formatProteinYield("Amul High Protein Cubes 190 g | Pack of 5", "", 625), "625g · 125g/pack");
  assert.equal(formatProteinYield("Amul High Protein Dark Chocolate Peanut Spread, 250 g | Pack of 2", "", 200), "200g · 100g/jar");
  assert.equal(formatProteinYield("Generic Ice Cream", "", null), null);
});

test("Circadian Adaptive Polling: IST decimal hour calculation", () => {
  // 04:30 UTC -> 10:00 IST (10.0)
  const d1 = new Date("2026-09-06T04:30:00Z");
  assert.equal(Math.round(getISTDecimalHour(d1) * 10) / 10, 10);

  // 13:00 UTC -> 18:30 IST (18.5)
  const d2 = new Date("2026-09-06T13:00:00Z");
  assert.equal(Math.round(getISTDecimalHour(d2) * 10) / 10, 18.5);

  // 18:00 UTC -> 23:30 IST (23.5)
  const d3 = new Date("2026-09-06T18:00:00Z");
  assert.equal(Math.round(getISTDecimalHour(d3) * 10) / 10, 23.5);

  // 22:00 UTC -> 03:30 IST (3.5)
  const d4 = new Date("2026-09-06T22:00:00Z");
  assert.equal(Math.round(getISTDecimalHour(d4) * 10) / 10, 3.5);
});

test("Circadian Adaptive Polling: interval scaling across restock and dormancy windows", () => {
  const trackedProduct: TrackedProduct = {
    sku: "TEST-SKU",
    quantity: 1,
    name: "Amul Protein Lassi",
    alias: "amul-protein-lassi",
    productId: "prod_1",
  };

  const outOfStockCatalog: AmulProduct[] = [
    {
      id: "prod_1",
      sku: "TEST-SKU",
      name: "Amul Protein Lassi",
      alias: "amul-protein-lassi",
      price: 40,
      available: 0,
      inventoryQuantity: 0,
      inventoryLowStock: 0,
      inStock: false,
      imageUrl: null,
      productUrl: "https://shop.amul.com/test",
    },
  ];

  const inStockCatalog: AmulProduct[] = [
    {
      ...outOfStockCatalog[0],
      available: 10,
      inventoryQuantity: 10,
      inStock: true,
    },
  ];

  const baseConfig: AppConfig = {
    ...DEFAULT_CONFIG,
    pincode: "560001",
    products: [trackedProduct],
    pollMinMs: 6000,
    pollMaxMs: 40000,
  };

  // 1. Night Dormancy (02:00 IST = 20:30 UTC previous day): should back off (>= 40000ms)
  const nightDate = new Date("2026-09-05T20:30:00Z");
  const nightInterval = calculateAdaptiveInterval(
    {
      config: baseConfig,
      products: outOfStockCatalog,
      checkout: null,
    } as any,
    nightDate
  );
  assert.ok(
    nightInterval >= 40000,
    `Night interval should be >= 40000, got ${nightInterval}`
  );

  // 2. Daytime Peak (11:00 IST = 05:30 UTC): should be aggressive (<= 8000ms)
  const peakDate = new Date("2026-09-06T05:30:00Z");
  const peakInterval = calculateAdaptiveInterval(
    {
      config: baseConfig,
      products: outOfStockCatalog,
      checkout: null,
    } as any,
    peakDate
  );
  assert.ok(
    peakInterval <= 8000,
    `Peak interval should be <= 8000, got ${peakInterval}`
  );

  // 3. In-stock tracked SKU at night: MUST still poll at pollMinMs (6000)
  const inStockInterval = calculateAdaptiveInterval(
    {
      config: baseConfig,
      products: inStockCatalog,
    } as any,
    nightDate
  );
  assert.equal(inStockInterval, 6000);
});

test("Config Ingestion: getConfig returns application configuration", () => {
  applyConfig({ discordWebhookUrl: "https://discord.com/api/webhooks/test/123", discordEnabled: true });
  const cfg = getConfig();
  assert.equal(cfg.discordWebhookUrl, "https://discord.com/api/webhooks/test/123");
  assert.equal(cfg.discordEnabled, true);
});

test("Session Resilience: AmulClient auto-expires stale sessions", () => {
  const client = new AmulClient();
  
  // Uninitialized client has no session
  assert.equal(client.hasSession(), false);

  // Demo session is always considered valid
  client.isDemoSession = true;
  assert.equal(client.hasSession(), true);
  client.isDemoSession = false;

  // Stale session (created 3 hours ago) should be treated as expired
  client.importCookies("jsessionid=test_cookie_123");
  client["tid"] = "sample_tid";
  client["sessionCreatedAt"] = Date.now() - 3 * 60 * 60 * 1000;
  assert.equal(client.hasSession(), false, "Session older than 2 hours must expire");

  // Fresh session (created 5 minutes ago) should be valid
  client["sessionCreatedAt"] = Date.now() - 5 * 60 * 1000;
  assert.equal(client.hasSession(), true, "Fresh session within 2 hours must be valid");
});

// ============================================================================
// Regression Tests: Milestone 1 Iteration 2 Hardening
// ============================================================================

test("Regression: stripHtml safely handles non-string inputs with zero exceptions", () => {
  // 1. Numbers (positive, zero, negative, NaN, Infinity)
  const numbers = [123, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (const num of numbers) {
    assert.doesNotThrow(() => {
      const result = stripHtml(num as any);
      assert.strictEqual(typeof result, "string", `stripHtml must return string for number: ${num}`);
      assert.strictEqual(result, "", `stripHtml must return empty string for number: ${num}`);
    });
  }

  // 2. Booleans (true, false)
  const booleans = [true, false];
  for (const b of booleans) {
    assert.doesNotThrow(() => {
      const result = stripHtml(b as any);
      assert.strictEqual(typeof result, "string", `stripHtml must return string for boolean: ${b}`);
      assert.strictEqual(result, "", `stripHtml must return empty string for boolean: ${b}`);
    });
  }

  // 3. Null and Undefined
  assert.doesNotThrow(() => {
    assert.strictEqual(stripHtml(null), "");
    assert.strictEqual(stripHtml(undefined), "");
  });

  // 4. Objects (empty object, populated object)
  const objects = [{}, { key: "value" }, { benefits: "15g" }];
  for (const obj of objects) {
    assert.doesNotThrow(() => {
      const result = stripHtml(obj as any);
      assert.strictEqual(typeof result, "string", "stripHtml must return string for object");
      assert.strictEqual(result, "", "stripHtml must return empty string for object");
    });
  }

  // 5. Arrays (empty array, populated array)
  const arrays = [[], [1, 2, 3], ["<p>test</p>"]];
  for (const arr of arrays) {
    assert.doesNotThrow(() => {
      const result = stripHtml(arr as any);
      assert.strictEqual(typeof result, "string", "stripHtml must return string for array");
      assert.strictEqual(result, "", "stripHtml must return empty string for array");
    });
  }

  // 6. Valid HTML strings & formatting
  assert.strictEqual(stripHtml("<p>Hello World</p>"), "Hello World");
  assert.strictEqual(stripHtml("<div><span>35g Protein &nbsp; Per Pack</span></div>"), "35g Protein Per Pack");
  assert.strictEqual(stripHtml("&nbsp;&nbsp;20g&nbsp;&ndash;&nbsp;Protein&rsquo;s&nbsp;pack&nbsp;"), "20g - Protein's pack");
  assert.strictEqual(stripHtml("<p>Unclosed <div>tags galore"), "Unclosed tags galore");
  assert.strictEqual(stripHtml("   "), "");

  // 7. End-to-end integration via extractNutritionInfo with corrupt metafields
  assert.doesNotThrow(() => {
    const info = extractNutritionInfo(
      "Amul High Protein Milk, 250 mL | Pack of 8",
      "amul-high-protein-milk-250-ml-or-pack-of-8",
      {
        benefits: 1234 as any,
        how_to_useit: true as any,
        ingredients: {} as any,
        extra: [] as any,
      },
      9999 as any,
    );
    assert.strictEqual(info.proteinGrams, 280);
    assert.strictEqual(info.proteinPerServing, 35);
  });
});

test("Regression: productImageUrl and maskSecret safely handle non-string inputs without throwing", () => {
  const badInputs = [1234, true, false, {}, { url: "http://..." }, [1, 2], null, undefined];
  for (const bad of badInputs) {
    assert.doesNotThrow(() => {
      const img = productImageUrl(bad as any);
      assert.strictEqual(img, null);
    });
    assert.doesNotThrow(() => {
      const masked = maskSecret(bad as any);
      assert.strictEqual(masked, "");
    });
  }
});

test("Regression: mapProduct sanitizes corrupt, non-numeric, zero, and negative prices", () => {
  const baseRaw = {
    _id: "prod_reg_test",
    sku: "TEST_SKU",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk-200-ml-or-pack-of-30",
    available: 10,
    inventory_quantity: 10,
  };

  // Case 1: Corrupt price strings ("invalid", "N/A") -> evaluates to price: 0, costPerGramProtein: null
  const corruptPrices = ["invalid", "N/A", "NaN", "undefined", "foo"];
  for (const corruptPrice of corruptPrices) {
    const p = mapProduct({
      ...baseRaw,
      price: corruptPrice as any,
    });
    assert.strictEqual(p.price, 0, `price should evaluate to 0 for corrupt price "${corruptPrice}"`);
    assert.strictEqual(Number.isNaN(p.price), false, `price must not be NaN for "${corruptPrice}"`);
    assert.strictEqual(p.costPerGramProtein, null, `costPerGramProtein must be null when price is 0`);
    assert.strictEqual(p.comparePrice, null, `comparePrice must be null when price is 0`);
    assert.strictEqual(p.discountAmount, null, `discountAmount must be null when price is 0`);
    assert.strictEqual(p.discountPct, null, `discountPct must be null when price is 0`);
  }

  // Case 2: Negative price (price: -50) -> evaluates to price: 0
  const pNeg50 = mapProduct({
    ...baseRaw,
    price: -50,
  });
  assert.strictEqual(pNeg50.price, 0, "negative price -50 should evaluate to 0");
  assert.strictEqual(Number.isNaN(pNeg50.price), false, "price must not be NaN");
  assert.strictEqual(pNeg50.costPerGramProtein, null, "costPerGramProtein must be null for price: 0");
  assert.strictEqual(pNeg50.comparePrice, null, "comparePrice must be null for negative price");
  assert.strictEqual(pNeg50.discountAmount, null, "discountAmount must be null for negative price");
  assert.strictEqual(pNeg50.discountPct, null, "discountPct must be null for negative price");

  // Case 3: Negative price with discounts_total (price: -10, discounts_total: 10) -> discountPct: null, comparePrice: null
  const pNeg10 = mapProduct({
    ...baseRaw,
    price: -10,
    discounts_total: 10,
  } as any);
  assert.strictEqual(pNeg10.price, 0, "price: -10 must evaluate to 0");
  assert.strictEqual(pNeg10.comparePrice, null, "comparePrice must be null when price <= 0");
  assert.strictEqual(pNeg10.discountAmount, null, "discountAmount must be null when price <= 0");
  assert.strictEqual(pNeg10.discountPct, null, "discountPct must be null when price <= 0");
  assert.notStrictEqual(pNeg10.discountPct, Number.POSITIVE_INFINITY, "discountPct must NEVER be Infinity");

  // Case 4: Price 0 with compare_price (price: 0, compare_price: 100) -> discountPct: null, comparePrice: null
  const pZeroWithCompare = mapProduct({
    ...baseRaw,
    price: 0,
    compare_price: 100,
  });
  assert.strictEqual(pZeroWithCompare.price, 0, "price should be 0");
  assert.strictEqual(pZeroWithCompare.comparePrice, null, "comparePrice must be null when price is 0");
  assert.strictEqual(pZeroWithCompare.discountAmount, null, "discountAmount must be null when price is 0");
  assert.strictEqual(pZeroWithCompare.discountPct, null, "discountPct must be null when price is 0");

  // Case 5: Negative price with compare_price (price: -100, compare_price: 200) -> discountPct: null, comparePrice: null
  const pNegWithCompare = mapProduct({
    ...baseRaw,
    price: -100,
    compare_price: 200,
  });
  assert.strictEqual(pNegWithCompare.price, 0, "price: -100 must evaluate to 0");
  assert.strictEqual(pNegWithCompare.comparePrice, null, "comparePrice must be null for negative price");
  assert.strictEqual(pNegWithCompare.discountAmount, null, "discountAmount must be null for negative price");
  assert.strictEqual(pNegWithCompare.discountPct, null, "discountPct must be null for negative price");

  // Case 6: Price 0 with original_price or compare_price_discount -> clamp to null
  const pZeroOriginal = mapProduct({
    ...baseRaw,
    price: 0,
    original_price: 250,
    compare_price_discount: 50,
    discounts_total: 50,
  } as any);
  assert.strictEqual(pZeroOriginal.price, 0);
  assert.strictEqual(pZeroOriginal.comparePrice, null);
  assert.strictEqual(pZeroOriginal.discountAmount, null);
  assert.strictEqual(pZeroOriginal.discountPct, null);
});
