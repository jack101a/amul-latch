import { AmulClient } from "../src/lib/amul/client.ts";

async function verifyLive() {
  console.log("=== EXECUTING LIVE AMUL STOREHIPPO API VERIFICATION ===");
  const client = new AmulClient();
  
  console.log("1. Initializing session with shop.amul.com...");
  await client.init();
  console.log(`   Session initialized. Session ready: ${client.hasSession()}`);

  const testPincodes = ["400068", "560001", "110001"];

  for (const pin of testPincodes) {
    console.log(`\n2. Testing pincode: ${pin}`);
    const substore = await client.setPincode(pin);
    console.log(`   Substore resolved: ${substore.name} (slug: ${substore.slug}, id: ${substore.id})`);

    console.log(`3. Fetching live protein products from StoreHippo entity/ms.products...`);
    const products = await client.listProteinProducts();
    console.log(`   Received ${products.length} products for pincode ${pin}.`);

    if (products.length === 0) {
      console.warn(`   [WARN] 0 products returned for pincode ${pin}. Checking if catalog empty or session issue.`);
      continue;
    }

    let nanCount = 0;
    let nullProteinCount = 0;
    let validProteinCount = 0;

    console.log(`\n   --- Detailed Product Audit (${pin}) ---`);
    for (const p of products) {
      console.log(`   * [${p.sku}] ${p.name}`);
      console.log(`     Price: ₹${p.price} | ComparePrice: ${p.comparePrice ?? "none"} | Discount: ${p.discountPct ? p.discountPct + "%" : "none"} | InStock: ${p.inStock}`);
      console.log(`     Protein: ${p.proteinGrams}g | PerServing: ${p.proteinPerServing}g | ServingSize: "${p.servingSizeText}" | ₹/g: ₹${p.costPerGramProtein}`);
      // Check for NaNs
      const numFields = [
        ["price", p.price],
        ["comparePrice", p.comparePrice],
        ["discountAmount", p.discountAmount],
        ["discountPct", p.discountPct],
        ["available", p.available],
        ["inventoryQuantity", p.inventoryQuantity],
        ["proteinGrams", p.proteinGrams],
        ["costPerGramProtein", p.costPerGramProtein],
        ["proteinPerServing", p.proteinPerServing],
      ] as const;

      for (const [name, val] of numFields) {
        if (typeof val === "number" && Number.isNaN(val)) {
          console.error(`   [FAIL - NaN] Product ${p.sku} (${p.name}) has NaN for field ${name}`);
          nanCount++;
        }
      }

      // Check protein calculation
      if (p.proteinGrams === null) {
        console.warn(`   [WARN - Null Protein] Product: ${p.sku} | Name: "${p.name}" | Alias: "${p.alias}"`);
        nullProteinCount++;
      } else {
        validProteinCount++;
        if (p.costPerGramProtein === null && p.price > 0 && p.proteinGrams > 0) {
          console.error(`   [FAIL - Missing Cost/Gram] Product: ${p.sku} | Name: "${p.name}" | Price: ${p.price} | Protein: ${p.proteinGrams} | CostPerGram: null`);
          nanCount++;
        }
      }

      // Check discount calculations consistency
      if (p.comparePrice !== null && p.comparePrice !== undefined) {
        if (p.comparePrice <= p.price) {
          console.error(`   [FAIL - Inverted Compare Price] Product: ${p.sku} | Price: ${p.price} | ComparePrice: ${p.comparePrice}`);
          nanCount++;
        }
        if (!p.discountAmount || p.discountAmount <= 0) {
          console.error(`   [FAIL - Invalid Discount Amount] Product: ${p.sku} | Compare: ${p.comparePrice} | Price: ${p.price} | Amount: ${p.discountAmount}`);
          nanCount++;
        }
        if (!p.discountPct || p.discountPct <= 0) {
          console.error(`   [FAIL - Invalid Discount Pct] Product: ${p.sku} | Pct: ${p.discountPct}`);
          nanCount++;
        }
      }
    }

    console.log(`   Validation Report for pincode ${pin}:`);
    console.log(`     Total products audited: ${products.length}`);
    console.log(`     Valid protein products calculated: ${validProteinCount}`);
    console.log(`     Null protein products: ${nullProteinCount}`);
    console.log(`     NaN occurrences: ${nanCount}`);

    if (nanCount > 0) {
      throw new Error(`Encountered ${nanCount} NaN / invalid calculation errors for pincode ${pin}`);
    }
    if (nullProteinCount > 0) {
      console.warn(`     Note: Investigate if any of the ${nullProteinCount} null items are protein products.`);
    }
  }

  console.log("\n=== LIVE STOREHIPPO API VERIFICATION COMPLETED SUCCESSFULLY ===");
}

verifyLive().catch((err) => {
  console.error("Live verification failed:", err);
  process.exit(1);
});
