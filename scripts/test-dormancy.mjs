import test from "node:test";
import assert from "node:assert/strict";

// Test our dormancy logic contracts
test("Dormancy logic: empty watchlist produces idle phase", () => {
  const derivePhase = (watching, error, reachable, products) => {
    if (!watching) return error ? "error" : "idle";
    if (error && !reachable) return "error";
    if (!products || !products.length) return "idle";
    return "watching";
  };

  assert.equal(derivePhase(true, null, true, []), "idle");
  assert.equal(derivePhase(true, null, true, [{ sku: "123" }]), "watching");
  assert.equal(derivePhase(false, null, true, []), "idle");
});

test("Smart polling cadence: idle intervals vs active intervals", () => {
  const calculateInterval = (watching, productCount) => {
    const isActivelyWatching = watching && productCount > 0;
    return isActivelyWatching ? 3000 : 12000;
  };

  assert.equal(calculateInterval(true, 0), 12000);
  assert.equal(calculateInterval(false, 0), 12000);
  assert.equal(calculateInterval(true, 2), 3000);
});
