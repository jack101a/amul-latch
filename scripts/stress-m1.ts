import { mapProduct } from "../src/lib/amul/client.js";
import {
  calculateProteinCostPerGram,
  extractProteinGrams,
  extractNutritionInfo,
  extractPackMultiplier,
  formatProteinYield,
} from "../src/lib/amul/types.js";

console.log("=== STARTING M1 EMPIRICAL STRESS TEST ===");

let passed = 0;
let failed = 0;
const failureDetails: string[] = [];

function check(desc: string, condition: boolean, extra?: any) {
  if (condition) {
    passed++;
  } else {
    failed++;
    const msg = `FAIL: ${desc} ${extra ? JSON.stringify(extra) : ""}`;
    console.error(msg);
    failureDetails.push(msg);
  }
}

// ==========================================
// 1. CORRUPT & BOUNDARY DISCOUNT FIELDS
// ==========================================
console.log("\n--- Category 1: Corrupt & Boundary Discount Fields ---");

// 1.1 String numbers
{
  const p = mapProduct({
    _id: "s1",
    sku: "S1",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 320,
    compare_price: "400" as any,
  });
  check("String compare_price '400'", p.comparePrice === 400 && p.discountAmount === 80 && p.discountPct === 20, p);
}

{
  const p = mapProduct({
    _id: "s2",
    sku: "S2",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 320,
    compare_price: "  400.50  " as any,
  });
  check("Whitespace padded decimal string '  400.50  '", p.comparePrice === 400.5 && p.discountAmount === 80.5 && p.discountPct === 20, p);
}

{
  const p = mapProduct({
    _id: "s3",
    sku: "S3",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 400,
    original_price: "500" as any,
  });
  check("String original_price '500'", p.comparePrice === 500 && p.discountAmount === 100 && p.discountPct === 20, p);
}

{
  const p = mapProduct({
    _id: "s4",
    sku: "S4",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 200,
    discounts_total: "50" as any,
  });
  check("String discounts_total '50'", p.comparePrice === 250 && p.discountAmount === 50 && p.discountPct === 20, p);
}

{
  const p = mapProduct({
    _id: "s5",
    sku: "S5",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 300,
    compare_price_discount: "100" as any,
  });
  check("String compare_price_discount '100'", p.comparePrice === 400 && p.discountAmount === 100 && p.discountPct === 25, p);
}

// 1.2 Empty strings and whitespace
{
  const p = mapProduct({
    _id: "e1",
    sku: "E1",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 320,
    compare_price: "",
    original_price: "",
    discounts_total: "" as any,
  });
  check("Empty strings for all discount fields", p.comparePrice === null && p.discountAmount === null && p.discountPct === null, p);
}

{
  const p = mapProduct({
    _id: "e2",
    sku: "E2",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 320,
    compare_price: "    ",
    original_price: "\t\n",
  });
  check("Whitespace-only strings", p.comparePrice === null && p.discountAmount === null && p.discountPct === null, p);
}

// 1.3 Non-numeric corrupt strings
{
  const p = mapProduct({
    _id: "c1",
    sku: "C1",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 320,
    compare_price: "not-a-number" as any,
    original_price: "undefined" as any,
    discounts_total: "NaN" as any,
  });
  check("Non-numeric strings do not produce NaN or error", p.comparePrice === null && p.discountAmount === null && p.discountPct === null, p);
}

// 1.4 Reverse compare prices (compare_price < price)
{
  const p = mapProduct({
    _id: "r1",
    sku: "R1",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 500,
    compare_price: 400,
  });
  check("Reverse compare_price (400 < 500) clamps to null", p.comparePrice === null && p.discountAmount === null && p.discountPct === null, p);
}

{
  const p = mapProduct({
    _id: "r2",
    sku: "R2",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 500,
    compare_price: 500,
  });
  check("Equal compare_price (500 == 500) clamps to null", p.comparePrice === null && p.discountAmount === null && p.discountPct === null, p);
}

// 1.5 discounts_total without original_price
{
  const p = mapProduct({
    _id: "d1",
    sku: "D1",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 799,
    discounts_total: 101,
  });
  check("discounts_total without original_price reconstructs comparePrice", p.comparePrice === 900 && p.discountAmount === 101 && p.discountPct === 11, p);
}

