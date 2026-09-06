import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { LoaderCircle, Search, Settings2, ShieldCheck, Square } from "lucide-react";
import { toast } from "sonner";
import {
  dismissCheckout,
  disconnectSessionAction,
  getWatchStatus,
  resolvePincode,
  startCheckout,
  startWatcher,
  stopWatcher,
  testTelegram,
  tickWatcher,
  verifySessionCookie,
} from "@/lib/amul/actions";
import {
  DEFAULT_CONFIG,
  type AmulProduct,
  type AppConfig,
  type UserProfileInfo,
  type WatchSnapshot,
  extractProteinGrams,
  productPageUrl,
} from "@/lib/amul/types";
import { playRestockChime } from "@/lib/audio/chime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ActivityLog } from "./activity-log";
import { ProductCard } from "./product-card";
import { SettingsDialog } from "./settings-dialog";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "latch-config-v1";
const WATCH_KEY = "latch-watching-v1";
const PROFILE_KEY = "latch-profile-v1";

const PHASE_COPY: Record<WatchSnapshot["phase"], { label: string; hint: string }> = {
  idle: { label: "Idle", hint: "Set a pincode, pick SKUs, start watching." },
  watching: { label: "Watching", hint: "Polling Amul. Auto-order waits for a restock edge." },
  restock: { label: "In stock", hint: "A watched SKU is available for this pincode." },
  checkout: { label: "Checkout", hint: "Filling cart and advancing as far as Amul allows." },
  awaiting_payment: {
    label: "Payment",
    hint: "Approve the request in your UPI or bank app. Latch stops here.",
  },
  ordered: { label: "Ordered", hint: "Amul accepted the order." },
  error: { label: "Error", hint: "See the activity log. Sessions recover automatically." },
};

