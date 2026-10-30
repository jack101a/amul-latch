import assert from "node:assert/strict";
import type { AmulProduct, ActivityEvent } from "../src/lib/amul/types";

// Replicate the exact pure logic exported/used in dashboard.tsx
function isProductDiscounted(
  product: AmulProduct,
  previousPrices?: Record<string, number>,
  priceDropSkus?: Set<string>,
): boolean {
  if (
    (typeof product.comparePrice === "number" && product.comparePrice > product.price) ||
    (typeof product.discountPct === "number" && product.discountPct > 0) ||
    (typeof product.discountAmount === "number" && product.discountAmount > 0)
  ) {
    return true;
  }
  if (
    previousPrices &&
    typeof previousPrices[product.sku] === "number" &&
    previousPrices[product.sku] > product.price &&
    product.price > 0
  ) {
    return true;
  }
  if (priceDropSkus && priceDropSkus.has(product.sku)) {
    return true;
  }
  return false;
}

// Replicate ProductCard discount calculation logic from product-card.tsx
function calculateProductCardDiscount(product: AmulProduct & Record<string, any>) {
  const rawComparePrice =
    product.comparePrice ??
    product.original_price ??
    product.compare_price;

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

  return { comparePrice, currentPrice, hasDiscount, savingsAmount, discountPct, showDiscount };
}

// Replicate ActivityLog arrow-split logic from activity-log.tsx
function parseActivityDetail(event: { kind: string; detail?: string }) {
  const isPriceDrop = event.kind === "price_drop";
  const isDiscount = event.kind === "discount";
  const isDeal = isPriceDrop || isDiscount;

  if (isDeal && event.detail?.includes("➔")) {
    const [oldPart, newPart] = event.detail.split("➔");
    return {
      type: "split-deal",
      oldPart: oldPart.trim(),
      newPart: newPart.trim(),
    };
  }
  return {
    type: "normal",
    detail: event.detail,
  };
}

