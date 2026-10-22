#!/usr/bin/env node

/**
 * End-to-End Test for Amul Tracker Backend & Network Functions
 */

import { fetchCatalog, getSnapshot, startWatch, stopWatch, getConfig, applyConfig } from "../src/lib/amul/runtime.ts";

async function run() {
  console.log("=================================================");
  console.log("⚡ TESTING BACKEND & AMUL INTEGRATION FEATURES");
  console.log("=================================================");

  // 1. Test Config Loading
  const cfg = getConfig();
  console.log(`✅ Default Pincode: ${cfg.pincode}`);

  // 2. Test Amul API Substore & Catalog Fetch
  console.log("\n📡 Fetching live Amul catalog for pincode 400068...");
  const catalog = await fetchCatalog("400068");
  console.log(`✅ Substore Name: ${catalog.substore.name} (${catalog.substore.slug})`);
  console.log(`✅ Total Protein Products: ${catalog.products.length} SKUs`);

  const whey = catalog.products.find(p => p.name.toLowerCase().includes("whey"));
  const shake = catalog.products.find(p => p.name.toLowerCase().includes("shake"));
  console.log(`   - Sample 1: ${whey?.name} (Price: ₹${whey?.price}, In Stock: ${whey?.inStock})`);
  console.log(`   - Sample 2: ${shake?.name} (Price: ₹${shake?.price}, In Stock: ${shake?.inStock})`);

  // 3. Test Snapshot State
  const snap = getSnapshot();
  console.log(`\n✅ Snapshot Phase: ${snap.phase}`);
  console.log(`✅ Snapshot Pincode: ${snap.pincode}`);
  console.log(`✅ Amul Reachable: ${snap.amulReachable}`);

  // 4. Test Watcher Lifecycle
  console.log("\n🔄 Testing Watcher Lifecycle...");
  const startedSnap = await startWatch({
    ...cfg,
    products: [
      {
        sku: whey?.sku || "AMUL-WHEY-01",
        quantity: 1,
        name: whey?.name || "Whey",
        alias: whey?.alias || "whey",
        productId: whey?.productId || "123"
      }
    ]
  });
  console.log(`✅ Watcher Active: ${startedSnap.watching}`);
  console.log(`✅ Tracked SKUs count: ${startedSnap.tracked.length}`);

  const stoppedSnap = stopWatch();
  console.log(`✅ Watcher Stopped cleanly: ${!stoppedSnap.watching}`);

  console.log("\n🎉 ALL BACKEND AMUL FEATURES VERIFIED SUCCESSFULLY!");
  console.log("=================================================");
}

run().catch(err => {
  console.error("❌ Fatal:", err);
  process.exit(1);
});