// 1.6 Negative price handling
{
  const p = mapProduct({
    _id: "neg1",
    sku: "NEG1",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: -100,
    compare_price: 200,
  });
  console.log("Negative price product result:", { price: p.price, comparePrice: p.comparePrice, discountAmount: p.discountAmount, discountPct: p.discountPct, costPerGram: p.costPerGramProtein });
  check("Negative price does not calculate protein cost per gram", p.costPerGramProtein === null, p);
}

// 1.7 Price = 0 handling
{
  const p = mapProduct({
    _id: "zero1",
    sku: "ZERO1",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 0,
    compare_price: 100,
  });
  check("Price 0 does not calculate costPerGram", p.costPerGramProtein === null, p);
}

// ==========================================
// 2. FLOATING POINT & NUMERIC PRECISION
// ==========================================
console.log("\n--- Category 2: Floating Point & Precision ---");

// 2.1 calculateProteinCostPerGram
check("Normal: 799 / 450 = 1.78", calculateProteinCostPerGram(799, 450) === 1.78);
check("Normal: 2500 / 750 = 3.33", calculateProteinCostPerGram(2500, 750) === 3.33);
check("Zero price -> null", calculateProteinCostPerGram(0, 100) === null);
check("Negative price -> null", calculateProteinCostPerGram(-10, 100) === null);
check("Zero grams -> null", calculateProteinCostPerGram(100, 0) === null);
check("Negative grams -> null", calculateProteinCostPerGram(100, -10) === null);
check("NaN price -> null", calculateProteinCostPerGram(NaN, 100) === null);
check("NaN grams -> null", calculateProteinCostPerGram(100, NaN) === null);
check("Infinity price -> null", calculateProteinCostPerGram(Infinity, 100) === null);
check("-Infinity price -> null", calculateProteinCostPerGram(-Infinity, 100) === null);
check("Infinity grams -> null", calculateProteinCostPerGram(100, Infinity) === null);
check("null grams -> null", calculateProteinCostPerGram(100, null) === null);
check("undefined grams -> null", calculateProteinCostPerGram(100, undefined) === null);
check("String price -> null", calculateProteinCostPerGram("100" as any, 50) === null);
check("String grams -> null", calculateProteinCostPerGram(100, "50" as any) === null);
check("Floating round: 10 / 3 = 3.33", calculateProteinCostPerGram(10, 3) === 3.33);
check("Tiny values: 0.01 / 0.01 = 1.00", calculateProteinCostPerGram(0.01, 0.01) === 1.00);
check("Sub-cent rounding: 1 / 300 = 0.00", calculateProteinCostPerGram(1, 300) === 0.00);
check("Very large: 1e8 / 100 = 1e6", calculateProteinCostPerGram(100000000, 100) === 1000000);

// 2.2 mapProduct discount rounding & precision
{
  const p = mapProduct({
    _id: "prec1",
    sku: "PREC1",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 19.99,
    compare_price: 29.99,
  });
  // 29.99 - 19.99 in JS is 10.000000000000002
  check("Float subtraction precision: 29.99 - 19.99 = 10", p.discountAmount === 10.00, p);
  // (10 / 29.99) * 100 = 33.3444... -> 33%
  check("Discount percentage: 33%", p.discountPct === 33, p);
}

{
  const p = mapProduct({
    _id: "prec2",
    sku: "PREC2",
    name: "Amul High Protein Buttermilk, 200 mL | Pack of 30",
    alias: "amul-high-protein-buttermilk",
    price: 0.1,
    compare_price: 0.3,
  });
  // 0.3 - 0.1 in JS is 0.19999999999999998
  check("Float precision 0.3 - 0.1 = 0.2", p.discountAmount === 0.2, p);
  check("Discount percentage for small float: 67%", p.discountPct === 67, p);
}

// ==========================================
// 3. LARGE CATALOG SIMULATIONS (1000 items)
// ==========================================
console.log("\n--- Category 3: Large Catalog Simulation (1000 items) ---");

const seedWords = ["Whey", "Buttermilk", "Shake", "Kool", "Cubes", "Paneer", "Flour", "Spread", "Butter", "Milk", "Ghee", "Chocolate", "Lassi"];
const packPatterns = ["Pack of 30", "Pack of 8", "Pack 12", "Pack of 60 Sachets", "Pack of 2", "Pack of 24", "10 sachets", "24x", "Pack of 1", ""];
const priceVariations = [
  0, 1, 10, 19.99, 49.5, 99, 150, 199.95, 320, 450, 799, 880, 920, 1200, 1800, 2500, 3960,
  -10, -500, 100000, 0.05,
  "799", "1200.50", "   320   ", "", "invalid", null, undefined
];
const comparePriceVariations = [
  0, 50, 100, 350, 400, 800, 900, 1000, 1500, 2000, 3000, 5000,
  -100, 0.1, 0.05,
  "900", "  1500  ", "", "foo", null, undefined
];

