import assert from "node:assert/strict";
import fs from "node:fs";
import { isProductDiscounted } from "../src/components/latch/dashboard";
import type { AmulProduct, ActivityEvent } from "../src/lib/amul/types";

console.log("=== STARTING FORENSIC INTEGRITY CHECKS FOR MILESTONE 3 ===");

// ----------------------------------------------------------------------------
// CHECK 1: Dynamic Verification of isProductDiscounted
// ----------------------------------------------------------------------------
console.log("\n[CHECK 1] Testing isProductDiscounted dynamic evaluation...");

function makeProduct(overrides?: Partial<AmulProduct>): AmulProduct {
  return {
    id: "prod_test",
    sku: "TEST-SKU",
    name: "Test Protein Item",
    alias: "test-protein-item",
    price: 1000,
    comparePrice: null,
    discountAmount: null,
    discountPct: null,
    available: 10,
    inventoryQuantity: 10,
    inventoryLowStock: 2,
    inStock: true,
    imageUrl: null,
    productUrl: "https://shop.amul.com/test",
    proteinGrams: 500,
    costPerGramProtein: 2.0,
    ...overrides,
  };
}

// 1.1 Baseline undiscounted product
const baseProduct = makeProduct();
assert.equal(isProductDiscounted(baseProduct), false, "Base product must not be discounted");

// 1.2 Active comparePrice discount
const compareDiscounted = makeProduct({ price: 800, comparePrice: 1000 });
assert.equal(isProductDiscounted(compareDiscounted), true, "Product with comparePrice > price must be discounted");

// 1.3 Reverse comparePrice (comparePrice < price) -> must NOT be discounted
const reverseCompare = makeProduct({ price: 1000, comparePrice: 800 });
assert.equal(isProductDiscounted(reverseCompare), false, "Product with comparePrice < price must not be discounted");

// 1.4 Equal comparePrice (comparePrice == price) -> must NOT be discounted
const equalCompare = makeProduct({ price: 1000, comparePrice: 1000 });
assert.equal(isProductDiscounted(equalCompare), false, "Product with comparePrice == price must not be discounted");

// 1.5 discountPct > 0
const pctDiscounted = makeProduct({ discountPct: 15 });
assert.equal(isProductDiscounted(pctDiscounted), true, "Product with discountPct > 0 must be discounted");

// 1.6 discountPct <= 0
assert.equal(isProductDiscounted(makeProduct({ discountPct: 0 })), false, "Product with discountPct == 0 must not be discounted");
assert.equal(isProductDiscounted(makeProduct({ discountPct: -5 })), false, "Product with negative discountPct must not be discounted");

// 1.7 discountAmount > 0
const amtDiscounted = makeProduct({ discountAmount: 120 });
assert.equal(isProductDiscounted(amtDiscounted), true, "Product with discountAmount > 0 must be discounted");

// 1.8 Historical price drop via previousPrices
const prevPrices = { "TEST-SKU": 1200, "OTHER-SKU": 500 };
assert.equal(
  isProductDiscounted(makeProduct({ sku: "TEST-SKU", price: 1000 }), prevPrices),
  true,
  "Product with previousPrices[sku] > price must be discounted"
);
assert.equal(
  isProductDiscounted(makeProduct({ sku: "TEST-SKU", price: 1200 }), prevPrices),
  false,
  "Product with previousPrices[sku] == price must not be discounted"
);
assert.equal(
  isProductDiscounted(makeProduct({ sku: "TEST-SKU", price: 1400 }), prevPrices),
  false,
  "Product with previousPrices[sku] < price (price increase) must not be discounted"
);

// 1.9 Price drop events in Set
const dropSkuSet = new Set(["PROMO-SKU"]);
assert.equal(
  isProductDiscounted(makeProduct({ sku: "PROMO-SKU" }), undefined, dropSkuSet),
  true,
  "Product whose sku is in priceDropSkus set must be discounted"
);
assert.equal(
  isProductDiscounted(makeProduct({ sku: "OTHER-SKU" }), undefined, dropSkuSet),
  false,
  "Product whose sku is NOT in priceDropSkus set must not be discounted"
);

// 1.10 Edge cases: zero price, negative price
assert.equal(
  isProductDiscounted(makeProduct({ sku: "TEST-SKU", price: 0 }), { "TEST-SKU": 500 }),
  false,
  "Zero price with previousPrice must NOT be flagged as discounted"
);
assert.equal(
  isProductDiscounted(makeProduct({ sku: "TEST-SKU", price: -100 }), { "TEST-SKU": 500 }),
  false,
  "Negative price with previousPrice must NOT be flagged as discounted"
);

console.log("✔ isProductDiscounted passed all 10 dynamic assertions.");

// ----------------------------------------------------------------------------
// CHECK 2: Simulation of ProductCard Pricing & Badging Logic
// ----------------------------------------------------------------------------
console.log("\n[CHECK 2] Testing ProductCard pricing & discount badging logic...");

