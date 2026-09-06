/**
 * Tab title flasher for restock alarm notifications.
 * Alternates browser tab title between an urgent alert icon and the stock message
 * so users instantly spot restocks across multiple background tabs.
 */

let originalTitle: string | null = null;
let flashInterval: number | null = null;

export function startTabTitleFlash(productName: string): void {
  if (typeof document === "undefined") return;

  if (originalTitle === null) {
    originalTitle = document.title;
  }

  if (flashInterval !== null) {
    clearInterval(flashInterval);
  }

  const shortName = productName.length > 25 ? productName.slice(0, 22) + "..." : productName;
  let toggle = false;

  flashInterval = window.setInterval(() => {
    toggle = !toggle;
    document.title = toggle
      ? "🚨 [RESTOCK ALARM] IN STOCK!"
      : `⚡ ${shortName} (Buy Now)`;
  }, 800);
}

export function stopTabTitleFlash(): void {
  if (typeof document === "undefined") return;

  if (flashInterval !== null) {
    clearInterval(flashInterval);
    flashInterval = null;
  }

  if (originalTitle !== null) {
    document.title = originalTitle;
    originalTitle = null;
  }
}
