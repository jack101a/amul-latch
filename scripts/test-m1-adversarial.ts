import {
  extractNutritionInfo,
  extractProteinGrams,
  extractPackMultiplier,
  calculateProteinCostPerGram,
  formatProteinYield,
} from "../src/lib/amul/types.ts";
import { AmulClient, mapProduct } from "../src/lib/amul/client.ts";

console.log("=== STARTING ADVERSARIAL STRESS HARNESS ===");

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${msg}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${msg}`);
  }
}

// ==========================================
// Test Suite 1: Malformed / Corrupt HTML
// ==========================================
console.log("\n--- Suite 1: Malformed & Corrupt HTML Metafields ---");

try {
  // Unclosed tags
  const res1 = extractNutritionInfo(
    "Amul High Protein Milk, 250 mL | Pack of 8",
    "amul-high-protein-milk",
    { benefits: "<p>35g Protein per pack <div><span>Unclosed tags galore" },
    "<div class='desc'>World's highest protein milk",
  );
  assert(res1.proteinGrams === 280, `Unclosed HTML tags: got ${res1.proteinGrams}, expected 280`);

  // Heavily nested spans & attributes
  const res2 = extractNutritionInfo(
    "Amul High Protein Cubes 190 g | Pack of 5",
    "amul-high-protein-cubes",
    { benefits: "<div id='main'><span class='a'><span class='b'><span style='color:red;'>25g Protein per 38g serving</span></span></span></div>" },
    "",
  );
  assert(res2.proteinGrams === 625, `Heavily nested spans: got ${res2.proteinGrams}, expected 625`);

  // Mixed HTML entities (&nbsp;, &ndash;, &rsquo;, &quot;, &#39;, &amp;)
  const res3 = extractNutritionInfo(
    "Amul High Protein Wheat Flour, 65 g | Pack of 30 Sachets",
    "amul-high-protein-wheat-flour",
    { benefits: "&nbsp;&nbsp;20g&nbsp;&ndash;&nbsp;Protein&rsquo;s&nbsp;per&nbsp;65g&nbsp;pack&nbsp;&quot;No Maida&quot;&amp;delicious" },
    "Delivering &nbsp; 20g &ndash; protein",
  );
  assert(res3.proteinGrams === 600, `Mixed HTML entities: got ${res3.proteinGrams}, expected 600`);

  // Null, undefined, empty, missing fields in metafields and description
  const res4 = extractNutritionInfo(
    "Amul High Protein Milk, 250 mL | Pack of 8",
    "amul-milk",
    null,
    null,
  );
  assert(res4.proteinGrams === 280, `Null metafields and null description: got ${res4.proteinGrams}, expected 280`);

  const res5 = extractNutritionInfo(
    "Amul High Protein Milk, 250 mL | Pack of 8",
    "amul-milk",
    {},
    "",
  );
  assert(res5.proteinGrams === 280, `Empty metafields object and empty description: got ${res5.proteinGrams}, expected 280`);

  // Metafields with unexpected properties or non-string values
  const res6 = extractNutritionInfo(
    "Amul High Protein Milk, 250 mL | Pack of 8",
    "amul-milk",
    { benefits: null, how_to_useit: undefined, random: "test" } as any,
    undefined,
  );
  assert(res6.proteinGrams === 280, `Metafields with null/undefined values: got ${res6.proteinGrams}, expected 280`);

} catch (err: any) {
  assert(false, `Suite 1 threw unexpected exception: ${err.message}`);
}

// ==========================================
// Test Suite 2: Adversarial Titles & Token Collisions
// ==========================================
console.log("\n--- Suite 2: Adversarial Titles & Token Collisions ---");

try {
  // "Amul Milk Ice Cream" (Non-protein product with 'milk' in title)
  const iceCream1 = extractNutritionInfo("Amul Milk Ice Cream");
  assert(iceCream1.proteinGrams === null, `"Amul Milk Ice Cream" should return null protein, got ${iceCream1.proteinGrams}`);

  // "Amul Protein Buttermilk with Real Milk"
  const buttermilkMilk = extractNutritionInfo("Amul Protein Buttermilk with Real Milk | Pack of 30");
  assert(buttermilkMilk.proteinGrams === 450, `"Amul Protein Buttermilk with Real Milk" should match buttermilk (15g*30=450), got ${buttermilkMilk.proteinGrams}`);

  // "Amul High Protein 0g Whey"
  const zeroWhey = extractNutritionInfo("Amul High Protein 0g Whey");
  console.log(`  [INFO] "Amul High Protein 0g Whey" returned proteinGrams: ${zeroWhey.proteinGrams}`);

  // Pure non-protein items containing milk
  const tonedMilk = extractNutritionInfo("Amul Taaza Toned Milk 1L");
  assert(tonedMilk.proteinGrams === null, `"Amul Taaza Toned Milk 1L" should return null, got ${tonedMilk.proteinGrams}`);

  const goldMilk = extractNutritionInfo("Amul Gold Full Cream Milk 500 mL");
  assert(goldMilk.proteinGrams === null, `"Amul Gold Full Cream Milk 500 mL" should return null, got ${goldMilk.proteinGrams}`);

  // "Milkshake" containing "milk"
  const shake = extractNutritionInfo("Amul Kool Protein Milkshake Chocolate 180 mL Pack of 8");
  assert(shake.proteinGrams === 80, `Milkshake should get 80g (10g*8), got ${shake.proteinGrams}`);

} catch (err: any) {
  assert(false, `Suite 2 threw unexpected exception: ${err.message}`);
}

// ==========================================
// Test Suite 3: Edge Case Pack Sizes
// ==========================================
console.log("\n--- Suite 3: Edge Case Pack Sizes ---");

try {
  // Pack of 0
  assert(extractPackMultiplier("Amul High Protein Milk | Pack of 0") === 1, "Pack of 0 should fallback to 1");

  // Pack of 999 (above 200 limit)
  assert(extractPackMultiplier("Amul High Protein Milk | Pack of 999") === 1, "Pack of 999 should fallback to 1");

  // Pack of 200 (exact boundary)
  assert(extractPackMultiplier("Amul High Protein Milk | Pack of 200") === 200, "Pack of 200 should return 200");

  // Pack of 201 (just above boundary)
  assert(extractPackMultiplier("Amul High Protein Milk | Pack of 201") === 1, "Pack of 201 should fallback to 1");

  // Fractional pack: "Pack of 1.5"
  const fracPack = extractPackMultiplier("Amul High Protein Milk | Pack of 1.5");
  console.log(`  [INFO] Pack of 1.5 returns multiplier: ${fracPack}`);

  // Undefined / empty alias
  assert(extractPackMultiplier("Amul High Protein Milk | Pack of 32", undefined) === 32, "Undefined alias should extract pack 32");

  // Empty string title and alias
  assert(extractPackMultiplier("", "") === 1, "Empty title and alias should return 1");

} catch (err: any) {
  assert(false, `Suite 3 threw unexpected exception: ${err.message}`);
}

// ==========================================
// Test Suite 4: Case Sensitivity & Punctuation Variations
// ==========================================
console.log("\n--- Suite 4: Case Sensitivity & Punctuation Variations ---");

try {
  // ALL UPPERCASE
  const upperMilk = extractNutritionInfo("AMUL HIGH PROTEIN MILK, 250 ML | PACK OF 32");
  assert(upperMilk.proteinGrams === 1120, `ALL UPPERCASE milk: got ${upperMilk.proteinGrams}, expected 1120`);

  // all lowercase
  const lowerMilk = extractNutritionInfo("amul high protein milk, 250 ml | pack of 32");
  assert(lowerMilk.proteinGrams === 1120, `all lowercase milk: got ${lowerMilk.proteinGrams}, expected 1120`);

  // Mixed case with dashes and slashes
  const mixedPunct = extractNutritionInfo("Amul-High-Protein-Milk--250mL // PACK OF 8");
  assert(mixedPunct.proteinGrams === 280, `Punctuation variation: got ${mixedPunct.proteinGrams}, expected 280`);

  // Parentheses notation: Whey Protein (32g) [Pack of 30]
  const parenPunct = extractNutritionInfo("Amul Whey Protein (32g) [Pack of 30 sachets]");
  assert(parenPunct.proteinGrams === 750, `Parentheses & brackets: got ${parenPunct.proteinGrams}, expected 750`);

} catch (err: any) {
  assert(false, `Suite 4 threw unexpected exception: ${err.message}`);
}
// ==========================================
// Test Suite 5: Vulnerability & Failure Mode Demonstrations
// ==========================================
console.log("\n--- Suite 5: Empirical Failure Mode Demonstrations ---");

// Vulnerability 1: stripHtml crash on non-string metafields
try {
  extractNutritionInfo("Amul High Protein Milk", "alias", { benefits: 1234 } as any);
  assert(false, "Vulnerability 1: Expected stripHtml to throw or safely handle non-string benefits");
} catch (err: any) {
  if (err instanceof TypeError && err.message.includes("replace is not a function")) {
    console.log("  [CONFIRMED VULNERABILITY 1] stripHtml crashes with TypeError on non-string metafield:", err.message);
  } else {
    assert(false, `Unexpected error in Vuln 1: ${err.message}`);
  }
}

// Vulnerability 2: NaN propagation on invalid row.price
{
  const p = mapProduct({
    _id: "nan_test",
    sku: "NAN1",
    name: "Amul High Protein Milk",
    alias: "milk",
    price: "invalid" as any,
  });
  if (Number.isNaN(p.price)) {
    console.log("  [CONFIRMED VULNERABILITY 2] mapProduct propagates NaN into product.price when row.price is non-numeric string ('invalid')");
  } else {
    assert(false, `Expected NaN or safe fallback, got ${p.price}`);
  }
}

// Vulnerability 3: Negative price produces distorted >100% discount
{
  const p = mapProduct({
    _id: "neg_test",
    sku: "NEG1",
    name: "Amul High Protein Milk",
    alias: "milk",
    price: -100,
    compare_price: 200,
  });
  if (p.discountPct !== null && p.discountPct > 100) {
    console.log(`  [CONFIRMED VULNERABILITY 3] Negative price produces impossible discount percentage: ${p.discountPct}% (discountAmount: ₹${p.discountAmount})`);
  } else {
    assert(false, `Expected negative price to clamp discounts to null, got ${p.discountPct}`);
  }
}

console.log(`\nLocal Adversarial Suite Summary: ${passed} passed, ${failed} failed.`);
