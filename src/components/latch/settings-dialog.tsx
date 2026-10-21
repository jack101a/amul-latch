import { useState, useRef, useEffect } from "react";
import { ArrowLeft, ExternalLink, LoaderCircle, Send, Volume2 } from "lucide-react";
import { EXTERNAL_DOMAINS, type AppConfig } from "@/lib/amul/types";
import { playRestockChime } from "@/lib/audio/chime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => void;
  onTestWhatsApp?: () => void;
  whatsappBusy?: boolean;
  onTestDiscord?: () => void;
  discordBusy?: boolean;
};

export function SettingsDialog({
  open,
  onOpenChange,
  config,
  onChange,
  onTestWhatsApp,
  whatsappBusy,
  onTestDiscord,
  discordBusy,
}: Props) {
  const pushedHashRef = useRef(false);

  // Intercept browser back button & Android back gesture to close modal instead of exiting site
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (open) {
      if (window.location.hash !== "#settings") {
        window.history.pushState({ modal: "settings" }, "", "#settings");
        pushedHashRef.current = true;
      }

      const onPopState = () => {
        pushedHashRef.current = false;
        onOpenChange(false);
      };

      window.addEventListener("popstate", onPopState);
      return () => {
        window.removeEventListener("popstate", onPopState);
      };
    } else {
      if (pushedHashRef.current && window.location.hash === "#settings") {
        pushedHashRef.current = false;
        window.history.back();
      }
    }
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader className="space-y-1">
          <div className="flex items-center justify-between pb-1">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors -ml-1 px-1.5 py-1 rounded hover:bg-muted/60 cursor-pointer"
            >
              <ArrowLeft className="size-3.5 text-stock" />
              <span className="font-medium">Back to desk</span>
            </button>
            <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">Settings</span>
          </div>
          <DialogTitle className="font-display text-2xl tracking-tight">Desk settings</DialogTitle>
          <DialogDescription className="text-xs">
            Restock radar settings. Latch never asks for your Amul account, payment details, or session.
          </DialogDescription>
        </DialogHeader>

        {/* Audio Alerts */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-medium text-foreground">Restock audio alert</p>
              <p className="text-xs text-muted-foreground">
                Plays a subtle chime when any watched SKU comes into stock.
              </p>
            </div>
            <Switch
              checked={config.soundEnabled ?? true}
              onCheckedChange={(v) => onChange({ soundEnabled: v })}
              aria-label="Restock audio chime"
            />
          </div>
          <div className="flex items-center">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => playRestockChime()}
              className="h-8 text-xs gap-1.5 text-foreground hover:text-foreground"
            >
              <Volume2 className="size-3.5 text-stock" />
              <span>Test chime</span>
            </Button>
          </div>
        </section>

        <Separator />

        {/* Discord Webhook Alerts */}
        <section className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">Discord Webhook Alerts</p>
                <Badge variant="stock" className="text-[10px] px-1.5 py-0 font-mono">
                  Recommended · 100% Free
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Instant rich notifications with product photos, price, stock counts, and 1-click buy links directly to your Discord channel.
              </p>
            </div>
            <Switch
              checked={config.discordEnabled ?? false}
              onCheckedChange={(v) => onChange({ discordEnabled: v })}
              aria-label="Enable Discord Webhook"
            />
          </div>

          <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">1-Minute Discord Setup:</span>
              <span className="text-[11px] font-mono text-stock">Zero sign-ups required</span>
            </div>
            <ol className="list-decimal list-inside space-y-1.5 pl-1 text-[11px] leading-relaxed">
              <li>In Discord (Desktop or Browser), go to your personal server channel.</li>
              <li>Right-click the channel (or tap the gear ⚙️ <strong className="text-foreground">Edit Channel</strong>) → <strong className="text-foreground">Integrations</strong>.</li>
              <li>Click <strong className="text-foreground">Webhooks</strong> → <strong className="text-foreground">New Webhook</strong> → click <strong className="text-foreground">Copy Webhook URL</strong>.</li>
              <li>Paste the URL below and click <strong className="text-foreground">Send test Discord alert</strong>.</li>
            </ol>
            <p className="text-[10px] text-muted-foreground/80 pt-1 border-t border-border/40 leading-normal">
              💡 Tip: Works on phones too! Install the Discord app on iOS or Android to get instant push notifications with rich cards whenever restocks occur.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="discord-webhook-url">Discord Webhook URL</Label>
            <Input
              id="discord-webhook-url"
              type="url"
              placeholder="https://discord.com/api/webhooks/..."
              value={config.discordWebhookUrl ?? ""}
              onChange={(e) => onChange({ discordWebhookUrl: e.target.value })}
              className="font-mono text-xs"
            />
            <span className="text-[10px] text-muted-foreground">
              Format: https://discord.com/api/webhooks/&#123;id&#125;/&#123;token&#125;
            </span>
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={onTestDiscord}
            disabled={discordBusy || !config.discordWebhookUrl}
            className="w-full sm:w-auto self-start text-xs font-mono gap-1.5"
          >
            {discordBusy ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin" />
                <span>Sending Discord test…</span>
              </>
            ) : (
              <>
                <Send className="size-3.5 text-stock" />
                <span>Send test Discord alert</span>
              </>
            )}
          </Button>
        </section>

        <Separator />

        {/* WhatsApp Alerts (CallMeBot) */}
        <section className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">WhatsApp Alerts (CallMeBot)</p>
                <Badge variant="default" className="text-[10px] px-1.5 py-0 font-mono text-muted-foreground border border-border/60">
                  Alternative
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Instant restock alerts sent directly to your personal WhatsApp. Zero access to your account required.
              </p>
            </div>
            <Switch
              checked={config.whatsappEnabled}
              onCheckedChange={(v) => onChange({ whatsappEnabled: v })}
              aria-label="Enable WhatsApp"
            />
          </div>

          <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-foreground">30-Second Setup:</span>
              <a
                href="https://www.callmebot.com/blog/free-api-whatsapp-messages/"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-stock hover:underline font-mono text-[11px]"
              >
                CallMeBot Live Status <ExternalLink className="size-3" />
              </a>
            </div>
            <ol className="list-decimal list-inside space-y-1.5 pl-1 text-[11px] leading-relaxed">
              <li>
                Open WhatsApp chat with the bot (tap{" "}
                <a
                  href="https://wa.me/34623786449?text=I%20allow%20callmebot%20to%20send%20me%20messages"
                  target="_blank"
                  rel="noreferrer"
                  className="text-stock hover:underline font-semibold"
                >
                  Bot #1 (+34 623 78 64 49)
                </a>{" "}
                or{" "}
                <a
                  href="https://wa.me/34644565349?text=I%20allow%20callmebot%20to%20send%20me%20messages"
                  target="_blank"
                  rel="noreferrer"
                  className="text-stock hover:underline font-semibold"
                >
                  Bot #2 (+34 644 56 53 49)
                </a>
                ) and send:
                <div className="mt-1">
                  <code className="rounded bg-card px-1.5 py-0.5 font-mono text-foreground select-all border border-border/50">
                    I allow callmebot to send me messages
                  </code>
                </div>
              </li>
              <li>Wait ~15s for the bot to reply with your personal <span className="text-foreground font-semibold">APIKEY</span>.</li>
              <li>Enter your phone number and that API Key below, then click Test.</li>
            </ol>
            <p className="text-[10px] text-muted-foreground/80 pt-1 border-t border-border/40 leading-normal">
              *Note: CallMeBot periodically rotates bot numbers or pauses new registrations when capacity is full (showing +34*********). If neither bot responds within 2 minutes, check the Live Status link above for the newest active number.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whatsapp-phone">WhatsApp phone number</Label>
              <Input
                id="whatsapp-phone"
                type="tel"
                placeholder="+919876543210"
                value={config.whatsappPhone}
                onChange={(e) => onChange({ whatsappPhone: e.target.value })}
              />
              <span className="text-[10px] text-muted-foreground">With country code (e.g. +91)</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="whatsapp-apikey">CallMeBot API Key</Label>
              <Input
                id="whatsapp-apikey"
                type="password"
                placeholder="e.g. 123456"
                value={config.whatsappApiKey}
                onChange={(e) => onChange({ whatsappApiKey: e.target.value })}
              />
              <span className="text-[10px] text-muted-foreground">Returned by the bot on activation</span>
            </div>
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={onTestWhatsApp}
            disabled={whatsappBusy || !config.whatsappPhone || !config.whatsappApiKey}
            className="w-full sm:w-auto self-start"
          >
            {whatsappBusy ? (
              <>
                <LoaderCircle className="mr-2 size-3.5 animate-spin" />
                Sending test message…
              </>
            ) : (
              "Send test WhatsApp message"
            )}
          </Button>
        </section>

        <Separator />

        {/* Polling Intervals */}
        <section className="flex flex-col gap-2.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <IntervalField
              label="Min poll interval"
              valueMs={config.pollMinMs}
              onChange={(ms) => onChange({ pollMinMs: ms })}
              allowHours
            />
            <IntervalField
              label="Max poll interval"
              valueMs={config.pollMaxMs}
              onChange={(ms) => onChange({ pollMaxMs: ms })}
              allowHours
            />
          </div>

          {/* Quick Timing Presets */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[11px] text-muted-foreground mr-1">Presets:</span>
            {[
              { label: "Flash (6s / 40s)", min: 6000, max: 40000 },
              { label: "Normal (15s / 2m)", min: 15000, max: 120000 },
              { label: "Relaxed (30m / 45m)", min: 30 * 60000, max: 45 * 60000 },
              { label: "Ultra-low (1h / 2h)", min: 60 * 60000, max: 120 * 60000 },
            ].map((p) => {
              const active = config.pollMinMs === p.min && config.pollMaxMs === p.max;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => onChange({ pollMinMs: p.min, pollMaxMs: p.max })}
                  className={cn(
                    "px-2 py-0.5 rounded text-[11px] font-mono border transition-colors cursor-pointer",
                    active
                      ? "border-stock/50 text-stock bg-stock/15 font-semibold"
                      : "border-border/70 bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <p className="text-[11px] text-muted-foreground">
            Enter any time value you want in seconds, minutes, or hours. Fast (6–15s) catches rapid restocks; relaxed (30–45m) minimizes checks.
          </p>
        </section>

        <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">External network activity</p>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            {EXTERNAL_DOMAINS.map((d) => (
              <li key={d.host}>
                {d.host} — {d.why}
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IntervalField({
  label,
  valueMs,
  onChange,
  allowHours = false,
}: {
  label: string;
  valueMs: number;
  onChange: (ms: number) => void;
  allowHours?: boolean;
}) {
  const defaultUnit =
    allowHours && valueMs >= 3600000 && valueMs % 3600000 === 0
      ? "hrs"
      : valueMs >= 60000 && valueMs % 60000 === 0
        ? "min"
        : "sec";

  const [unit, setUnit] = useState<"sec" | "min" | "hrs">(defaultUnit);

  useEffect(() => {
    if (allowHours && valueMs >= 3600000 && valueMs % 3600000 === 0) {
      setUnit("hrs");
    } else if (valueMs >= 60000 && valueMs % 60000 === 0) {
      setUnit("min");
    } else {
      setUnit("sec");
    }
  }, [valueMs, allowHours]);

  const displayVal =
    unit === "hrs"
      ? Math.round(valueMs / 3600000)
      : unit === "min"
        ? Math.round(valueMs / 60000)
        : Math.round(valueMs / 1000);

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex items-center rounded-md border border-border bg-input/20 focus-within:ring-1 focus-within:ring-ring overflow-hidden">
        <Input
          type="number"
          min={1}
          value={Number.isFinite(displayVal) && displayVal > 0 ? displayVal : ""}
          onChange={(e) => {
            const n = Number.parseInt(e.target.value, 10);
            if (Number.isFinite(n) && n > 0) {
              const mult = unit === "hrs" ? 3600000 : unit === "min" ? 60000 : 1000;
              onChange(n * mult);
            }
          }}
          className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 font-mono text-xs px-2.5 h-8 flex-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <select
          value={unit}
          onChange={(e) => {
            const nextUnit = e.target.value as "sec" | "min" | "hrs";
            setUnit(nextUnit);
            const currentMs = valueMs;
            const mult = nextUnit === "hrs" ? 3600000 : nextUnit === "min" ? 60000 : 1000;
            const n = Math.max(1, Math.round(currentMs / mult));
            onChange(n * mult);
          }}
          className="bg-muted/80 text-[11px] font-mono text-muted-foreground hover:text-foreground px-2 h-8 border-l border-border outline-none cursor-pointer"
        >
          <option value="sec">sec</option>
          <option value="min">min</option>
          {allowHours ? <option value="hrs">hrs</option> : null}
        </select>
      </div>
    </div>
  );
}
