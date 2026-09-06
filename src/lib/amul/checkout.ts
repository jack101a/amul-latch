import { AmulClient, AmulError } from "./client";
import type { CheckoutAttempt, TrackedProduct } from "./types";
import { AMUL_ORIGIN } from "./types";

function newAttempt(product: TrackedProduct): CheckoutAttempt {
  return {
    sku: product.sku,
    name: product.name,
    startedAt: new Date().toISOString(),
    status: "running",
    message: "Starting checkout",
    shopUrl: product.alias ? `${AMUL_ORIGIN}/en/product/${product.alias}` : AMUL_ORIGIN,
  };
}

export async function runCheckout(input: {
  client: AmulClient;
  product: TrackedProduct;
}): Promise<CheckoutAttempt> {
  const attempt = newAttempt(input.product);
  const checkoutUrl = `${AMUL_ORIGIN}/en/checkout`;
  const productUrl = attempt.shopUrl ?? checkoutUrl;

  if (input.client.isDemoSession || input.client.userId.includes("demo")) {
    attempt.cartId = "demo_cart_8831";
    attempt.status = "awaiting_payment";
    attempt.paymentUrl = `${AMUL_ORIGIN}/en/checkout?demo=1`;
    attempt.shopUrl = attempt.paymentUrl;
    attempt.message =
      "Demo order placed. Waiting on payment approval in your UPI / bank app.";
    return attempt;
  }

  try {
    attempt.message = "Opening cart";
    const cart = await input.client.createCart();
    const cartId = String(cart._id ?? "");
    if (!cartId) throw new AmulError("Amul did not return a cart id");
    attempt.cartId = cartId;

    attempt.message = `Adding ${input.product.quantity} × ${input.product.sku}`;
    let added: Record<string, unknown> = cart;
    try {
      if (input.client.substore && input.product.sku) {
        // Re-bind pincode right before add — Amul carts are substore-scoped.
        await input.client.setPincode(input.client.substore.pincode).catch(() => undefined);
      }
      added = await input.client.addItem({
        cartId,
        productId: input.product.productId,
        sku: input.product.sku,
        quantity: input.product.quantity,
        sellerId: input.product.sellerId,
      });
      attempt.message = cartMessage(added) || "Item added to cart";
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not add to cart";
      const code = err instanceof AmulError ? err.code : undefined;
      attempt.shopUrl = productUrl;
      if (!input.client.loggedIn) {
        attempt.status = "blocked";
        attempt.message =
          code === "ms.msg.item_unavailable"
            ? "Amul refused the cart add from this session (SKU hold or guest limit). Import a logged-in jsessionid from shop.amul.com for this pincode, or finish on the product page. Latch never asks for OTP, UPI PIN, or CVV."
            : "Cart add needs a logged-in Amul shop session. Sign in on shop.amul.com, paste jsessionid, then retry. Latch never asks for OTP, UPI PIN, or CVV.";
        return attempt;
      }
      attempt.status = "failed";
      attempt.message = message;
      return attempt;
    }

    if (!input.client.loggedIn) {
      attempt.status = "blocked";
      attempt.shopUrl = checkoutUrl;
      attempt.message =
        "SKU is in the guest cart, but Amul still needs your shop login to ship and charge. Import jsessionid from shop.amul.com after you log in there — Latch never asks for OTP, UPI PIN, or CVV.";
      return attempt;
    }

    attempt.message = "Attaching saved address";
    try {
      const addresses = await input.client.listAddresses();
      const chosen = addresses[0] || input.client.fallbackAddress;
      if (!chosen) {
        attempt.status = "blocked";
        attempt.shopUrl = checkoutUrl;
        attempt.message =
          "No saved delivery address on this Amul account. Add one on shop.amul.com, then retry. Latch does not collect addresses itself.";
        return attempt;
      }
      await input.client.updateAddresses(cartId, chosen.raw);
      attempt.message = `Address set · ${chosen.label}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Address failed";
      if (needsLogin(message)) {
        attempt.status = "blocked";
        attempt.shopUrl = checkoutUrl;
        attempt.message =
          "Amul requires a logged-in shop session before address and payment. Import jsessionid. Latch does not collect login OTP.";
        return attempt;
      }
      attempt.status = "blocked";
      attempt.shopUrl = checkoutUrl;
      attempt.message = `Paused at address: ${message}. Finish on Amul checkout if the cart already holds the SKU.`;
      return attempt;
    }

    const methods = [
      ...asArray(added.available_payment_methods),
      ...(await input.client.getPaymentMethods(cartId).catch(() => [])),
    ];
    const preferred = pickPaymentMethod(methods);
    if (preferred) {
      attempt.message = `Selecting ${String(preferred.name ?? preferred.type ?? "payment")}`;
      try {
        await input.client.updatePaymentMethod(cartId, preferred);
      } catch {
        // Payment method selection can require extra user state; continue to placeOrder.
      }
    }

    attempt.message = "Placing order — payment approval stays with you";
    const placed = await input.client.placeOrder(cartId);
    const paymentUrl = findPaymentUrl(placed);
    const gateway = asRecord(placed.gatewayInfo) ?? asRecord(placed.gateway_info);
    const txn = gateway?.txn_id ?? placed.txn_id ?? placed.order;
    const orderOk = Boolean(txn || paymentUrl || placed.status === "success");

    if (paymentUrl) {
      attempt.status = "awaiting_payment";
      attempt.paymentUrl = paymentUrl;
      attempt.shopUrl = paymentUrl;
      attempt.message =
        "Order is waiting on legitimate payment approval. Open the payment link and confirm in your UPI / bank app. Latch will not collect PIN, OTP, or CVV.";
      return attempt;
    }

    if (orderOk) {
      attempt.status = "success";
      attempt.message = "Amul accepted the order.";
      return attempt;
    }

    const msg = cartMessage(placed);
    if (needsLogin(msg)) {
      attempt.status = "blocked";
      attempt.shopUrl = checkoutUrl;
      attempt.message =
        "Amul requires a logged-in shop session before payment. Import your jsessionid. Latch does not collect login OTP.";
      return attempt;
    }

    attempt.status = "awaiting_payment";
    attempt.shopUrl = checkoutUrl;
    attempt.message =
      msg ||
      "Checkout reached payment. Approve it on Amul / your UPI app — Latch stops here on purpose.";
    return attempt;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Checkout failed";
    if (needsLogin(message)) {
      attempt.status = "blocked";
      attempt.shopUrl = `${AMUL_ORIGIN}/en/checkout`;
      attempt.message =
        "Amul requires your shop login to finish checkout. Import a session cookie from shop.amul.com. Latch never handles OTP or UPI PIN.";
      return attempt;
    }
    attempt.status = "failed";
    attempt.message = message;
    return attempt;
  }
}

function pickPaymentMethod(methods: unknown[]): Record<string, unknown> | null {
  const rows = methods.filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object");
  if (!rows.length) return null;
  const score = (m: Record<string, unknown>) => {
    const blob = `${m.name ?? ""} ${m.type ?? ""} ${m.method ?? ""}`.toLowerCase();
    if (blob.includes("upi") || blob.includes("phonepe") || blob.includes("phone pe")) return 4;
    if (blob.includes("wallet")) return 2;
    if (blob.includes("netbanking") || blob.includes("card")) return 1;
    return 0;
  };
  return [...rows].sort((a, b) => score(b) - score(a))[0] ?? null;
}

function findPaymentUrl(payload: Record<string, unknown>): string | undefined {
  const stack: unknown[] = [payload];
  const keys = ["paymentUrl", "payment_url", "redirect_url", "redirectUrl", "url", "short_url"];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      stack.push(...cur);
      continue;
    }
    const rec = cur as Record<string, unknown>;
    for (const key of keys) {
      const val = rec[key];
      if (typeof val === "string" && /^https?:\/\//.test(val) && !val.includes("shop.amul.com/en/product")) {
        return val;
      }
    }
    for (const val of Object.values(rec)) {
      if (val && typeof val === "object") stack.push(val);
    }
  }
  return undefined;
}

function cartMessage(payload: Record<string, unknown>): string {
  if (typeof payload.message === "string") return payload.message;
  const err = payload.err as { message?: string } | undefined;
  if (err?.message) return err.message;
  return "";
}

function needsLogin(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("login") ||
    m.includes("logged in") ||
    m.includes("unauthorized") ||
    m.includes("not authenticated") ||
    m.includes("permission") ||
    m.includes("otp")
  );
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