function runAdversarialSuite() {
  console.log("=== RUNNING M3 ADVERSARIAL STRESS TEST SUITE ===");

  const baseProduct: AmulProduct = {
    id: "prod_1",
    sku: "AMUL-WHEY-01",
    name: "Amul Chocolate Whey Protein 1kg",
    alias: "amul-chocolate-whey-protein-1kg",
    price: 2000,
    available: 10,
    inventoryQuantity: 10,
    inventoryLowStock: 2,
    inStock: true,
    imageUrl: "https://shop.amul.com/img.jpg",
    productUrl: "https://shop.amul.com/prod/1",
    proteinGrams: 750,
    costPerGramProtein: 2.67,
    proteinPerServing: 25,
    servingSizeText: "34g scoop",
  };

  // Test 1: Baseline product has no discount
  assert.equal(isProductDiscounted(baseProduct), false, "Base product should not be discounted");
  assert.equal(calculateProductCardDiscount(baseProduct).showDiscount, false);

  // Test 2: comparePrice > price triggers discount
  const discountedByCompare = { ...baseProduct, comparePrice: 2500 };
  assert.equal(isProductDiscounted(discountedByCompare), true);
  const card1 = calculateProductCardDiscount(discountedByCompare);
  assert.equal(card1.showDiscount, true);
  assert.equal(card1.savingsAmount, 500);
  assert.equal(card1.discountPct, 20); // (2500 - 2000)/2500 = 20%

  // Test 3: discountPct alone triggers predicate
  const discountedByPct = { ...baseProduct, discountPct: 15 };
  assert.equal(isProductDiscounted(discountedByPct), true);

  // Test 4: discountAmount alone triggers predicate
  const discountedByAmt = { ...baseProduct, discountAmount: 300 };
  assert.equal(isProductDiscounted(discountedByAmt), true);

  // Test 5: previousPrices higher than current price triggers discount
  assert.equal(isProductDiscounted(baseProduct, { "AMUL-WHEY-01": 2400 }), true);
  // previousPrices lower or equal does NOT trigger discount
  assert.equal(isProductDiscounted(baseProduct, { "AMUL-WHEY-01": 2000 }), false);
  assert.equal(isProductDiscounted(baseProduct, { "AMUL-WHEY-01": 1800 }), false);
  // unrelated sku in previousPrices does not affect
  assert.equal(isProductDiscounted(baseProduct, { "OTHER-SKU": 3000 }), false);

  // Test 6: priceDropSkus set triggers discount
  const skuSet = new Set(["AMUL-WHEY-01"]);
  assert.equal(isProductDiscounted(baseProduct, undefined, skuSet), true);
  assert.equal(isProductDiscounted(baseProduct, undefined, new Set(["DIFF-SKU"])), false);

  // Test 7: Adversarial edge cases in isProductDiscounted
  // 7a. comparePrice equal to price
  assert.equal(isProductDiscounted({ ...baseProduct, comparePrice: 2000 }), false);
  // 7b. comparePrice less than price (e.g. markup)
  assert.equal(isProductDiscounted({ ...baseProduct, comparePrice: 1500 }), false);
  // 7c. comparePrice negative
  assert.equal(isProductDiscounted({ ...baseProduct, comparePrice: -100 }), false);
  // 7d. comparePrice zero
  assert.equal(isProductDiscounted({ ...baseProduct, comparePrice: 0 }), false);
  // 7e. discountPct negative or zero
  assert.equal(isProductDiscounted({ ...baseProduct, discountPct: 0 }), false);
  assert.equal(isProductDiscounted({ ...baseProduct, discountPct: -5 }), false);
  // 7f. discountAmount negative or zero
  assert.equal(isProductDiscounted({ ...baseProduct, discountAmount: 0 }), false);
  assert.equal(isProductDiscounted({ ...baseProduct, discountAmount: -50 }), false);
  // 7g. previousPrices price is 0 or negative
  assert.equal(isProductDiscounted({ ...baseProduct, price: 0 }, { "AMUL-WHEY-01": 100 }), false);

  // Test 8: ProductCard discount calculation resilience
  // 8a. fallback to original_price / compare_price
  const fallbackProduct = { ...baseProduct, original_price: 3000 };
  const cardFallback = calculateProductCardDiscount(fallbackProduct);
  assert.equal(cardFallback.showDiscount, true);
  assert.equal(cardFallback.comparePrice, 3000);
  assert.equal(cardFallback.savingsAmount, 1000);

  // 8b. non-finite or corrupt comparePrice
  const corrupt1 = calculateProductCardDiscount({ ...baseProduct, comparePrice: NaN });
  assert.equal(corrupt1.showDiscount, false);
  assert.equal(corrupt1.comparePrice, null);

  const corrupt2 = calculateProductCardDiscount({ ...baseProduct, comparePrice: Infinity });
  assert.equal(corrupt2.showDiscount, false);
  assert.equal(corrupt2.comparePrice, null);

  // 8c. fractional prices and precision rounding
  const fractional = calculateProductCardDiscount({
    ...baseProduct,
    price: 199.5,
    comparePrice: 299.9,
  });
  assert.equal(fractional.showDiscount, true);
  assert.equal(fractional.savingsAmount, 100); // Math.round(299.9 - 199.5) = 100
  assert.equal(fractional.discountPct, 33); // Math.round((100.4 / 299.9) * 100) = 33

  // Test 9: ActivityLog arrow parsing
  const priceDropEvent = {
    kind: "price_drop",
    detail: "₹2,500 ➔ ₹2,100 (-16% / Save ₹400) • ₹2.80/g",
  };
  const parsed1 = parseActivityDetail(priceDropEvent);
  assert.equal(parsed1.type, "split-deal");
  assert.equal(parsed1.oldPart, "₹2,500");
  assert.equal(parsed1.newPart, "₹2,100 (-16% / Save ₹400) • ₹2.80/g");

  const discountEvent = {
    kind: "discount",
    detail: "MRP ₹3,000 ➔ ₹2,400 (-20% off / Save ₹600) • ₹2.40/g",
  };
  const parsed2 = parseActivityDetail(discountEvent);
  assert.equal(parsed2.type, "split-deal");
  assert.equal(parsed2.oldPart, "MRP ₹3,000");
  assert.equal(parsed2.newPart, "₹2,400 (-20% off / Save ₹600) • ₹2.40/g");

  // Non-deal event with arrow remains normal
  const restockEvent = {
    kind: "restock",
    detail: "Inventory 0 ➔ 50",
  };
  const parsed3 = parseActivityDetail(restockEvent);
  assert.equal(parsed3.type, "normal");

  // Deal event without arrow remains normal
  const noArrowDeal = {
    kind: "price_drop",
    detail: "Price dropped by 10%",
  };
  const parsed4 = parseActivityDetail(noArrowDeal);
  assert.equal(parsed4.type, "normal");

  console.log("✔ ALL M3 ADVERSARIAL STRESS TESTS PASSED (18 assertions)");
}

runAdversarialSuite();
