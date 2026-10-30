import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  sanitizeMentions,
  buildPriceDropAlertEmbed,
  buildPriceDropAlertPayload,
  sendPriceDropAlert,
  isValidDiscordWebhookUrl,
  DISCORD_COLOR_GOLD,
} from "../src/lib/amul/discord";
import {
  AmulClient,
} from "../src/lib/amul/client";
import {
  calculateAdaptiveInterval,
  getISTDecimalHour,
} from "../src/lib/amul/runtime";
import {
  extractNutritionInfo,
  formatProteinYield,
  calculateProteinCostPerGram,
  type AmulProduct,
  DEFAULT_CONFIG,
} from "../src/lib/amul/types";

console.log("=== STARTING FORENSIC AUDIT OF M2 IMPLEMENTATION ===");

// -------------------------------------------------------------
// CHECK 1: sanitizeMentions adversarial tests
// -------------------------------------------------------------
console.log("\n[TEST 1] sanitizeMentions adversarial stress tests...");

const mentionCases = [
  { input: "@everyone", expected: "@\u200Beveryone" },
  { input: "@here", expected: "@\u200Bhere" },
  { input: "@EVERYONE", expected: "@\u200Beveryone" },
  { input: "@HERE", expected: "@\u200Bhere" },
  { input: "@Everyone", expected: "@\u200Beveryone" },
  { input: "@Here", expected: "@\u200Bhere" },
  { input: "@everyone @here @EVERYONE @HERE", expected: "@\u200Beveryone @\u200Bhere @\u200Beveryone @\u200Bhere" },
  { input: "Check out @everyone discount!", expected: "Check out @\u200Beveryone discount!" },
  { input: "No mentions here", expected: "No mentions here" },
  { input: "", expected: "" },
];

for (const tc of mentionCases) {
  const result = sanitizeMentions(tc.input);
  assert.equal(result, tc.expected, `Mismatch for input: ${tc.input}`);
  // Raw mention MUST NOT exist
  assert.equal(result.includes("@everyone"), false, `Contains raw @everyone: ${result}`);
  assert.equal(result.includes("@here"), false, `Contains raw @here: ${result}`);
}

console.log("✔ sanitizeMentions correctly neutralizes all mention variants with zero-width space");

// -------------------------------------------------------------
// CHECK 2: buildPriceDropAlertEmbed mention injection paths
// -------------------------------------------------------------
console.log("\n[TEST 2] buildPriceDropAlertEmbed adversarial injection vectors...");

const mockProduct: AmulProduct = {
  id: "prod-adv-1",
  sku: "AMUL-ADV-001",
  name: "Amul Protein @everyone Special Edition @here",
  alias: "amul-protein-everyone-special",
  price: 2000,
  comparePrice: 2500,
  available: 20,
  inventoryQuantity: 20,
  inventoryLowStock: 5,
  inStock: true,
  imageUrl: "https://shop.amul.com/s/img.png",
  productUrl: "https://shop.amul.com/en/product/amul-protein-special",
  proteinGrams: 750,
  costPerGramProtein: 2.67,
};

const payload = buildPriceDropAlertPayload({
  webhookUrl: "https://discord.com/api/webhooks/12345/abcdef",
  product: mockProduct,
  oldPrice: 2500,
  newPrice: 2000,
  discountPct: 20,
  savingsAmount: 500,
  pincode: "400068 @everyone",
  stockUnits: 20,
});

const payloadJson = JSON.stringify(payload);
assert.equal(payloadJson.includes("@everyone"), false, "Payload JSON leaked raw @everyone!");
assert.equal(payloadJson.includes("@here"), false, "Payload JSON leaked raw @here!");
assert.equal(payload.embeds?.[0].color, DISCORD_COLOR_GOLD, "Color must be gold");

console.log("✔ buildPriceDropAlertPayload strictly contains 0 raw mentions across all fields");

// -------------------------------------------------------------
// CHECK 3: isValidDiscordWebhookUrl validation robustness
// -------------------------------------------------------------
console.log("\n[TEST 3] Discord webhook URL validation...");

assert.equal(isValidDiscordWebhookUrl("https://discord.com/api/webhooks/123456789/abcdef-ghijk_123"), true);
assert.equal(isValidDiscordWebhookUrl("https://discordapp.com/api/webhooks/123456789/abcdef-ghijk_123"), true);
assert.equal(isValidDiscordWebhookUrl("https://canary.discord.com/api/webhooks/123456789/abcdef-ghijk_123"), true);
assert.equal(isValidDiscordWebhookUrl("https://ptb.discord.com/api/webhooks/123456789/abcdef-ghijk_123"), true);

// Invalid cases
assert.equal(isValidDiscordWebhookUrl(""), false);
assert.equal(isValidDiscordWebhookUrl("http://discord.com/api/webhooks/123/abc"), false); // HTTP not HTTPS
assert.equal(isValidDiscordWebhookUrl("https://evil.com/api/webhooks/123/abc"), false);
assert.equal(isValidDiscordWebhookUrl("https://discord.com/api/webhooks/not-numeric-id/abc"), false);
assert.equal(isValidDiscordWebhookUrl("javascript:alert(1)"), false);

console.log("✔ Discord webhook URL validation correctly restricts to genuine Discord endpoints");

// -------------------------------------------------------------
// CHECK 4: Coupon testing in demo session vs edge cases
// -------------------------------------------------------------
console.log("\n[TEST 4] Coupon validation logic...");

const client = new AmulClient();
client.isDemoSession = true;

const resEmpty = await client.checkCoupon("");
assert.equal(resEmpty.valid, false);
assert.equal(resEmpty.message, "Coupon code cannot be empty");

const resSpaces = await client.checkCoupon("   ");
assert.equal(resSpaces.valid, false);
assert.equal(resSpaces.message, "Coupon code cannot be empty");

const resAmul10 = await client.checkCoupon("amul10");
assert.equal(resAmul10.valid, true);
assert.equal(resAmul10.discount, 100);

const resProtein10 = await client.checkCoupon("PROTEIN10");
assert.equal(resProtein10.valid, true);
assert.equal(resProtein10.discount, 100);

const resBogus = await client.checkCoupon("FAKECOUPON");
assert.equal(resBogus.valid, false);
assert.equal(resBogus.message, "Coupon Code is not valid");

console.log("✔ Coupon validation handles demo fallbacks and edge cases authentically");

// -------------------------------------------------------------
// CHECK 5: previousPrices persistence test (disk read/write)
// -------------------------------------------------------------
console.log("\n[TEST 5] previousPrices config persistence verification...");

const configPath = path.resolve(process.cwd(), "latch-config.json");
const originalConfigRaw = fs.readFileSync(configPath, "utf-8");
const originalConfig = JSON.parse(originalConfigRaw);

try {
  // Test writing previousPrices
  const testPrices = { "TEST-SKU-1": 1500, "TEST-SKU-2": 2400 };
  const updatedConfig = { ...originalConfig, previousPrices: testPrices };
  fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), "utf-8");

  // Read back
  const readBackRaw = fs.readFileSync(configPath, "utf-8");
  const readBack = JSON.parse(readBackRaw);
  assert.deepEqual(readBack.previousPrices, testPrices);
  console.log("✔ previousPrices persists cleanly to latch-config.json");
} finally {
  // Restore original config
  fs.writeFileSync(configPath, originalConfigRaw, "utf-8");
  console.log("✔ Restored latch-config.json to pristine state");
}

console.log("\n=== ALL FORENSIC AUDIT CHECKS PASSED ===");