export function LatchDashboard() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [hydrated, setHydrated] = useState(false);
  const [snap, setSnap] = useState<WatchSnapshot | null>(null);
  const [catalog, setCatalog] = useState<AmulProduct[]>([]);
  const [pinInput, setPinInput] = useState("");
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busy, setBusy] = useState<"pin" | "watch" | "checkout" | "tg" | null>(null);
  const [filter, setFilter] = useState<"all" | "watched" | "value" | "out">("all");
  const [now, setNow] = useState(() => Date.now());
  const resumed = useRef(false);
  const seenEventIds = useRef<Set<string>>(new Set());
  const prevStockRef = useRef<Map<string, boolean>>(new Map());
  const initialMountRef = useRef(true);
  const lastChimeTime = useRef(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppConfig>;
        const next = { ...DEFAULT_CONFIG, ...parsed };
        setConfig(next);
        setPinInput(next.pincode);
      }
    } catch {
      /* ignore corrupt local config */
    }

    try {
      const rawProfile = localStorage.getItem(PROFILE_KEY);
      if (rawProfile) {
        const savedProfile = JSON.parse(rawProfile) as UserProfileInfo;
        if (savedProfile?.userName) {
          setSnap((prev) =>
            prev
              ? {
                  ...prev,
                  userProfile: savedProfile,
                  sessionLoggedIn: true,
                  sessionReady: true,
                }
              : null,
          );
        }
      }
    } catch {
      /* ignore corrupt profile */
    }

    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const importedCookie = params.get("import_cookie");
      if (importedCookie) {
        window.history.replaceState({}, document.title, window.location.pathname);
        setConfig((prev) => ({ ...prev, sessionCookie: importedCookie }));
        void verifySessionCookie({ data: { sessionCookie: importedCookie } })
          .then((res) => {
            if (res.valid && res.loggedIn && res.profile) {
              setSnap((prev) => (prev ? { ...prev, userProfile: res.profile, sessionLoggedIn: true } : prev));
              try {
                localStorage.setItem(PROFILE_KEY, JSON.stringify(res.profile));
              } catch {
                /* ignore */
              }
              toast.success(`Connected to Amul: ${res.profile.userName}`);
            } else {
              toast.warning(res.message);
            }
          })
          .catch(() => undefined);
      }
    }

    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config, hydrated]);

  useEffect(() => {
    let cancelled = false;
    void getWatchStatus()
      .then((s) => {
        if (!cancelled) {
          setSnap((prev) => {
            const hasCookie = Boolean(config.sessionCookie?.trim());
            const mergedProfile = s.userProfile ?? (hasCookie ? prev?.userProfile : null);
            if (s.userProfile) {
              try {
                localStorage.setItem(PROFILE_KEY, JSON.stringify(s.userProfile));
              } catch {
                /* ignore */
              }
            }
            return {
              ...s,
              userProfile: hasCookie ? mergedProfile : null,
              sessionLoggedIn: Boolean(hasCookie && (s.sessionLoggedIn || mergedProfile)),
            };
          });
          if (s.products.length) setCatalog(s.products);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [config.sessionCookie]);

  useEffect(() => {
    if (!hydrated || resumed.current) return;
    const want = localStorage.getItem(WATCH_KEY) === "1";
    if (!want || !config.pincode || !config.products.length) return;
    resumed.current = true;
    void startWatcher({ data: { config } })
      .then((s) => {
        setSnap(s);
        if (s.products.length) setCatalog(s.products);
        toast.success("Watcher resumed");
      })
      .catch(() => undefined);
  }, [hydrated, config]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void getWatchStatus()
        .then((s) => {
          setSnap((prev) => {
            const hasCookie = Boolean(config.sessionCookie?.trim());
            const mergedProfile = s.userProfile ?? (hasCookie ? prev?.userProfile : null);
            if (s.userProfile) {
              try {
                localStorage.setItem(PROFILE_KEY, JSON.stringify(s.userProfile));
              } catch {
                /* ignore */
              }
            }
            return {
              ...s,
              userProfile: hasCookie ? mergedProfile : null,
              sessionLoggedIn: Boolean(hasCookie && (s.sessionLoggedIn || mergedProfile)),
            };
          });
          if (s.products.length) setCatalog(s.products);
        })
        .catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(id);
  }, [config.sessionCookie]);

  useEffect(() => {
    if (!snap?.watching) return;
    const id = window.setInterval(() => {
      const last = snap.lastTickAt ? Date.parse(snap.lastTickAt) : 0;
      const due = !last || Date.now() - last > Math.max(snap.nextPollMs, config.pollMinMs) * 0.85;
      if (!due) return;
      void tickWatcher({ data: { config } })
        .then((s) => {
          setSnap(s);
          if (s.products.length) setCatalog(s.products);
        })
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(id);
  }, [snap?.watching, snap?.lastTickAt, snap?.nextPollMs, config]);

  useEffect(() => {
    if (!snap?.watching) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [snap?.watching]);

  const patch = (partial: Partial<AppConfig>) => setConfig((c) => ({ ...c, ...partial }));

  const live = catalog.length ? catalog : (snap?.products ?? []);
  const products: AmulProduct[] =
    live.length > 0
      ? live
      : config.products.map((t) => {
          const proteinGrams = extractProteinGrams(t.name, t.alias);
          return {
            id: t.productId,
            sku: t.sku,
            name: t.name,
            alias: t.alias,
            price: 0,
            available: 0,
            inventoryQuantity: 0,
            inventoryLowStock: 0,
            inStock: false,
            imageUrl: null,
            sellerId: t.sellerId,
            productUrl: productPageUrl(t.alias),
            proteinGrams,
            costPerGramProtein: null,
          };
        });
  const trackedMap = useMemo(
    () => new Map(config.products.map((p) => [p.sku, p])),
    [config.products],
  );

  // Restock audio chime monitor (watches restock events & stock transitions)
  useEffect(() => {
    if (!snap) return;

    if (initialMountRef.current) {
      // Seed seen events and current stock levels on initial load so past history doesn't chime
      for (const e of snap.events) {
        seenEventIds.current.add(e.id);
      }
      for (const p of products) {
        prevStockRef.current.set(p.sku, p.inStock);
      }
      initialMountRef.current = false;
      return;
    }

    let restockDetected = false;

    // 1. Detect new restock events in activity log
    for (const ev of snap.events) {
      if (!seenEventIds.current.has(ev.id)) {
        seenEventIds.current.add(ev.id);
        if (ev.kind === "restock") {
          restockDetected = true;
        }
      }
    }

    // 2. Detect stock transitions (out-of-stock -> in-stock) for watched products
    const watchedSkuSet = new Set(config.products.map((p) => p.sku));
    for (const p of products) {
      if (watchedSkuSet.has(p.sku)) {
        const wasInStock = prevStockRef.current.get(p.sku);
        if (wasInStock === false && p.inStock) {
          restockDetected = true;
        }
      }
      prevStockRef.current.set(p.sku, p.inStock);
    }

    if (restockDetected) {
      const currentTime = Date.now();
      if (currentTime - lastChimeTime.current > 2000) {
        lastChimeTime.current = currentTime;
        if (config.soundEnabled) {
          playRestockChime();
        }
      }
    }
  }, [snap, products, config.products, config.soundEnabled]);

  const visible = products
    .filter((p) => {
      if (filter === "watched" && !trackedMap.has(p.sku)) return false;
      if (filter === "out" && p.inStock) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      }
      return true;
    })
    .slice()
    .sort((a, b) => {
      if (filter === "value") {
        if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
        const aCost = a.costPerGramProtein ?? Infinity;
        const bCost = b.costPerGramProtein ?? Infinity;
        if (aCost !== bCost) return aCost - bCost;
        return a.name.localeCompare(b.name);
      }
      const aw = trackedMap.has(a.sku) ? 0 : 1;
      const bw = trackedMap.has(b.sku) ? 0 : 1;
      if (aw !== bw) return aw - bw;
      if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const watching = Boolean(snap?.watching);
  const phase: WatchSnapshot["phase"] =
    watching && (snap?.phase === "idle" || !snap?.phase) ? "watching" : (snap?.phase ?? "idle");
  const copy = PHASE_COPY[phase];
  const nextInSec =
    watching && snap?.lastTickAt
      ? Math.max(0, Math.round((Date.parse(snap.lastTickAt) + snap.nextPollMs - now) / 1000))
      : null;

  async function loadPincode() {
    const pin = pinInput.trim();
    if (!/^\d{6}$/.test(pin)) {
      toast.error("Enter a 6-digit pincode");
      return;
    }
    setBusy("pin");
    try {
      const result = await resolvePincode({
        data: { pincode: pin, sessionCookie: config.sessionCookie },
      });
      patch({ pincode: pin });
      setCatalog(result.products);
      toast.success(`${result.substore.name} · ${result.products.length} protein SKUs`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reach Amul");
    } finally {
      setBusy(null);
    }
  }

  async function toggleWatch() {
    if (watching) {
      setBusy("watch");
      try {
        localStorage.removeItem(WATCH_KEY);
        setSnap(await stopWatcher());
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not stop");
      } finally {
        setBusy(null);
      }
      return;
    }
    if (!config.pincode) {
      toast.error("Load a pincode first");
      return;
    }
    if (!config.products.length) {
      toast.error("Watch at least one SKU");
      return;
    }
    setBusy("watch");
    try {
      const next = await startWatcher({ data: { config } });
      localStorage.setItem(WATCH_KEY, "1");
      setSnap(next);
      toast.success("Watcher is live");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start");
    } finally {
      setBusy(null);
    }
  }

  function toggleSku(product: AmulProduct) {
    const exists = trackedMap.get(product.sku);
    if (exists) {
      patch({ products: config.products.filter((p) => p.sku !== product.sku) });
      return;
    }
    patch({
      products: [
        ...config.products,
        {
          sku: product.sku,
          quantity: 1,
          name: product.name,
          alias: product.alias,
          productId: product.id,
          sellerId: product.sellerId,
        },
      ],
    });
  }

  async function checkout(sku: string) {
    setBusy("checkout");
    try {
      const next = await startCheckout({ data: { sku, config } });
      setSnap(next);
      if (next.checkout?.status === "awaiting_payment") {
        toast.message("Payment approval required");
      } else if (next.checkout?.status === "blocked") {
        toast.message("Paused for Amul login");
      } else if (next.checkout?.status === "failed") {
        toast.error(next.checkout.message);
      } else {
        toast.success("Checkout advanced");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(null);
    }
  }

  async function sendTg() {
    setBusy("tg");
    try {
      const result = await testTelegram({
        data: { botToken: config.telegramBotToken, chatId: config.telegramChatId },
      });
      if (result.ok) toast.success("Telegram test sent");
      else toast.error(result.error || "Telegram failed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Telegram failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleDisconnectSession() {
    try {
      localStorage.removeItem(PROFILE_KEY);
    } catch {
      /* ignore */
    }
    const nextConfig = { ...config, sessionCookie: "" };
    setConfig(nextConfig);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(nextConfig));
    } catch {
      /* ignore */
    }

    setSnap((prev) =>
      prev
        ? {
            ...prev,
            userProfile: null,
            sessionLoggedIn: false,
            sessionImported: false,
            sessionReady: false,
          }
        : prev,
    );

    try {
      const snapResult = await disconnectSessionAction();
      setSnap(snapResult);
      toast.info("Amul session disconnected");
    } catch {
      toast.info("Amul session disconnected");
    }
  }

  const inStockWatched = config.products.filter((t) => products.find((p) => p.sku === t.sku)?.inStock)
    .length;

  const hasActiveCookie = Boolean(config.sessionCookie?.trim());
  const sessionLabel = hasActiveCookie && (snap?.sessionLoggedIn || snap?.userProfile)
    ? "Logged in"
    : hasActiveCookie && snap?.sessionImported
      ? "Imported"
      : snap?.sessionReady
        ? "Anonymous"
        : "None";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1280px] flex-col gap-6 px-4 py-5 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 latch-enter">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-[0.22em] text-muted-foreground uppercase">
            Amul protein
          </p>
          <h1 className="font-display text-4xl leading-none tracking-tight sm:text-5xl">Latch</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon" onClick={() => setSettingsOpen(true)} aria-label="Settings">
            <Settings2 />
          </Button>
          <Button
            type="button"
            variant={watching ? "secondary" : "default"}
            onClick={() => void toggleWatch()}
            disabled={busy === "watch"}
          >
            {busy === "watch" ? (
              <LoaderCircle className="animate-spin" />
            ) : watching ? (
              <Square className="size-3 fill-current" />
            ) : null}
            {watching ? "Stop" : "Start watching"}
          </Button>
        </div>
      </header>

      {snap?.checkout && snap.checkout.status !== "failed" ? (
        <PaymentBanner
          checkout={snap.checkout}
          onDismiss={() => {
            void dismissCheckout().then(setSnap);
          }}
        />
      ) : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <aside className="flex flex-col gap-4">
          <div className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)]">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "size-2.5 rounded-full bg-subtle",
                  phase === "watching" && "bg-stock latch-pulse",
                  phase === "restock" && "bg-stock",
                  phase === "awaiting_payment" && "bg-warn latch-pulse",
                  phase === "checkout" && "bg-warn latch-pulse",
                  phase === "ordered" && "bg-stock",
                  phase === "error" && "bg-destructive",
                )}
              />
              <p className="font-display text-3xl leading-none tracking-tight">{copy.label}</p>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">{copy.hint}</p>
            <dl className="mt-5 grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
              <Stat label="Pincode" value={config.pincode || "—"} />
              <Stat label="Substore" value={snap?.substore?.name ?? "—"} />
              <Stat
                label="Watching"
                value={`${config.products.length} SKU${config.products.length === 1 ? "" : "s"}`}
              />
              <Stat label="In stock" value={`${inStockWatched}`} />
              <Stat label="Polls" value={snap ? String(snap.pollCount) : "0"} />
              <Stat label="Session" value={sessionLabel} />
            </dl>
            {snap?.userProfile && hasActiveCookie ? (
              <div className="mt-4 rounded-lg bg-muted/60 p-3 border border-border/50 text-xs">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Account</span>
                  <Badge variant="stock" className="text-[9px] px-1.5 py-0 leading-none">Verified</Badge>
                </div>
                <p className="mt-1 font-medium text-foreground truncate">{snap.userProfile.userName}</p>
                {snap.userProfile.defaultAddress ? (
                  <p className="mt-1 text-[11px] text-muted-foreground line-clamp-2 leading-tight" title={snap.userProfile.defaultAddress.label}>
                    📍 {snap.userProfile.defaultAddress.label}
                  </p>
                ) : null}
              </div>
            ) : null}
            {snap?.lastError ? (
              <p className="mt-4 text-xs text-destructive">{snap.lastError}</p>
            ) : null}
            {snap?.lastTickAt ? (
              <p className="mt-4 text-xs text-subtle">
                Last poll {formatDistanceToNow(new Date(snap.lastTickAt), { addSuffix: true })}
                {watching && nextInSec !== null ? ` · next in ${nextInSec}s` : ""}
              </p>
            ) : null}
          </div>

          <form
            className="rounded-xl bg-card p-5 shadow-[var(--shadow-border)]"
            onSubmit={(e) => {
              e.preventDefault();
              void loadPincode();
            }}
          >
            <Label htmlFor="pincode">Delivery pincode</Label>
            <div className="mt-2 flex gap-2">
              <Input
                id="pincode"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                placeholder="560001"
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="font-mono tracking-widest"
              />
              <Button type="submit" variant="secondary" disabled={busy === "pin"}>
                {busy === "pin" ? <LoaderCircle className="animate-spin" /> : "Load"}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Maps to the Amul substore that actually holds inventory.
            </p>
          </form>

          <div className="flex items-start gap-3 rounded-xl bg-card p-5 shadow-[var(--shadow-border)]">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-stock" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Payment stays on Amul. Latch never collects UPI PIN, OTP, card CVV, or bank passwords,
              and it does not call a third-party order server.
            </p>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1 rounded-lg bg-card p-1 shadow-[var(--shadow-border)]">
              {(
                [
                  ["all", "All"],
                  ["value", "Best Value"],
                  ["watched", "Watched"],
                  ["out", "Out of stock"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={cn(
                    "h-11 rounded-md px-3 text-xs font-medium transition-colors",
                    filter === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {config.autoOrder ? <Badge variant="paper">Auto-order</Badge> : <Badge>Notify only</Badge>}
              {config.telegramEnabled ? <Badge variant="stock">Telegram</Badge> : null}
            </div>
          </div>

          {products.length > 0 ? (
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by name or SKU"
                className="pl-9"
                aria-label="Filter products"
              />
            </div>
          ) : null}

          {busy === "pin" && products.length === 0 ? (
            <div className="rounded-xl bg-card p-6 shadow-[var(--shadow-border)]">
              <p className="font-display text-2xl tracking-tight">Talking to Amul…</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Resolving the substore for this pincode and loading protein SKUs.
              </p>
            </div>
          ) : products.length === 0 ? (
            <EmptyState />
          ) : visible.length === 0 ? (
            <div className="rounded-xl bg-card p-6 shadow-[var(--shadow-border)]">
              <p className="text-sm text-muted-foreground">No SKUs match this filter.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((product, i) => (
                <div
                  key={product.id}
                  className="latch-enter"
                  style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                >
                  <ProductCard
                    product={product}
                    tracked={trackedMap.get(product.sku)}
                    onToggle={() => toggleSku(product)}
                    onQuantity={(qty) =>
                      patch({
                        products: config.products.map((p) =>
                          p.sku === product.sku ? { ...p, quantity: qty } : p,
                        ),
                      })
                    }
                    onCheckout={() => void checkout(product.sku)}
                    checkoutBusy={busy === "checkout"}
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <h2 className="mb-3 text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Activity
            </h2>
            <ActivityLog events={snap?.events ?? []} />
          </div>
        </div>
      </section>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={config}
        onChange={patch}
        onTestTelegram={() => void sendTg()}
        telegramBusy={busy === "tg"}
        userProfile={hasActiveCookie ? snap?.userProfile : null}
        onProfileVerified={(profile) => {
          setSnap((prev) =>
            prev
              ? {
                  ...prev,
                  userProfile: profile,
                  sessionLoggedIn: Boolean(profile),
                  sessionImported: Boolean(profile),
                }
              : prev,
          );
          if (profile) {
            try {
              localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
            } catch {
              /* ignore */
            }
          } else {
            try {
              localStorage.removeItem(PROFILE_KEY);
            } catch {
              /* ignore */
            }
            setConfig((prev) => {
              const next = { ...prev, sessionCookie: "" };
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
              } catch {
                /* ignore */
              }
              return next;
            });
          }
        }}
        onDisconnect={handleDisconnectSession}
      />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex min-h-72 flex-col justify-end gap-6 rounded-xl bg-card p-6 shadow-[var(--shadow-border)] sm:p-8">
      <div>
        <p className="font-display text-2xl tracking-tight">Load a pincode to see live protein stock.</p>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Latch talks to shop.amul.com directly — no scrape, no always-on browser. The watcher uses
          adaptive polling so a small machine can sit on a restock without hammering the shop.
        </p>
      </div>
      <ol className="grid gap-3 text-sm sm:grid-cols-3">
        {[
          { n: "01", t: "Pincode", d: "Load the 6-digit pin Amul delivers to." },
          { n: "02", t: "Watch", d: "Pick SKUs and quantity. Auto-order is off until you enable it." },
          { n: "03", t: "Leave it", d: "Keep this desk open. It polls, then pauses only for real payment." },
        ].map((step) => (
          <li key={step.n} className="rounded-lg bg-muted px-4 py-3 shadow-[var(--shadow-border)]">
            <p className="font-mono text-xs text-subtle">{step.n}</p>
            <p className="mt-1 font-medium">{step.t}</p>
            <p className="mt-1 text-xs text-muted-foreground">{step.d}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-subtle">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-foreground tabular-nums">{value}</dd>
    </div>
  );
}

function PaymentBanner({
  checkout,
  onDismiss,
}: {
  checkout: NonNullable<WatchSnapshot["checkout"]>;
  onDismiss: () => void;
}) {
  const href = checkout.paymentUrl || checkout.shopUrl;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-card px-5 py-4 shadow-[var(--shadow-border)] sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {checkout.status === "awaiting_payment"
            ? "Payment approval required"
            : checkout.status === "success"
              ? "Order accepted"
              : checkout.status === "blocked"
                ? "Paused for Amul login"
                : "Checkout in progress"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{checkout.message}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {href ? (
          <Button asChild size="sm">
            <a href={href} target="_blank" rel="noreferrer">
              {checkout.paymentUrl ? "Open payment" : "Open Amul"}
            </a>
          </Button>
        ) : null}
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
