import { Minus, Plus } from "lucide-react";
import type { AmulProduct, TrackedProduct } from "@/lib/amul/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  product: AmulProduct;
  tracked?: TrackedProduct;
  onToggle: () => void;
  onQuantity: (qty: number) => void;
  onCheckout?: () => void;
  checkoutBusy?: boolean;
};

export function ProductCard({
  product,
  tracked,
  onToggle,
  onQuantity,
  onCheckout,
  checkoutBusy,
}: Props) {
  const selected = Boolean(tracked);
  const isBestValue =
    typeof product.costPerGramProtein === "number" && product.costPerGramProtein <= 2.2;

  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-lg bg-card shadow-[var(--shadow-border)] transition-[box-shadow] duration-150",
        selected && "shadow-[var(--shadow-border-hover)]",
        isBestValue && "ring-1 ring-stock/30",
      )}
    >
      <div className="relative aspect-[5/4] overflow-hidden bg-muted">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt=""
            className="size-full object-cover outline outline-1 -outline-offset-1 outline-foreground/10"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-subtle">No image</div>
        )}
        <Badge
          variant={product.inStock ? "stock" : "danger"}
          className="absolute top-3 left-3"
        >
          {product.inStock ? "In stock" : "Out of stock"}
        </Badge>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm leading-snug font-medium text-foreground">{product.name}</h3>
          <p className="font-mono text-xs text-muted-foreground">
            {product.sku}
            {product.price > 0 ? (
              <>
                <span className="mx-1.5 text-subtle">·</span>
                <span className="tabular-nums">₹{product.price}</span>
              </>
            ) : null}
            {product.inStock ? (
              <span className="tabular-nums">
                <span className="mx-1.5 text-subtle">·</span>
                {product.inventoryQuantity}{" "}
                {/pack|sachet|box/i.test(product.name)
                  ? product.inventoryQuantity === 1
                    ? "box"
                    : "boxes"
                  : product.inventoryQuantity === 1
                    ? "unit"
                    : "units"}{" "}
                in stock
              </span>
            ) : null}
          </p>
        </div>

        {typeof product.costPerGramProtein === "number" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="default" className="font-mono text-xs tabular-nums text-foreground/80">
              ₹{Number(product.costPerGramProtein).toFixed(2)}/g protein
            </Badge>
            {isBestValue ? (
              <Badge variant="stock" className="border border-stock/30">
                Best Value
              </Badge>
            ) : null}
          </div>
        ) : null}

        <div className="mt-auto flex items-center gap-2">
          <Button
            type="button"
            variant={selected ? "default" : "secondary"}
            className="h-11 flex-1"
            onClick={onToggle}
          >
            {selected ? "Watching" : "Watch"}
          </Button>
          {selected ? (
            <div className="flex h-11 items-center rounded-md bg-muted shadow-[var(--shadow-border)]">
              <button
                type="button"
                className="flex size-11 items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={() => onQuantity(Math.max(1, (tracked?.quantity ?? 1) - 1))}
                aria-label="Decrease quantity"
              >
                <Minus className="size-3.5" />
              </button>
              <span className="w-6 text-center font-mono text-xs tabular-nums">
                {tracked?.quantity ?? 1}
              </span>
              <button
                type="button"
                className="flex size-11 items-center justify-center text-muted-foreground hover:text-foreground"
                onClick={() => onQuantity(Math.min(10, (tracked?.quantity ?? 1) + 1))}
                aria-label="Increase quantity"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          ) : null}
        </div>

        {selected && product.inStock && onCheckout ? (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={onCheckout}
            disabled={checkoutBusy}
          >
            Checkout now
          </Button>
        ) : null}
      </div>
    </article>
  );
}
