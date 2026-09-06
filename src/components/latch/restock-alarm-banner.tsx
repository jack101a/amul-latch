import { useState, useEffect } from "react";
import { 
  BellRing, 
  VolumeX, 
  Zap, 
  ExternalLink, 
  CheckCircle2, 
  X, 
  Sparkles, 
  AlertTriangle,
  Radio
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AmulProduct } from "@/lib/amul/types";
import { 
  checkNotificationSupport, 
  requestNotificationPermission 
} from "@/lib/notifications/browser-notification";

type RestockAlarmBannerProps = {
  products: AmulProduct[];
  isRinging: boolean;
  onSilence: () => void;
  onDismiss: () => void;
  onInstantCheckout?: (product: AmulProduct) => void;
  onSelectProduct?: (sku: string) => void;
};

export function RestockAlarmBanner({
  products,
  isRinging,
  onSilence,
  onDismiss,
  onInstantCheckout,
  onSelectProduct,
}: RestockAlarmBannerProps) {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    const status = checkNotificationSupport();
    setPermission(status.permission);
  }, []);

  const handleRequestPush = async () => {
    const res = await requestNotificationPermission();
    setPermission(res);
  };

  if (!products.length) return null;

  return (
    <section 
      aria-label="Restock Alarm" 
      className="relative overflow-hidden rounded-xl border border-stock/60 bg-gradient-to-r from-[#141913] via-[#121611] to-[#171a13] p-4 sm:p-5 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300 ring-1 ring-stock/30"
    >
      {/* Background Radar Glow */}
      <div className="absolute -top-16 -right-16 size-48 rounded-full bg-stock/10 blur-3xl pointer-events-none" />

      {/* Top Banner Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3.5 mb-4">
        <div className="flex items-center gap-2.5 sm:gap-3">
          {/* Animated Alarm Beacon */}
          <div className="relative flex size-9 items-center justify-center rounded-lg bg-stock/20 border border-stock/40 text-stock shrink-0">
            <BellRing className={cn("size-5", isRinging && "animate-bounce text-stock")} />
            {isRinging ? (
              <span className="absolute -top-1 -right-1 flex size-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-stock opacity-75" />
                <span className="relative inline-flex size-3 rounded-full bg-stock" />
              </span>
            ) : null}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-semibold tracking-tight text-foreground flex items-center gap-1.5">
                <span>Restock Alarm Activated</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-stock/20 border border-stock/40 px-2 py-0.5 text-[10px] font-mono font-bold text-stock uppercase">
                  <Radio className="size-2.5 animate-pulse" /> Live Stock
                </span>
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {products.length === 1
                ? "1 watched SKU is back in stock at your selected hub."
                : `${products.length} watched SKUs are back in stock at your selected hub.`}
            </p>
          </div>
        </div>

        {/* Alarm Controls */}
        <div className="flex items-center gap-2">
          {isRinging ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSilence}
              className="h-8 border-warn/60 bg-warn/15 text-warn hover:bg-warn/25 font-mono text-xs font-semibold gap-1.5 cursor-pointer shadow-sm transition-all animate-pulse"
              title="Silence alarm sound"
            >
              <VolumeX className="size-3.5" />
              <span>Silence Alarm</span>
            </Button>
          ) : (
            <span className="text-[11px] font-mono text-muted-foreground/70 hidden sm:inline">
              Audio silenced
            </span>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onDismiss}
            className="size-8 text-muted-foreground hover:text-foreground cursor-pointer rounded-lg"
            aria-label="Dismiss restock banner"
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      {/* Restocked Products Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {products.map((p) => {
          return (
            <div
              key={p.sku}
              className="group flex flex-col justify-between rounded-lg border border-border/80 bg-card/90 p-3 hover:border-stock/50 transition-all shadow-xs"
            >
              <div className="flex items-start gap-3">
                {p.imageUrl ? (
                  <img
                    src={p.imageUrl}
                    alt={p.name}
                    className="size-14 rounded-md object-contain bg-muted/40 p-1 shrink-0 border border-border/50"
                  />
                ) : (
                  <div className="size-14 rounded-md bg-muted/40 flex items-center justify-center text-xs font-mono text-muted-foreground border border-border/50 shrink-0">
                    SKU
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="inline-flex items-center gap-1 rounded bg-stock/15 text-stock px-1.5 py-0.5 text-[10px] font-mono font-bold">
                      <CheckCircle2 className="size-2.5" /> {p.available} boxes
                    </span>
                    {p.costPerGramProtein ? (
                      <span className="rounded bg-muted/70 text-foreground px-1.5 py-0.5 text-[10px] font-mono">
                        ₹{p.costPerGramProtein}/g
                      </span>
                    ) : null}
                  </div>

                  <h3 className="text-xs font-medium text-foreground line-clamp-2 mt-1 leading-snug">
                    {p.name}
                  </h3>

                  <p className="text-xs font-mono font-bold text-foreground mt-1">
                    ₹{p.price} <span className="text-[10px] font-normal text-muted-foreground">MRP</span>
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-border/50">
                {onInstantCheckout ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => onInstantCheckout(p)}
                    className="flex-1 h-7 text-[11px] font-bold bg-stock hover:bg-stock/90 text-primary-foreground gap-1 cursor-pointer"
                  >
                    <Zap className="size-3 fill-current" />
                    <span>Instant Checkout</span>
                  </Button>
                ) : null}

                <a
                  href={p.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex size-7 items-center justify-center rounded-md border border-border/70 hover:bg-muted text-muted-foreground hover:text-foreground text-[11px] transition-colors shrink-0"
                  title="Open on Amul store"
                >
                  <ExternalLink className="size-3.5" />
                </a>

                {onSelectProduct ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelectProduct(p.sku)}
                    className="h-7 px-2 text-[11px] font-mono text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    View
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Browser Notification Permission Hint */}
      {permission === "default" && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Sparkles className="size-3.5 text-warn shrink-0" />
            <span>Enable browser push notifications to get OS alerts even when this tab is hidden.</span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRequestPush}
            className="h-7 text-[11px] font-mono font-semibold border-border hover:bg-muted text-foreground cursor-pointer shrink-0"
          >
            Enable Push
          </Button>
        </div>
      )}
    </section>
  );
}
