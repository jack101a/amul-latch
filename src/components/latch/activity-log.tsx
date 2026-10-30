import { useState, useMemo } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Radio,
  Tag,
  TrendingDown,
  Zap,
} from "lucide-react";
import type { ActivityEvent } from "@/lib/amul/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type FilterType = "all" | "deals" | "restock" | "order" | "poll";

export function ActivityLog({ events }: { events: ActivityEvent[] }) {
  const [filter, setFilter] = useState<FilterType>("all");

  const filteredEvents = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "deals")
      return events.filter((e) => e.kind === "price_drop" || e.kind === "discount");
    if (filter === "restock") return events.filter((e) => e.kind === "restock");
    if (filter === "order")
      return events.filter(
        (e) =>
          e.kind === "checkout_started" ||
          e.kind === "payment_required" ||
          e.kind === "order_success" ||
          e.kind === "order_failed",
      );
    if (filter === "poll") return events.filter((e) => e.kind === "poll" || e.kind === "pincode_set");
    return events;
  }, [events, filter]);

  const dealsCount = useMemo(
    () => events.filter((e) => e.kind === "price_drop" || e.kind === "discount").length,
    [events],
  );
  const restockCount = useMemo(() => events.filter((e) => e.kind === "restock").length, [events]);
  const orderCount = useMemo(
    () =>
      events.filter(
        (e) =>
          e.kind === "checkout_started" ||
          e.kind === "payment_required" ||
          e.kind === "order_success" ||
          e.kind === "order_failed",
      ).length,
    [events],
  );

  return (
    <div className="flex flex-col rounded-xl bg-card border border-border/70 overflow-hidden shadow-[var(--shadow-border)]">
      {/* Header with Telemetry Filters */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border/60 bg-muted/20">
        <div className="flex items-center gap-2">
          <span className="relative flex size-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-stock opacity-75" />
            <span className="relative inline-flex rounded-full size-2 bg-stock" />
          </span>
          <span className="font-mono text-xs font-medium tracking-wider uppercase text-foreground">
            Telemetry Stream
          </span>
          <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
            ({events.length} events)
          </span>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 rounded-md bg-muted/60 p-0.5 text-xs font-mono">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={cn(
              "px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer",
              filter === "all"
                ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilter("deals")}
            className={cn(
              "px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1",
              filter === "deals"
                ? "bg-warn/25 text-warn font-semibold shadow-sm border border-warn/40"
                : "text-muted-foreground hover:text-warn",
            )}
          >
            Deals
            {dealsCount > 0 ? (
              <span className="px-1 py-0.2 rounded-full text-[9px] bg-warn/30 text-warn font-bold">
                {dealsCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setFilter("restock")}
            className={cn(
              "px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1",
              filter === "restock"
                ? "bg-stock text-primary-foreground font-semibold shadow-sm"
                : "text-muted-foreground hover:text-stock",
            )}
          >
            Restocks
            {restockCount > 0 ? (
              <span className="px-1 py-0.2 rounded-full text-[9px] bg-stock/30 text-stock font-bold">
                {restockCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setFilter("order")}
            className={cn(
              "px-2 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1",
              filter === "order"
                ? "bg-warn text-primary-foreground font-semibold shadow-sm"
                : "text-muted-foreground hover:text-warn",
            )}
          >
            Orders
            {orderCount > 0 ? (
              <span className="px-1 py-0.2 rounded-full text-[9px] bg-warn/30 text-warn font-bold">
                {orderCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => setFilter("poll")}
            className={cn(
              "px-2.5 py-1 rounded text-[11px] font-medium transition-colors cursor-pointer",
              filter === "poll"
                ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Polls
          </button>
        </div>
      </div>

      {/* Log Feed List */}
      {!filteredEvents.length ? (
        <div className="flex h-48 flex-col items-center justify-center p-6 text-center text-muted-foreground">
          <Radio className="size-6 text-subtle mb-2 animate-pulse" />
          <p className="text-xs font-mono">
            {events.length === 0
              ? "Live activity appears here — background polls, restocks, and checkout stages."
              : `No events in '${filter}' category yet.`}
          </p>
        </div>
      ) : (
        <ScrollArea className="h-64 sm:h-72">
          <ol className="flex flex-col divide-y divide-border/40">
            {filteredEvents.map((event) => {
              const isRestock = event.kind === "restock";
              const isPriceDrop = event.kind === "price_drop";
              const isDiscount = event.kind === "discount";
              const isDeal = isPriceDrop || isDiscount;
              const isPayment = event.kind === "payment_required";
              const isSuccess = event.kind === "order_success";
              const isError = event.level === "error";

              return (
                <li
                  key={event.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30",
                    isRestock && "bg-stock/10 border-l-2 border-l-stock",
                    isPriceDrop && "bg-warn/10 border-l-2 border-l-warn",
                    isDiscount && "bg-warn/8 border-l-2 border-l-warn/70",
                    isPayment && "bg-warn/10 border-l-2 border-l-warn",
                    isSuccess && "bg-stock/15 border-l-2 border-l-stock font-medium",
                  )}
                >
                  <span className="mt-0.5 shrink-0">
                    {isRestock ? (
                      <Bell className="size-3.5 text-stock animate-bounce" />
                    ) : isPriceDrop ? (
                      <TrendingDown className="size-3.5 text-warn animate-pulse" />
                    ) : isDiscount ? (
                      <Tag className="size-3.5 text-warn" />
                    ) : isPayment ? (
                      <Zap className="size-3.5 text-warn animate-pulse" />
                    ) : isSuccess ? (
                      <CheckCircle2 className="size-3.5 text-stock" />
                    ) : isError ? (
                      <AlertCircle className="size-3.5 text-destructive" />
                    ) : event.level === "warn" ? (
                      <AlertTriangle className="size-3.5 text-warn" />
                    ) : (
                      <Radio className="size-3.5 text-subtle" />
                    )}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-xs font-medium text-foreground truncate">{event.title}</p>
                      <time className="shrink-0 font-mono text-[10px] text-muted-foreground tabular-nums">
                        {formatDistanceToNow(new Date(event.at), { addSuffix: true })}
                      </time>
                    </div>
                    {event.detail ? (
                      isDeal && event.detail.includes("➔") ? (
                        (() => {
                          const [oldPart, newPart] = event.detail.split("➔");
                          return (
                            <p className="mt-0.5 text-[11px] font-mono leading-relaxed flex flex-wrap items-center gap-1.5">
                              <span className="line-through text-muted-foreground/75 opacity-80">
                                {oldPart.trim()}
                              </span>
                              <span className="text-subtle text-[10px]">➔</span>
                              <span className="text-warn font-semibold">
                                {newPart.trim()}
                              </span>
                            </p>
                          );
                        })()
                      ) : (
                        <p className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">
                          {event.detail}
                        </p>
                      )
                    ) : null}
                  </div>

                  {isRestock ? (
                    <Badge variant="stock" className="shrink-0 text-[9px] px-1.5 py-0 leading-none">
                      RESTOCK
                    </Badge>
                  ) : isPriceDrop ? (
                    <Badge variant="warn" className="shrink-0 text-[9px] px-1.5 py-0 leading-none font-mono font-semibold">
                      PRICE DROP
                    </Badge>
                  ) : isDiscount ? (
                    <Badge variant="warn" className="shrink-0 text-[9px] px-1.5 py-0 leading-none font-mono font-semibold">
                      DISCOUNT
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </ScrollArea>
      )}
    </div>
  );
}
