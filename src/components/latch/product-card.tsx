import { Check, ExternalLink, Eye, Minus, Plus } from "lucide-react";
import { type AmulProduct, type TrackedProduct, productPageUrl } from "@/lib/amul/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  product: AmulProduct;
  tracked?: TrackedProduct;
  onToggle: () => void;
  onQuantity: (qty: number) => void;
};

export function ProductCard({ product, tracked, onToggle, onQuantity }: Props) {
  const selected = Boolean(tracked);
  const isBestValue =
    typeof product.costPerGramProtein === "number" &&
    Number.isFinite(product.costPerGramProtein) &&
    product.costPerGramProtein > 0 &&
    product.costPerGramProtein <= 2.2;

  const shopUrl = productPageUrl(product.alias);

  // 1. Resolve raw compare price supporting standard AmulProduct fields and raw StoreHippo fallbacks
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

  // 2. Strict discount validity condition
  const hasDiscount = Boolean(
    comparePrice !== null &&
    currentPrice > 0 &&
    comparePrice > currentPrice
  );

  // 3. Compute savings amount with fallback to arithmetic difference
  const savingsAmount = hasDiscount && comparePrice !== null
    ? (typeof product.discountAmount === "number" && product.discountAmount > 0
        ? product.discountAmount
        : Math.round(comparePrice - currentPrice))
    : 0;

  // 4. Compute discount percentage with fallback to arithmetic percentage
  const discountPct = hasDiscount && comparePrice !== null && comparePrice > 0
    ? (typeof product.discountPct === "number" && product.discountPct > 0
        ? product.discountPct
        : Math.round(((comparePrice - currentPrice) / comparePrice) * 100))
    : 0;

  // 5. Final guard against zero-savings or fractional rounding edge cases
  const showDiscount = hasDiscount && savingsAmount > 0 && discountPct > 0;

  return (
    <article
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl bg-card border border-border/70 transition-all duration-200",
        "hover:border-border hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]",
        selected && "border-stock/60 shadow-[0_0_24px_rgba(111,143,106,0.14)] ring-1 ring-stock/40",
      )}
    >
      {/* Top Image Stage */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-gradient-to-b from-[#191b16] to-[#121410] flex items-center justify-center p-3">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="size-full object-contain drop-shadow-md transition-transform duration-300 group-hover:scale-105"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-xs font-mono text-subtle">
            No image available
          </div>
        )}

        {/* Floating Stock Badge */}
        <div className="absolute top-2.5 left-2.5 z-10">
          <Badge
            variant={product.inStock ? "stock" : "danger"}
            className="px-2 py-0.5 text-[11px] font-mono tracking-tight shadow-sm backdrop-blur-md"
          >
            {product.inStock ? (
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-current animate-pulse" />
                In stock
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-current opacity-70" />
                Out of stock
              </span>
            )}
          </Badge>
        </div>

        {/* Floating Tracked / Best Value Marker */}
        <div className="absolute top-2.5 right-2.5 z-10 flex items-center gap-1.5">
          {selected ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-stock text-primary-foreground font-mono text-[10px] font-semibold px-2 py-0.5 shadow-sm">
              <Check className="size-3" />
              Tracking {tracked?.quantity ?? 1}x
            </span>
          ) : isBestValue ? (
            <span className="inline-flex items-center rounded-full bg-stock/20 border border-stock/40 text-stock font-mono text-[10px] font-semibold px-2 py-0.5 backdrop-blur-md">
              Best Value
            </span>
          ) : null}
        </div>

        {/* Floating Discount Pill Badge (Bottom-Left of Image) */}
        {showDiscount ? (
          <div className="absolute bottom-2.5 left-2.5 z-10">
            <span className="inline-flex items-center gap-1 rounded-full bg-warn/95 text-primary-foreground font-mono text-[10px] sm:text-[11px] font-bold px-2 py-0.5 shadow-md backdrop-blur-md">
              {discountPct}% OFF
            </span>
          </div>
        ) : null}
      </div>

      {/* Card Body */}
      <div className="flex flex-1 flex-col gap-3.5 p-4">
        {/* Title and Specs */}
        <div className="flex flex-col gap-1.5">
          <h3
            className="text-[14px] sm:text-[15px] font-medium leading-snug text-foreground line-clamp-2 min-h-[2.6rem]"
            title={product.name}
          >
            {product.name}
          </h3>

          <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
            <span className="text-[11px] text-subtle">{product.sku}</span>
            {product.inStock && product.inventoryQuantity > 0 ? (
              <span className="text-[11px] text-stock/90 font-medium tabular-nums">
                {product.inventoryQuantity}{" "}
                {/pack|sachet|box/i.test(product.name)
                  ? product.inventoryQuantity === 1 ? "box" : "boxes"
                  : product.inventoryQuantity === 1 ? "unit" : "units"}{" "}
                available
              </span>
            ) : null}
          </div>
        </div>

        {/* Pricing & Telemetry Block */}
        <div className="rounded-lg bg-muted/40 border border-border/50 p-2.5 flex items-center justify-between gap-2 min-h-[58px]">
          <div className="flex flex-col min-w-0">
            {/* Price Line: Current Price + Strikethrough Original Price / MRP */}
            <div className="flex items-baseline gap-1.5 flex-wrap">
              <span className="text-xl sm:text-2xl font-bold tracking-tight text-foreground tabular-nums">
                ₹{currentPrice.toLocaleString("en-IN")}
              </span>

              {showDiscount && comparePrice !== null ? (
                <span className="text-xs sm:text-[13px] font-mono text-muted-foreground/80 line-through tabular-nums decoration-muted-foreground/60">
                  ₹{comparePrice.toLocaleString("en-IN")}
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground uppercase font-mono">
                  MRP
                </span>
              )}
            </div>

            {/* Savings Line: Rupee Savings Badge + Discount % */}
            {showDiscount ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-mono font-semibold bg-warn/15 text-warn border border-warn/30 tabular-nums">
                  Save ₹{savingsAmount.toLocaleString("en-IN")}
                </span>
                <span className="text-[10px] font-mono text-warn/80 font-medium tabular-nums hidden sm:inline">
                  ({discountPct}% off)
                </span>
              </div>
            ) : null}
          </div>

          {/* Protein Cost & Best Value Telemetry Badge */}
          {typeof product.costPerGramProtein === "number" &&
          Number.isFinite(product.costPerGramProtein) &&
          product.costPerGramProtein > 0 ? (
            <div
              className={cn(
                "flex shrink-0 flex-col items-end rounded px-2 py-1 border text-right transition-colors",
                isBestValue
                  ? "bg-stock/15 border-stock/40 text-stock shadow-[0_0_12px_rgba(111,143,106,0.1)]"
                  : "bg-card border-border/70 text-foreground/80",
              )}
            >
              <span className="font-mono text-xs font-semibold tabular-nums leading-none flex items-center gap-1">
                {isBestValue ? (
                  <span className="size-1.5 rounded-full bg-stock animate-pulse inline-block" />
                ) : null}
                ₹{Number(product.costPerGramProtein).toFixed(2)}
                <span className="text-[10px] font-normal text-muted-foreground">/g</span>
              </span>
              <span
                className={cn(
                  "text-[9px] uppercase tracking-wider font-mono mt-0.5",
                  isBestValue ? "text-stock/90 font-medium" : "text-muted-foreground",
                )}
              >
                {isBestValue ? "Best Value" : "Protein Cost"}
              </span>
            </div>
          ) : null}
        </div>

        {/* Action Controls */}
        <div className="mt-auto flex flex-col gap-2 pt-1">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant={selected ? "default" : "secondary"}
              className={cn(
                "h-10 flex-1 font-medium text-xs transition-all",
                selected
                  ? "bg-stock text-primary-foreground hover:bg-stock/90 shadow-sm"
                  : "bg-muted/70 hover:bg-muted text-foreground border border-border/60",
              )}
              onClick={onToggle}
            >
              {selected ? (
                <span className="flex items-center gap-1.5">
                  <Check className="size-3.5" />
                  Watched
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Eye className="size-3.5" />
                  Watch SKU
                </span>
              )}
            </Button>

            {selected ? (
              <div className="flex h-10 items-center rounded-md bg-muted border border-border/70 px-1">
                <button
                  type="button"
                  className="flex size-8 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
                  onClick={() => onQuantity(Math.max(1, (tracked?.quantity ?? 1) - 1))}
                  aria-label="Decrease quantity"
                >
                  <Minus className="size-3" />
                </button>
                <span className="w-7 text-center font-mono text-xs font-semibold tabular-nums text-foreground">
                  {tracked?.quantity ?? 1}x
                </span>
                <button
                  type="button"
                  className="flex size-8 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-card transition-colors"
                  onClick={() => onQuantity(Math.min(10, (tracked?.quantity ?? 1) + 1))}
                  aria-label="Increase quantity"
                >
                  <Plus className="size-3" />
                </button>
              </div>
            ) : null}

            <a
              href={shopUrl}
              target="_blank"
              rel="noreferrer"
              className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/70 transition-colors"
              title="Open product on shop.amul.com"
            >
              <ExternalLink className="size-3.5" />
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
