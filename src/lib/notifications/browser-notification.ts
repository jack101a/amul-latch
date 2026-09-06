/**
 * Browser-native Web Notification API wrapper for Latch restock alerts.
 * Enables system/OS level push banners when watched items come back in stock,
 * ensuring users receive alerts even when the tab is backgrounded.
 */

import type { AmulProduct } from "@/lib/amul/types";

export type NotificationSupport = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
};

export function checkNotificationSupport(): NotificationSupport {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return { supported: false, permission: "unsupported" };
  }
  return { supported: true, permission: Notification.permission };
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch {
    return Notification.permission;
  }
}

export function sendRestockNotification(
  products: AmulProduct[],
  options?: { onClick?: () => void; onDismiss?: () => void }
): Notification | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  if (Notification.permission !== "granted") return null;
  if (!products.length) return null;

  try {
    const isSingle = products.length === 1;
    const title = isSingle
      ? `🚨 RESTOCK ALARM: ${products[0].name} In Stock!`
      : `🚨 RESTOCK ALARM: ${products.length} Watched Items Restocked!`;

    const bodyLines = products.slice(0, 3).map((p) => {
      const priceStr = `₹${p.price}`;
      const qtyStr = p.available > 0 ? `${p.available} boxes` : "available";
      const proteinStr = p.costPerGramProtein ? ` (₹${p.costPerGramProtein}/g)` : "";
      return `• ${p.name}: ${priceStr} · ${qtyStr}${proteinStr}`;
    });

    if (products.length > 3) {
      bodyLines.push(`+ ${products.length - 3} more items`);
    }

    const notification = new Notification(title, {
      body: bodyLines.join("\n"),
      icon: products[0].imageUrl || "/favicon.ico",
      tag: "amul-restock-alarm",
      requireInteraction: true, // Stays visible until clicked or dismissed
      silent: false,
    });

    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      options?.onClick?.();
      notification.close();
    };

    if (options?.onDismiss) {
      notification.onclose = () => {
        options.onDismiss?.();
      };
    }

    return notification;
  } catch (err) {
    console.debug?.("[Latch Notification] Could not send notification:", err);
    return null;
  }
}