let catalogPassCount = 0;
let nanDetectedCount = 0;
let crashCount = 0;
let inconsistentDiscountCount = 0;

for (let i = 0; i < 1000; i++) {
  const word1 = seedWords[i % seedWords.length];
  const word2 = seedWords[(i * 3 + 1) % seedWords.length];
  const pack = packPatterns[i % packPatterns.length];
  const name = `Amul High Protein ${word1} ${word2} 200 g | ${pack}`.trim();
  const alias = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  const priceVal = priceVariations[i % priceVariations.length];
  const compareVal = comparePriceVariations[(i * 7) % comparePriceVariations.length];
  const discTotal = (i % 5 === 0) ? (i % 100) : ((i % 7 === 0) ? `${i % 50}` : undefined);
  const compDisc = (i % 11 === 0) ? (i % 80) : undefined;

  const rawItem = {
    _id: `sim_${i}`,
    sku: `SKU_${i}`,
    name,
    alias,
    price: priceVal as any,
    compare_price: compareVal as any,
    discounts_total: discTotal as any,
    compare_price_discount: compDisc as any,
    available: (i % 2 === 0) ? 10 : 0,
    inventory_quantity: (i % 2 === 0) ? 10 : 0,
    metafields: (i % 3 === 0) ? { benefits: `Provides ${15 + (i % 20)}g protein per serving` } : undefined,
    description: (i % 4 === 0) ? `Best quality whey with ${(i % 10) * 10}% protein` : undefined,
  };

  try {
    const result = mapProduct(rawItem as any);

    // Check for NaN in numeric properties
    let hasNaN = false;
    for (const [key, val] of Object.entries(result)) {
      if (typeof val === "number" && Number.isNaN(val)) {
        hasNaN = true;
        nanDetectedCount++;
        console.error(`NaN detected in item ${i} at key ${key}:`, { rawItem, result });
        break;
      }
    }

    // Consistency of discounts
    if (result.comparePrice !== null) {
      if (result.comparePrice <= result.price) {
        inconsistentDiscountCount++;
        console.error(`Inconsistent discount: comparePrice <= price`, { i, price: result.price, comparePrice: result.comparePrice });
      }
      if (result.discountAmount === null || result.discountAmount <= 0) {
        inconsistentDiscountCount++;
        console.error(`Inconsistent discountAmount`, { i, result });
      }
      if (result.discountPct === null) {
        inconsistentDiscountCount++;
        console.error(`Inconsistent discountPct`, { i, result });
      }
    } else {
      if (result.discountAmount !== null || result.discountPct !== null) {
        inconsistentDiscountCount++;
        console.error(`comparePrice is null but discountAmount/Pct is not null`, { i, result });
      }
    }

    // Consistency of costPerGramProtein
    if (result.costPerGramProtein !== null) {
      if (!Number.isFinite(result.costPerGramProtein) || result.costPerGramProtein < 0) {
        console.error(`Invalid costPerGramProtein`, { i, result });
        inconsistentDiscountCount++;
      }
    }

    if (!hasNaN) {
      catalogPassCount++;
    }
  } catch (err: any) {
    crashCount++;
    console.error(`Crash on simulation item ${i}:`, err.message);
  }
}

check("1000 simulated catalog products did not crash", crashCount === 0, { crashCount });
check("Zero NaN occurrences in 1000 simulated products", nanDetectedCount === 0, { nanDetectedCount });
check("Zero discount inconsistencies across 1000 products", inconsistentDiscountCount === 0, { inconsistentDiscountCount });
check("All 1000 products processed successfully", catalogPassCount === 1000, { catalogPassCount });

console.log("\n==========================================");
console.log(`TOTAL CHECKS: ${passed + failed}`);
console.log(`PASSED: ${passed}`);
console.log(`FAILED: ${failed}`);
if (failureDetails.length > 0) {
  console.log("FAILURES:");
  failureDetails.forEach((f) => console.log(" - " + f));
}
console.log("==========================================");

process.exit(failed > 0 ? 1 : 0);