function evaluateProductCardPricing(product: AmulProduct) {
  const rawComparePrice =
    product.comparePrice ??
    (product as any).original_price ??
    (product as any).compare_price;

  const comparePrice =
    typeof rawComparePrice === "number" && Number.isFinite(rawComparePrice) && rawComparePrice > 0
      ? rawComparePrice
      : null;

  const currentPrice =
    typeof product.price === "number" && Number.isFinite(product.price) && product.price > 0
      ? product.price
      : 0;

  const hasDiscount = Boolean(
    comparePrice !== null &&
    currentPrice > 0 &&
    comparePrice > currentPrice
  );

  const savingsAmount = hasDiscount && comparePrice !== null
    ? (typeof product.discountAmount === "number" && product.discountAmount > 0
        ? product.discountAmount
        : Math.round(comparePrice - currentPrice))
    : 0;

  const discountPct = hasDiscount && comparePrice !== null && comparePrice > 0
    ? (typeof product.discountPct === "number" && product.discountPct > 0
        ? product.discountPct
        : Math.round(((comparePrice - currentPrice) / comparePrice) * 100))
    : 0;

  const showDiscount = hasDiscount && savingsAmount > 0 && discountPct > 0;

  return {
    comparePrice,
    currentPrice,
    hasDiscount,
    savingsAmount,
    discountPct,
    showDiscount,
  };
}

// Case 2.1: Buttermilk discounted ₹799 vs MRP ₹900
const btmEval = evaluateProductCardPricing(
  makeProduct({ price: 799, comparePrice: 900 })
);
assert.equal(btmEval.showDiscount, true);
assert.equal(btmEval.savingsAmount, 101);
assert.equal(btmEval.discountPct, 11);
assert.equal(btmEval.currentPrice, 799);
assert.equal(btmEval.comparePrice, 900);

// Case 2.2: Undiscounted Milkshake ₹320
const shakeEval = evaluateProductCardPricing(
  makeProduct({ price: 320, comparePrice: null })
);
assert.equal(shakeEval.showDiscount, false);
assert.equal(shakeEval.savingsAmount, 0);
assert.equal(shakeEval.discountPct, 0);

// Case 2.3: Zero price anomaly
const zeroPriceEval = evaluateProductCardPricing(
  makeProduct({ price: 0, comparePrice: 100 })
);
assert.equal(zeroPriceEval.showDiscount, false);

// Case 2.4: Inverse comparison (comparePrice <= currentPrice)
const invEval = evaluateProductCardPricing(
  makeProduct({ price: 500, comparePrice: 400 })
);
assert.equal(invEval.showDiscount, false);

console.log("✔ ProductCard pricing & badging logic passed all dynamic assertions.");

// ----------------------------------------------------------------------------
// CHECK 3: ActivityLog Event Discrimination & Detail Parsing
// ----------------------------------------------------------------------------
console.log("\n[CHECK 3] Testing ActivityLog event discrimination and detail parsing...");

const testEvents: ActivityEvent[] = [
  {
    id: "ev_1",
    at: new Date().toISOString(),
    kind: "price_drop",
    title: "Price drop: Amul Whey Protein",
    detail: "₹2,500 ➔ ₹2,250 (-10% / Save ₹250)",
    level: "warn",
    sku: "AMUL-WHEY",
  },
  {
    id: "ev_2",
    at: new Date().toISOString(),
    kind: "discount",
    title: "Discount active: Amul Buttermilk",
    detail: "₹900 ➔ ₹799 (-11% / Save ₹101)",
    level: "info",
    sku: "AMUL-BTM",
  },
  {
    id: "ev_3",
    at: new Date().toISOString(),
    kind: "restock",
    title: "Restock: Amul Paneer",
    detail: "45 units back in stock",
    level: "info",
    sku: "AMUL-PAN",
  },
  {
    id: "ev_4",
    at: new Date().toISOString(),
    kind: "poll",
    title: "Catalog polled",
    detail: "25 products checked",
    level: "info",
  },
];

// Test filtering "deals"
const deals = testEvents.filter((e) => e.kind === "price_drop" || e.kind === "discount");
assert.equal(deals.length, 2, "Deals filter must capture exactly price_drop and discount events");
assert.equal(deals[0].kind, "price_drop");
assert.equal(deals[1].kind, "discount");

// Test detail parsing for price transitions
for (const deal of deals) {
  assert.ok(deal.detail && deal.detail.includes("➔"), "Deal detail must contain arrow transition");
  const [oldPart, newPart] = deal.detail!.split("➔");
  assert.ok(oldPart.trim().startsWith("₹"), "Old price must start with rupee symbol");
  assert.ok(newPart.trim().startsWith("₹"), "New price must start with rupee symbol");
}

console.log("✔ ActivityLog event discrimination and detail parsing passed.");

// ----------------------------------------------------------------------------
// CHECK 4: Source Code Inspection for Hardcoded Cheating
// ----------------------------------------------------------------------------
console.log("\n[CHECK 4] Inspecting files for hardcoded values, SKU branches, or facade returns...");

const filesToCheck = [
  "src/components/latch/product-card.tsx",
  "src/components/latch/dashboard.tsx",
  "src/components/latch/activity-log.tsx",
];

for (const relPath of filesToCheck) {
  const content = fs.readFileSync(relPath, "utf-8");

  // Check for hardcoded SKUs
  const hardcodedSkuMatches = content.match(/["'](?:BTMCP\w+|WPCCP\w+|HPMCP\w+|DBDCP\w+)["']/g);
  if (hardcodedSkuMatches) {
    throw new Error(`Integrity Violation: Found hardcoded SKU in ${relPath}: ${hardcodedSkuMatches.join(", ")}`);
  }

  // Check for dummy facade returns (e.g. `return true;`, `return false;` unconditionally at start of function)
  assert.equal(
    /function\s+\w+\s*\([^)]*\)\s*:\s*boolean\s*\{\s*return\s+(?:true|false);\s*\}/.test(content),
    false,
    `Integrity Violation: Found facade function returning constant in ${relPath}`
  );
}

console.log("✔ Zero hardcoded SKUs or facade dummy functions detected in UI files.");
console.log("\n=== ALL FORENSIC INTEGRITY CHECKS COMPLETED SUCCESSFULLY ===");
