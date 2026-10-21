import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowUpDown,
  ChevronDown,
  ExternalLink,
  Filter,
  LoaderCircle,
  MapPin,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  getWatchStatus,
  getServerConfig,
  resolvePincode,
  startWatcher,
  stopWatcher,
  testDiscord,
  testWhatsApp,
  tickWatcher,
  syncServerConfig,
} from "@/lib/amul/actions";
import {
  DEFAULT_CONFIG,
  type AmulProduct,
  type AppConfig,
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

const STANDARD_HUBS = [
  { city: "Mumbai", pin: "400068" },
  { city: "Ahmedabad", pin: "380009" },
  { city: "Bengaluru", pin: "560001" },
  { city: "Delhi", pin: "110001" },
] as const;

function formatPollingInterval(ms: number): string {
  if (ms >= 3600000) return `${(ms / 3600000).toFixed(1)}h`;
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

const STORAGE_KEY = "latch-config-v1";
const WATCH_KEY = "latch-watching-v1";

type SortMode = "default" | "value" | "price-asc" | "price-desc" | "name";

export function LatchDashboard() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [hydrated, setHydrated] = useState(false);
  const [snap, setSnap] = useState<WatchSnapshot | null>(null);
  const [catalog, setCatalog] = useState<AmulProduct[]>([]);
  const [pinInput, setPinInput] = useState(DEFAULT_CONFIG.pincode || "400068");
  const [query, setQuery] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activityDrawerOpen, setActivityDrawerOpen] = useState(false);
  const [inlineActivityOpen, setInlineActivityOpen] = useState(false);
  const [busy, setBusy] = useState<"pin" | "watch" | "whatsapp" | "discord" | null>(null);
  const [filter, setFilter] = useState<"all" | "watched" | "value" | "instock" | "out">("all");
  const [sort, setSort] = useState<SortMode>("default");
  const [mobileTab, setMobileTab] = useState<"catalog" | "watched" | "activity">("catalog");
  const [now, setNow] = useState(() => Date.now());

  const resumed = useRef(false);
  const seenEventIds = useRef<Set<string>>(new Set());
  const prevStockRef = useRef<Map<string, boolean>>(new Map());
  const initialMountRef = useRef(true);
  const lastChimeTime = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function initConfig() {
      let serverCfg: AppConfig | null = null;
      try {
        serverCfg = await getServerConfig();
      } catch {
        /* ignore */
      }

      let parsed: Partial<AppConfig> = {};
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) parsed = JSON.parse(raw) as Partial<AppConfig>;
      } catch {
        /* ignore */
      }

      const serverDiscord = serverCfg?.discordWebhookUrl?.trim() || "";
      const localDiscord = parsed.discordWebhookUrl?.trim() || "";
      const effectiveDiscord = localDiscord || serverDiscord;

      const serverPhone = serverCfg?.whatsappPhone?.trim() || "";
      const localPhone = parsed.whatsappPhone?.trim() || "";
      const effectivePhone = localPhone || serverPhone;

      const serverKey = serverCfg?.whatsappApiKey?.trim() || "";
      const localKey = parsed.whatsappApiKey?.trim() || "";
      const effectiveKey = localKey || serverKey;

      const next: AppConfig = {
        ...DEFAULT_CONFIG,
        ...(serverCfg || {}),
        pincode: parsed.pincode || serverCfg?.pincode || DEFAULT_CONFIG.pincode,
        products: parsed.products ?? serverCfg?.products ?? DEFAULT_CONFIG.products,
        soundEnabled: parsed.soundEnabled ?? serverCfg?.soundEnabled ?? DEFAULT_CONFIG.soundEnabled,
        whatsappEnabled:
          parsed.whatsappEnabled ??
          (serverCfg?.whatsappEnabled ?? Boolean(effectivePhone && effectiveKey)),
        whatsappPhone: effectivePhone,
        whatsappApiKey: effectiveKey,
        discordEnabled:
          parsed.discordEnabled ??
          (serverCfg?.discordEnabled ?? Boolean(effectiveDiscord)),
        discordWebhookUrl: effectiveDiscord,
        pollMinMs: parsed.pollMinMs ?? serverCfg?.pollMinMs ?? DEFAULT_CONFIG.pollMinMs,
        pollMaxMs: parsed.pollMaxMs ?? serverCfg?.pollMaxMs ?? DEFAULT_CONFIG.pollMaxMs,
        orderCooldownMs:
          parsed.orderCooldownMs ?? serverCfg?.orderCooldownMs ?? DEFAULT_CONFIG.orderCooldownMs,
      };

      if (!cancelled) {
        setConfig(next);
        setPinInput(next.pincode);
        setHydrated(true);
        void syncServerConfig({ data: { config: next } }).catch(() => undefined);
      }
    }

    void initConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void getWatchStatus()
      .then((s) => {
        if (!cancelled) {
          setSnap(s);
          if (s.products.length) setCatalog(s.products);
          if (s.config?.discordWebhookUrl && !config.discordWebhookUrl) {
            setConfig((prev) => ({
              ...prev,
              discordWebhookUrl: s.config?.discordWebhookUrl ?? prev.discordWebhookUrl,
              discordEnabled: s.config?.discordEnabled ?? prev.discordEnabled,
            }));
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hydrated, config.discordWebhookUrl]);

  useEffect(() => {
    if (!hydrated) return;
    // Smart status polling cadence:
    // If watching and has tracked products: 3000ms.
    // If idle, dormant, or empty watchlist: 12000ms (saves CPU, network, server memory).
    const isActivelyWatching = Boolean(snap?.watching && (config.products?.length || 0) > 0);
    const intervalMs = isActivelyWatching ? 3000 : 12000;

    const id = window.setInterval(() => {
      // If tab is in background and idle, skip polling
      if (typeof document !== "undefined" && document.hidden && !isActivelyWatching) {
        return;
      }
      void getWatchStatus()
        .then((s) => {
          setSnap(s);
          if (s.products.length) setCatalog(s.products);
        })
        .catch(() => undefined);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [hydrated, snap?.watching, config.products?.length]);

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
    if (!snap?.watching || !config.products?.length) return;
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

  useEffect(() => {
    if (!snap?.watching) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "Restock watcher is actively polling Amul. Leaving will pause monitoring.";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [snap?.watching]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "/" &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === "Escape") {
        if (activityDrawerOpen) setActivityDrawerOpen(false);
        else if (query) setQuery("");
      }
      if (
        (e.key === "a" || e.key === "A") &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        setActivityDrawerOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activityDrawerOpen, query]);

  const patch = (partial: Partial<AppConfig>) => {
    setConfig((c) => {
      const next = { ...c, ...partial };
      void syncServerConfig({ data: { config: partial } }).catch(() => undefined);
      return next;
    });
  };

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

  useEffect(() => {
    if (!snap) return;

    if (initialMountRef.current) {
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
    for (const ev of snap.events) {
      if (!seenEventIds.current.has(ev.id)) {
        seenEventIds.current.add(ev.id);
        if (ev.kind === "restock") {
          restockDetected = true;
        }
      }
    }

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

  const visible = useMemo(() => {
    let list = products.filter((p) => {
      if (mobileTab === "watched" || filter === "watched") {
        if (!trackedMap.has(p.sku)) return false;
      }
      if (filter === "out" && p.inStock) return false;
      if (filter === "instock" && !p.inStock) return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      }
      return true;
    });

    return list.slice().sort((a, b) => {
      if (sort === "value" || filter === "value") {
        if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
        const aCost = a.costPerGramProtein ?? Infinity;
        const bCost = b.costPerGramProtein ?? Infinity;
        if (aCost !== bCost) return aCost - bCost;
        return a.name.localeCompare(b.name);
      }
      if (sort === "price-asc") {
        return a.price - b.price;
      }
      if (sort === "price-desc") {
        return b.price - a.price;
      }
      if (sort === "name") {
        return a.name.localeCompare(b.name);
      }
      const aw = trackedMap.has(a.sku) ? 0 : 1;
      const bw = trackedMap.has(b.sku) ? 0 : 1;
      if (aw !== bw) return aw - bw;
      if (a.inStock !== b.inStock) return a.inStock ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [products, filter, sort, mobileTab, query, trackedMap]);

  const watching = Boolean(snap?.watching);
  const nextInSec =
    watching && snap?.lastTickAt
      ? Math.max(0, Math.round((Date.parse(snap.lastTickAt) + snap.nextPollMs - now) / 1000))
      : null;

  const quickHubs = STANDARD_HUBS;

  async function loadPincode(overridePin?: string) {
    if (overridePin) {
      setPinInput(overridePin);
    }
    const pin = (overridePin ?? pinInput).trim();
    if (!/^\d{6}$/.test(pin)) {
      toast.error("Enter a valid 6-digit pincode");
      return;
    }
    setBusy("pin");
    try {
      const result = await resolvePincode({ data: { pincode: pin } });
      patch({ pincode: pin });
      setCatalog(result.products);
      toast.success(`Connected to ${result.substore.name} (${result.products.length} SKUs)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reach Amul for this pincode");
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
        toast.info("Watcher paused");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not pause watcher");
      } finally {
        setBusy(null);
      }
      return;
    }
    if (!config.pincode) {
      toast.error("Please load a pincode first");
      return;
    }
    if (!config.products.length) {
      toast.error("Watch at least one SKU to start monitoring");
      return;
    }
    setBusy("watch");
    try {
      const next = await startWatcher({ data: { config } });
      localStorage.setItem(WATCH_KEY, "1");
      setSnap(next);
      toast.success("Amul restock radar is active!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start watcher");
    } finally {
      setBusy(null);
    }
  }

  function toggleSku(product: AmulProduct) {
    const exists = trackedMap.get(product.sku);
    if (exists) {
      patch({ products: config.products.filter((p) => p.sku !== product.sku) });
      toast.info(`Removed ${product.name.split(" ")[0]} from watchlist`);
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
    toast.success(`Watching ${product.name.split(" ")[0]}`);
  }

  async function sendWhatsAppTest() {
    setBusy("whatsapp");
    try {
      const result = await testWhatsApp({
        data: { phone: config.whatsappPhone, apiKey: config.whatsappApiKey },
      });
      if (result.ok) toast.success("WhatsApp test alert sent! Check your phone.");
      else toast.error(result.error || "WhatsApp test failed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "WhatsApp test failed");
    } finally {
      setBusy(null);
    }
  }

  async function sendDiscordTest() {
    if (!config.discordWebhookUrl.trim()) {
      toast.error("Enter a Discord webhook URL first");
      return;
    }
    setBusy("discord");
    try {
      const result = await testDiscord({
        data: { webhookUrl: config.discordWebhookUrl },
      });
      if (result.ok) toast.success("Discord test alert sent! Check your Discord channel.");
      else toast.error(result.error || "Discord test failed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Discord test failed");
    } finally {
      setBusy(null);
    }
  }

  const inStockTotal = products.filter((p) => p.inStock).length;
  const inStockWatched = config.products.filter(
    (t) => products.find((p) => p.sku === t.sku)?.inStock,
  ).length;
  const outCount = products.filter((p) => !p.inStock).length;

  return (
    <div className="min-h-dvh flex flex-col bg-background text-foreground pb-20 sm:pb-12">
      {/* 1. Industrial Precision Header */}
      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          {/* Brand & Live Radar Pill */}
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex flex-col">
              <span className="font-mono text-[9px] sm:text-[10px] tracking-[0.24em] uppercase text-stock font-bold leading-none">
                AMUL PROTEIN RADAR
              </span>
              <span className="font-display text-2xl sm:text-3xl tracking-tight text-foreground leading-none mt-1">
                Latch
              </span>
            </div>

            {/* Radar Heartbeat Pill */}
            <div
              className={cn(
                "hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-mono transition-colors",
                watching
                  ? "bg-stock/10 border-stock/40 text-stock"
                  : "bg-muted/40 border-border/60 text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  watching
                    ? "bg-stock animate-pulse shadow-[0_0_8px_#6f8f6a]"
                    : "bg-muted-foreground/40",
                )}
              />
              <span className="font-semibold">
                {watching ? `RADAR ACTIVE${nextInSec !== null ? ` · ${nextInSec}s` : ""}` : "STANDBY"}
              </span>
            </div>
          </div>

          {/* Header Actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {/* Restock Sound Chime Toggle */}
            <button
              type="button"
              onClick={() => {
                const next = !config.soundEnabled;
                patch({ soundEnabled: next });
                if (next) {
                  playRestockChime();
                  toast.success("Restock sonar chime enabled");
                } else {
                  toast.info("Restock audio muted");
                }
              }}
              className={cn(
                "flex size-9 items-center justify-center rounded-lg border transition-colors cursor-pointer shrink-0",
                config.soundEnabled
                  ? "border-border bg-muted/60 text-foreground hover:bg-muted"
                  : "border-border/50 bg-transparent text-muted-foreground/50 hover:text-muted-foreground",
              )}
              title={config.soundEnabled ? "Audio chime active (click to mute)" : "Audio chime muted (click to enable)"}
              aria-label="Toggle audio chime"
            >
              {config.soundEnabled ? <Volume2 className="size-4 text-stock" /> : <VolumeX className="size-4" />}
            </button>

            {/* Live Telemetry Radar Drawer Button */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setActivityDrawerOpen(true)}
              className="hidden sm:flex items-center gap-2 h-9 border-border/70 bg-card hover:bg-muted font-mono text-xs text-muted-foreground hover:text-foreground shrink-0"
              title="Open Activity Radar (Shortcut: A)"
            >
              <Radio className="size-3.5 text-stock animate-pulse" />
              <span>Activity</span>
              {(snap?.events?.length ?? 0) > 0 ? (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-foreground">
                  {snap?.events?.length}
                </span>
              ) : null}
            </Button>

            {/* Settings Dialog Trigger */}
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setSettingsOpen(true)}
              className="size-9 border-border/70 bg-card hover:bg-muted text-muted-foreground hover:text-foreground relative shrink-0"
              aria-label="Settings"
            >
              <Settings2 className="size-4" />
            </Button>

            {/* Main Watcher Lever Button */}
            <Button
              type="button"
              variant={watching ? "secondary" : "default"}
              onClick={() => void toggleWatch()}
              disabled={busy === "watch"}
              className={cn(
                "h-9 px-3 sm:px-4 font-medium text-xs tracking-wide uppercase transition-all shadow-sm shrink-0",
                watching
                  ? "bg-muted text-destructive hover:bg-destructive/15 border border-destructive/30"
                  : "bg-primary text-primary-foreground hover:bg-primary/90 font-bold",
              )}
            >
              {busy === "watch" ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : watching ? (
                <Square className="size-3 fill-current mr-1 sm:mr-1.5" />
              ) : (
                <Radio className="size-3.5 mr-1 sm:mr-1.5 animate-pulse" />
              )}
              {watching ? (
                <>
                  <span>Pause</span>
                  <span className="hidden sm:inline"> Radar</span>
                </>
              ) : (
                <>
                  <span className="sm:hidden">Watch</span>
                  <span className="hidden sm:inline">Start Watching</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="mx-auto max-w-7xl w-full px-4 sm:px-6 pt-5 sm:pt-6 flex flex-col gap-6">
        {/* 2. Top Bento Command Deck */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Bento Tile 1: Delivery Hub Matrix (7 cols) */}
          <div className="lg:col-span-7 rounded-xl bg-card border border-border/70 p-4 sm:p-5 shadow-[var(--shadow-border)] flex flex-col justify-between gap-4">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                  <MapPin className="size-3 text-stock" />
                  Delivery Destination & Substore
                </span>
                {snap?.substore?.name ? (
                  <span className="text-[11px] font-mono text-stock bg-stock/15 px-2 py-0.5 rounded border border-stock/30 font-medium">
                    {snap.substore.name} ({config.pincode})
                  </span>
                ) : null}
              </div>

              {/* Form Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadPincode();
                }}
                className="flex items-center gap-2"
              >
                <div className="relative flex-1">
                  <Input
                    id="pincode"
                    inputMode="numeric"
                    pattern="\d{6}"
                    maxLength={6}
                    placeholder="Enter 6-digit Pincode (e.g. 560001)"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="h-10 pl-3 font-mono tracking-widest text-sm bg-muted/40 border-border/70"
                  />
                </div>
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={busy === "pin"}
                  className="h-10 px-4 font-mono text-xs font-semibold bg-muted hover:bg-muted/80 text-foreground border border-border/60"
                >
                  {busy === "pin" ? <LoaderCircle className="size-3.5 animate-spin mr-1" /> : null}
                  Resolve Hub
                </Button>
              </form>
            </div>

            {/* Quick Hubs Chips */}
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border/40">
              <span className="text-[11px] font-mono text-muted-foreground mr-1">Major Hubs:</span>
              {quickHubs.map((hub) => {
                const isActive = config.pincode === hub.pin;
                return (
                  <button
                    key={hub.pin}
                    type="button"
                    disabled={busy === "pin"}
                    onClick={() => void loadPincode(hub.pin)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-mono border transition-all cursor-pointer flex items-center gap-1.5",
                      isActive
                        ? "border-stock/50 text-stock bg-stock/15 font-semibold shadow-xs"
                        : "border-border/60 bg-muted/30 hover:bg-muted text-muted-foreground hover:text-foreground",
                      busy === "pin" && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <span>{hub.city}</span>
                    <span className="text-[10px] text-muted-foreground/70">{hub.pin}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bento Tile 2: Live Telemetry Gauges (5 cols) */}
          <div className="lg:col-span-5 rounded-xl bg-card border border-border/70 p-4 sm:p-5 shadow-[var(--shadow-border)] flex flex-col justify-between gap-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <Zap className="size-3 text-stock" />
                Console Metrics
              </span>
              <span className="text-[11px] font-mono text-muted-foreground">
                {snap?.lastTickAt ? `Updated ${formatDistanceToNow(new Date(snap.lastTickAt), { addSuffix: true })}` : "Standby"}
              </span>
            </div>

            {/* 4 Precision Metric Cells */}
            <div className="grid grid-cols-2 gap-2.5">
              {/* In Stock */}
              <div className="rounded-lg bg-muted/40 border border-border/50 p-2.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block">
                  In Stock (Live)
                </span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="font-mono text-xl font-bold text-stock tabular-nums">
                    {inStockTotal}
                  </span>
                  <span className="text-xs text-muted-foreground">/ {products.length} SKUs</span>
                </div>
              </div>

              {/* Watched */}
              <div
                onClick={() => setFilter(filter === "watched" ? "all" : "watched")}
                className="rounded-lg bg-muted/40 border border-border/50 p-2.5 cursor-pointer hover:border-border transition-colors"
                title="Click to toggle watched filter"
              >
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block">
                  Watchlist Armed
                </span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="font-mono text-xl font-bold text-foreground tabular-nums">
                    {config.products.length}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({inStockWatched} ready)
                  </span>
                </div>
              </div>

              {/* Polling Interval */}
              <div
                onClick={() => setSettingsOpen(true)}
                className="rounded-lg bg-muted/40 border border-border/50 p-2.5 cursor-pointer hover:border-border transition-colors"
                title="Click to adjust polling intervals"
              >
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block">
                  Polling Interval
                </span>
                <div className="mt-1 flex items-center gap-1.5">
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      watching ? "bg-stock animate-pulse" : "bg-muted-foreground/60",
                    )}
                  />
                  <span
                    className={cn(
                      "text-xs font-mono font-semibold tabular-nums",
                      watching ? "text-stock" : "text-muted-foreground",
                    )}
                  >
                    {watching
                      ? formatPollingInterval(snap?.nextPollMs ?? config.pollMinMs)
                      : "Standby"}
                  </span>
                </div>
              </div>

              {/* Hub Substore */}
              <div className="rounded-lg bg-muted/40 border border-border/50 p-2.5">
                <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground block">
                  Hub Substore
                </span>
                <div className="mt-1 flex items-center gap-1.5 truncate">
                  <MapPin className="size-3 text-stock shrink-0" />
                  <span className="text-xs font-medium text-foreground truncate">
                    {snap?.substore?.name || (config.pincode ? config.pincode : "Not set")}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Toolbar: Search, Filters & Sorters */}
        <section className="flex flex-col gap-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: "all", label: `All (${products.length})` },
                { id: "value", label: "Best Value (₹/g)" },
                { id: "instock", label: `In Stock (${inStockTotal})` },
                { id: "watched", label: `Watched (${config.products.length})` },
                { id: "out", label: `Out of Stock (${outCount})` },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id as typeof filter)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer border",
                    filter === id
                      ? "bg-primary text-primary-foreground border-primary font-semibold shadow-xs"
                      : "bg-card border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted/60",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Right: Search + Sort selector */}
            <div className="flex items-center gap-2">
              {/* Search Bar */}
              <div className="relative flex-1 sm:w-64">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-subtle" />
                <Input
                  ref={searchInputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter SKUs... (press /)"
                  className="h-9 pl-8 pr-7 text-xs font-mono bg-card border-border/70"
                  aria-label="Filter products"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    <X className="size-3.5" />
                  </button>
                ) : (
                  <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-border bg-muted/60 px-1 font-mono text-[10px] text-muted-foreground">
                    /
                  </kbd>
                )}
              </div>

              {/* Sort Selector */}
              <div className="relative">
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortMode)}
                  className="h-9 appearance-none rounded-lg border border-border/70 bg-card px-3 pr-8 text-xs font-mono text-foreground hover:bg-muted/60 cursor-pointer focus:outline-none"
                  aria-label="Sort products"
                >
                  <option value="default">Sort: Priority</option>
                  <option value="value">Sort: Lowest ₹/g</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                  <option value="name">Name A-Z</option>
                </select>
                <ArrowUpDown className="pointer-events-none absolute top-1/2 right-2.5 size-3 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>
          </div>
        </section>

        {/* 4. Products Grid */}
        {busy === "pin" && products.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-card border border-border/70 p-12 text-center">
            <LoaderCircle className="size-8 text-stock animate-spin mb-3" />
            <p className="font-display text-2xl tracking-tight text-foreground">Talking to Amul…</p>
            <p className="mt-1 text-xs font-mono text-muted-foreground">
              Resolving substore routing and loading real-time protein catalog.
            </p>
          </div>
        ) : products.length === 0 ? (
          <EmptyState onQuickPick={(pin) => void loadPincode(pin)} />
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-card border border-border/70 p-12 text-center">
            <Filter className="size-8 text-subtle mb-3" />
            <p className="font-display text-xl text-foreground">No SKUs match this filter</p>
            <p className="mt-1 text-xs font-mono text-muted-foreground">
              Try clearing your search query or selecting "All" to view all available products.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setFilter("all");
                setQuery("");
              }}
              className="mt-4 text-xs font-mono"
            >
              Reset Filters
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {visible.map((product, i) => (
              <div
                key={product.id}
                className="latch-enter"
                style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}
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
                />
              </div>
            ))}
          </div>
        )}

        {/* 5. Collapsible Inline Telemetry Section */}
        <div className="rounded-xl border border-border/70 bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setInlineActivityOpen((prev) => !prev)}
            className="w-full flex items-center justify-between p-4 bg-muted/20 hover:bg-muted/40 transition-colors text-left cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Radio className="size-4 text-stock animate-pulse" />
              <span className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">
                Telemetry Log & Radar Events
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                ({snap?.events?.length ?? 0} recorded)
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
              <span>{inlineActivityOpen ? "Collapse" : "Expand Stream"}</span>
              <ChevronDown
                className={cn(
                  "size-4 transition-transform duration-200",
                  inlineActivityOpen && "rotate-180",
                )}
              />
            </div>
          </button>

          {inlineActivityOpen ? (
            <div className="p-4 border-t border-border/60">
              <ActivityLog events={snap?.events ?? []} />
            </div>
          ) : null}
        </div>

        {/* 6. Footer & Non-Custodial Safety Guarantee */}
        <footer className="mt-8 pt-6 border-t border-border/40 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-stock shrink-0" />
            <p className="text-[11px] leading-relaxed">
              <strong className="text-foreground">Zero-Auth Restock Radar:</strong> Latch only reads
              public stock and pincode data. No account, checkout, or payment access.
            </p>
          </div>
          <div className="flex items-center gap-4 text-[11px] font-mono shrink-0">
            <span>Adaptive Polling</span>
            <span>·</span>
            <span>Self-Hosted</span>
            <span>·</span>
            <a
              href="https://shop.amul.com"
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground flex items-center gap-1"
            >
              Amul Store <ExternalLink className="size-3" />
            </a>
          </div>
        </footer>
      </main>

      {/* 7. Slide-Over Activity Radar Drawer */}
      {activityDrawerOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-xs transition-opacity"
            onClick={() => setActivityDrawerOpen(false)}
          />

          <div className="relative w-full max-w-md bg-card border-l border-border h-full flex flex-col shadow-2xl z-10 latch-enter">
            <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <Radio className="size-4 text-stock animate-pulse" />
                <h2 className="font-mono text-sm font-semibold uppercase tracking-wider text-foreground">
                  Live Radar Telemetry
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setActivityDrawerOpen(false)}
                className="size-8 flex items-center justify-center rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                aria-label="Close activity radar"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <ActivityLog events={snap?.events ?? []} />
            </div>

            <div className="p-4 border-t border-border bg-muted/20 text-center">
              <p className="text-[11px] font-mono text-muted-foreground">
                Press <kbd className="px-1 border rounded bg-card">Esc</kbd> to close · Updates stream automatically
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {/* 8. Settings Dialog */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        config={config}
        onChange={patch}
        onTestDiscord={() => void sendDiscordTest()}
        discordBusy={busy === "discord"}
        onTestWhatsApp={() => void sendWhatsAppTest()}
        whatsappBusy={busy === "whatsapp"}
      />

      {/* 9. Mobile Bottom Navigation Bar (sm:hidden) */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-md px-4 py-2 flex items-center justify-around">
        <button
          type="button"
          onClick={() => {
            setMobileTab("catalog");
            setFilter("all");
          }}
          className={cn(
            "flex flex-col items-center gap-1 text-[10px] font-mono py-1 px-3 rounded-md transition-colors cursor-pointer",
            mobileTab === "catalog" && filter !== "watched"
              ? "text-stock font-bold"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Search className="size-4" />
          <span>Catalog</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setMobileTab("watched");
            setFilter("watched");
          }}
          className={cn(
            "flex flex-col items-center gap-1 text-[10px] font-mono py-1 px-3 rounded-md transition-colors cursor-pointer relative",
            filter === "watched"
              ? "text-stock font-bold"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Zap className="size-4" />
          <span>Watch ({config.products.length})</span>
          {inStockWatched > 0 ? (
            <span className="absolute top-0 right-1 size-1.5 rounded-full bg-stock animate-pulse" />
          ) : null}
        </button>

        <button
          type="button"
          onClick={() => setActivityDrawerOpen(true)}
          className="flex flex-col items-center gap-1 text-[10px] font-mono py-1 px-3 rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <Radio className="size-4" />
          <span>Activity</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex flex-col items-center gap-1 text-[10px] font-mono py-1 px-3 rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer relative"
        >
          <Settings2 className="size-4" />
          <span>Settings</span>
        </button>
      </nav>
    </div>
  );
}

function EmptyState({ onQuickPick }: { onQuickPick: (pin: string) => void }) {
  return (
    <div className="flex flex-col justify-end gap-6 rounded-xl bg-card border border-border/70 p-6 sm:p-8 shadow-[var(--shadow-border)]">
      <div>
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-stock/15 border border-stock/30 text-stock text-xs font-mono font-medium mb-3">
          <Sparkles className="size-3.5" />
          Zero Scraping · Direct Shop API
        </div>
        <h2 className="font-display text-2xl sm:text-3xl tracking-tight text-foreground">
          Enter your delivery pincode to discover live protein inventory.
        </h2>
        <p className="mt-2 max-w-xl text-xs sm:text-sm text-muted-foreground leading-relaxed">
          Latch connects directly to Amul regional substores to index live whey protein, blueberry shakes,
          lassi, buttermilk, and high-protein paneer inventory with adaptive restock polling.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 text-xs">
        <div
          onClick={() => onQuickPick("400068")}
          className="rounded-lg bg-muted/50 hover:bg-muted border border-border/60 p-4 transition-all cursor-pointer group"
        >
          <p className="font-mono text-xs text-stock font-semibold">01 · SELECT HUB</p>
          <p className="mt-1 font-medium text-foreground text-sm">Mumbai (400068)</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Mumbai West & Central distribution depot with full protein catalog.
          </p>
        </div>

        <div
          onClick={() => onQuickPick("380009")}
          className="rounded-lg bg-muted/50 hover:bg-muted border border-border/60 p-4 transition-all cursor-pointer group"
        >
          <p className="font-mono text-xs text-stock font-semibold">02 · SELECT HUB</p>
          <p className="mt-1 font-medium text-foreground text-sm">Ahmedabad (380009)</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Gujarat HQ substore with frequent chocolate & vanilla whey restocks.
          </p>
        </div>

        <div
          onClick={() => onQuickPick("560001")}
          className="rounded-lg bg-muted/50 hover:bg-muted border border-border/60 p-4 transition-all cursor-pointer group"
        >
          <p className="font-mono text-xs text-stock font-semibold">03 · SELECT HUB</p>
          <p className="mt-1 font-medium text-foreground text-sm">Bengaluru (560001)</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            South India distribution depot for instant restock monitoring.
          </p>
        </div>
      </div>
    </div>
  );
}


