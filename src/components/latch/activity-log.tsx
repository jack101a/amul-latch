import { formatDistanceToNow } from "date-fns";
import type { ActivityEvent } from "@/lib/amul/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export function ActivityLog({ events }: { events: ActivityEvent[] }) {
  if (!events.length) {
    return (
      <div className="flex h-full min-h-48 items-center rounded-lg bg-card px-5 py-8 shadow-[var(--shadow-border)]">
        <p className="text-sm text-muted-foreground">
          Activity appears here — polls, restocks, checkout, payment pauses, session recovery.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full min-h-48 rounded-lg bg-card shadow-[var(--shadow-border)]">
      <ol className="flex flex-col divide-y divide-border">
        {events.map((event) => (
          <li key={event.id} className="flex gap-3 px-4 py-3">
            <span
              className={cn(
                "mt-1.5 size-1.5 shrink-0 rounded-full",
                event.level === "ok" && "bg-stock",
                event.level === "warn" && "bg-warn",
                event.level === "error" && "bg-destructive",
                event.level === "info" && "bg-subtle",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm text-foreground">{event.title}</p>
                <time className="shrink-0 font-mono text-[11px] text-subtle tabular-nums">
                  {formatDistanceToNow(new Date(event.at), { addSuffix: true })}
                </time>
              </div>
              {event.detail ? (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{event.detail}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </ScrollArea>
  );
}
