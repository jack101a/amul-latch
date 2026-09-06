import { useState, useRef, useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Phone,
  RefreshCw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  EXTERNAL_DOMAINS,
  type AppConfig,
  type UserProfileInfo,
  type SessionVerificationResult,
} from "@/lib/amul/types";
import {
  verifySessionCookie,
  requestLoginOtp,
  submitLoginOtp,
} from "@/lib/amul/actions";
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => void;
  onTestTelegram: () => void;
  telegramBusy?: boolean;
  userProfile?: UserProfileInfo | null;
  onProfileVerified?: (profile: UserProfileInfo | null) => void;
  onDisconnect?: () => Promise<void> | void;
};

type LoginTab = "otp" | "bookmarklet" | "cookie";

export function SettingsDialog({
  open,
  onOpenChange,
  config,
  onChange,
  onTestTelegram,
  telegramBusy,
  userProfile,
  onProfileVerified,
  onDisconnect,
}: Props) {
  const [activeTab, setActiveTab] = useState<LoginTab>("otp");
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<SessionVerificationResult | null>(null);

  // Phone OTP state
  const [phone, setPhone] = useState("");
  const [otpToken, setOtpToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpBusy, setOtpBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [disconnecting, setDisconnecting] = useState(false);

  const debounceTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  useEffect(() => {
    if (!config.sessionCookie.trim() || disconnecting) {
      setVerifyResult(null);
      return;
    }
    if (open && userProfile) {
      setVerifyResult({
        valid: true,
        loggedIn: true,
        profile: userProfile,
        message: "Active session",
      });
    }
  }, [open, userProfile, config.sessionCookie, disconnecting]);

  const runVerification = async (cookieStr: string) => {
    const clean = cookieStr.trim();
    if (!clean) {
      setVerifyResult(null);
      return;
    }
    setVerifying(true);
    try {
      const res = await verifySessionCookie({ data: { sessionCookie: clean } });
      setVerifyResult(res);
      if (res.valid && res.loggedIn && res.profile) {
        onProfileVerified?.(res.profile);
        toast.success(`Verified: ${res.profile.userName}`);
      } else if (res.valid && !res.loggedIn) {
        onProfileVerified?.(null);
        toast.warning("Guest session — log into shop.amul.com");
      } else {
        onProfileVerified?.(null);
        toast.error(res.message || "Invalid session cookie");
      }
    } catch (err) {
      setVerifyResult({
        valid: false,
        loggedIn: false,
        message: err instanceof Error ? err.message : "Verification request failed",
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleCookieInput = (val: string) => {
    onChange({ sessionCookie: val });
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      void runVerification(val);
    }, 500);
  };

  const handleSendOtp = async () => {
    const clean = phone.replace(/\D/g, "");
    if (clean.length < 10 && clean !== "9999999999") {
      toast.error("Please enter a valid 10-digit mobile number");
      return;
    }
    setOtpBusy(true);
    try {
      const res = await requestLoginOtp({ data: { phone: clean } });
      if (res.ok) {
        setOtpToken(res.token);
        setOtpSent(true);
        setCountdown(30);
        toast.success(res.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send OTP");
    } finally {
      setOtpBusy(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode.trim() || otpCode.trim().length < 4) {
      toast.error("Please enter the OTP code sent to your phone");
      return;
    }
    setOtpBusy(true);
    try {
      const res = await submitLoginOtp({ data: { token: otpToken, otp: otpCode.trim() } });
      if (res.ok) {
        onChange({ sessionCookie: res.sessionCookie });
        setVerifyResult({
          valid: true,
          loggedIn: true,
          profile: res.profile,
          message: res.message,
        });
        if (res.profile) {
          onProfileVerified?.(res.profile);
        }
        setOtpSent(false);
        setOtpCode("");
        setPhone("");
        toast.success(res.message);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "OTP verification failed");
    } finally {
      setOtpBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      setVerifyResult(null);
      setPhone("");
      setOtpToken("");
      setOtpCode("");
      setOtpSent(false);
      setCountdown(0);
      onChange({ sessionCookie: "" });
      onProfileVerified?.(null);
      if (onDisconnect) {
        await onDisconnect();
      } else {
        toast.info("Amul session disconnected");
      }
    } catch {
      toast.error("Failed to disconnect session");
    } finally {
      setDisconnecting(false);
    }
  };

  const bookmarkletHref = `javascript:(function(){const m=document.cookie.match(/jsessionid=([^;]+)/);if(m){window.open(location.origin.includes('amul.com')?'http://127.0.0.1:8082/?import_cookie='+encodeURIComponent(m[1]):alert('Please run this bookmarklet while browsing shop.amul.com!'))}else{alert('No active session found. Please log in on shop.amul.com first!')}})()`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl tracking-tight">Desk settings</DialogTitle>
          <DialogDescription className="text-xs">
            Secrets stay in this browser. Latch never stores UPI PIN, OTP, CVV, or bank passwords.
          </DialogDescription>
        </DialogHeader>

        {/* Order Automation Switches */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Auto-order on restock</p>
              <p className="text-xs text-muted-foreground">
                Starts checkout the moment a watched SKU flips in-stock. Stops at payment.
              </p>
            </div>
            <Switch
              checked={config.autoOrder}
              onCheckedChange={(v) => onChange({ autoOrder: v })}
              aria-label="Auto-order on restock"
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium">Order if already in stock</p>
              <p className="text-xs text-muted-foreground">
                Off by default so starting the watcher does not fire an accidental order.
              </p>
            </div>
            <Switch
              checked={config.orderIfAlreadyInStock}
              onCheckedChange={(v) => onChange({ orderIfAlreadyInStock: v })}
              aria-label="Order if already in stock"
            />
          </div>
        </section>

        <Separator />

        {/* Amul Account & Session Section */}
        <section className="flex flex-col gap-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-stock" />
              <p className="text-sm font-medium">Amul Account & Session</p>
            </div>
            {verifyResult?.profile?.userName ? (
              <Badge variant="stock" className="text-[10px] uppercase tracking-wider">
                {verifyResult.profile.userName}
              </Badge>
            ) : null}
          </div>

          {/* Verified Account Card (shown if connected) */}
          {verifyResult?.valid && verifyResult.loggedIn && verifyResult.profile ? (
            <div className="flex flex-col gap-2.5 rounded-lg border border-stock/30 bg-stock/10 p-3.5 text-xs text-foreground">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-medium text-stock">
                  <CheckCircle2 className="size-4" />
                  <span>Account Connected & Verified</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="stock" className="text-[10px] uppercase tracking-wider">
                    LOGGED IN
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDisconnect()}
                    disabled={disconnecting}
                    className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
                  >
                    {disconnecting ? "Disconnecting..." : "Disconnect"}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/40">
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Name</p>
                  <p className="font-medium text-foreground">{verifyResult.profile.userName}</p>
                </div>
                {verifyResult.profile.userPhone ? (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Mobile</p>
                    <p className="font-mono text-foreground">{verifyResult.profile.userPhone}</p>
                  </div>
                ) : verifyResult.profile.userEmail ? (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Email</p>
                    <p className="truncate text-foreground">{verifyResult.profile.userEmail}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">User ID</p>
                    <p className="font-mono text-foreground text-[11px] truncate">{verifyResult.profile.userId}</p>
                  </div>
                )}
              </div>

              {verifyResult.profile.defaultAddress ? (
                <div className="pt-1.5 border-t border-border/40">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                    Default Delivery Address
                  </p>
                  <p className="mt-0.5 text-foreground leading-snug font-medium">
                    {verifyResult.profile.defaultAddress.label}
                  </p>
                </div>
              ) : (
                <div className="pt-1.5 border-t border-border/40">
                  <p className="text-warn text-[11px]">
                    No saved delivery address found on this account. Please add one on shop.amul.com to enable auto-checkout.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* Method Selector Tabs */}
              <div className="flex rounded-lg bg-muted p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab("otp")}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-colors ${
                    activeTab === "otp"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Phone className="size-3.5" />
                  <span>Phone OTP (Auto)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("bookmarklet")}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-colors ${
                    activeTab === "bookmarklet"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <ExternalLink className="size-3.5" />
                  <span>1-Click Sync</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("cookie")}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition-colors ${
                    activeTab === "cookie"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <KeyRound className="size-3.5" />
                  <span>Manual Cookie</span>
                </button>
              </div>

              {/* Tab 1: Phone OTP (Automated) */}
              {activeTab === "otp" && (
                <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/40 p-3.5">
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-medium text-foreground">Log in with Phone & SMS OTP</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Just like logging into shop.amul.com. Enter your mobile number, receive the OTP on your phone, and Latch captures the session automatically.
                    </p>
                  </div>

                  {!otpSent ? (
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="amul-phone" className="text-xs">Mobile Number</Label>
                      <div className="flex gap-2">
                        <div className="flex h-10 items-center justify-center rounded-md border border-input bg-muted px-3 text-xs font-mono text-muted-foreground">
                          +91
                        </div>
                        <Input
                          id="amul-phone"
                          type="tel"
                          placeholder="9876543210"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleSendOtp();
                          }}
                          className="font-mono text-xs"
                          disabled={otpBusy}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => void handleSendOtp()}
                          disabled={otpBusy || !phone.trim()}
                          className="h-10 shrink-0 px-4"
                        >
                          {otpBusy ? (
                            <>
                              <LoaderCircle className="size-3.5 animate-spin mr-1.5" />
                              <span>Sending…</span>
                            </>
                          ) : (
                            <span>Send OTP</span>
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">
                          OTP sent to <strong className="text-foreground font-mono">+91 {phone}</strong>
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setOtpSent(false);
                            setOtpCode("");
                          }}
                          className="text-xs text-stock hover:underline"
                        >
                          Change
                        </button>
                      </div>

                      <div className="flex gap-2">
                        <Input
                          id="amul-otp"
                          type="text"
                          maxLength={6}
                          placeholder="Enter 6-digit OTP"
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleVerifyOtp();
                          }}
                          className="font-mono text-xs text-center tracking-widest text-base"
                          disabled={otpBusy}
                          autoFocus
                        />
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          onClick={() => void handleVerifyOtp()}
                          disabled={otpBusy || !otpCode.trim()}
                          className="h-10 shrink-0 px-4 bg-stock text-white hover:bg-stock/90"
                        >
                          {otpBusy ? (
                            <>
                              <LoaderCircle className="size-3.5 animate-spin mr-1.5" />
                              <span>Verifying…</span>
                            </>
                          ) : (
                            <span>Verify & Connect</span>
                          )}
                        </Button>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                        {countdown > 0 ? (
                          <span>Resend OTP in {countdown}s</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleSendOtp()}
                            disabled={otpBusy}
                            className="text-stock hover:underline flex items-center gap-1"
                          >
                            <RefreshCw className="size-3" /> Resend OTP
                          </button>
                        )}
                        <span className="text-[10px] opacity-70">Secured with shop.amul.com</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: 1-Click Bookmarklet */}
              {activeTab === "bookmarklet" && (
                <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-muted/40 p-3.5 text-xs">
                  <div className="flex flex-col gap-1">
                    <p className="font-medium text-foreground">1-Click Browser Sync</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Already logged into Amul in your browser? Sync your session with one click without typing or opening DevTools:
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 rounded bg-card p-3 border border-border/40">
                    <p className="text-[11px] text-muted-foreground font-mono">
                      <strong>Step 1:</strong> Drag this button to your Bookmarks Bar:
                    </p>
                    <div className="flex items-center gap-2">
                      <a
                        href={bookmarkletHref}
                        onClick={(e) => {
                          e.preventDefault();
                          toast.info("Drag this button to your Bookmarks Bar!");
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-stock/20 border border-stock/40 px-3 py-1.5 font-medium text-stock hover:bg-stock/30 cursor-grab active:cursor-grabbing text-xs"
                      >
                        <Sparkles className="size-3.5" />
                        <span>⚡ Sync to Latch</span>
                      </a>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard.writeText(bookmarkletHref);
                          toast.success("Bookmarklet code copied to clipboard!");
                        }}
                        className="h-8 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        <Copy className="size-3 mr-1" /> Copy Script
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground pt-1">
                      <strong>Step 2:</strong> Go to{" "}
                      <a
                        href="https://shop.amul.com"
                        target="_blank"
                        rel="noreferrer"
                        className="text-stock underline"
                      >
                        shop.amul.com
                      </a>
                      , make sure you are logged in, and click your new bookmark! It syncs your session into Latch instantly.
                    </p>
                  </div>
                </div>
              )}

              {/* Tab 3: Manual Cookie */}
              {activeTab === "cookie" && (
                <div className="flex flex-col gap-2.5">
                  <p className="text-xs text-muted-foreground">
                    For advanced users: copy <span className="font-mono text-foreground">jsessionid</span> from shop.amul.com cookies and paste it here.
                  </p>
                  <Label htmlFor="session">jsessionid</Label>
                  <div className="flex gap-2">
                    <Input
                      id="session"
                      type="password"
                      autoComplete="off"
                      placeholder="s:…"
                      value={config.sessionCookie}
                      onChange={(e) => handleCookieInput(e.target.value)}
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void runVerification(config.sessionCookie)}
                      disabled={verifying || !config.sessionCookie.trim()}
                      className="h-10 shrink-0 px-3.5"
                    >
                      {verifying ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3.5 text-stock" />
                      )}
                      <span>{verifying ? "Checking…" : "Verify"}</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Verification Feedback Banner */}
              {verifying ? (
                <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin text-stock" />
                  <span>Verifying account details with shop.amul.com…</span>
                </div>
              ) : verifyResult?.valid && !verifyResult.loggedIn ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs">
                  <AlertTriangle className="size-4 text-warn shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-0.5 text-muted-foreground">
                    <p className="font-medium text-warn">Guest session detected</p>
                    <p className="text-[11px] leading-relaxed">{verifyResult.message}</p>
                  </div>
                </div>
              ) : verifyResult && !verifyResult.valid ? (
                <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs">
                  <XCircle className="size-4 text-destructive shrink-0 mt-0.5" />
                  <div className="flex flex-col gap-0.5 text-muted-foreground">
                    <p className="font-medium text-destructive">Invalid or Expired Cookie</p>
                    <p className="text-[11px] leading-relaxed">{verifyResult.message}</p>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>

        <Separator />

        {/* Telegram Notifications */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-medium">Telegram Alerts</p>
            <Switch
              checked={config.telegramEnabled}
              onCheckedChange={(v) => onChange({ telegramEnabled: v })}
              aria-label="Enable Telegram"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bot-token">Bot token</Label>
              <Input
                id="bot-token"
                type="password"
                value={config.telegramBotToken}
                onChange={(e) => onChange({ telegramBotToken: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="chat">Chat id</Label>
              <Input
                id="chat"
                value={config.telegramChatId}
                onChange={(e) => onChange({ telegramChatId: e.target.value })}
              />
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={onTestTelegram}
            disabled={telegramBusy || !config.telegramBotToken || !config.telegramChatId}
          >
            Send test message
          </Button>
        </section>

        <Separator />

        {/* Polling Intervals */}
        <section className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Min poll (sec)"
            value={Math.round(config.pollMinMs / 1000)}
            min={3}
            max={60}
            onChange={(n) => onChange({ pollMinMs: n * 1000 })}
          />
          <NumberField
            label="Max poll (sec)"
            value={Math.round(config.pollMaxMs / 1000)}
            min={10}
            max={300}
            onChange={(n) => onChange({ pollMaxMs: n * 1000 })}
          />
          <NumberField
            label="Order cooldown (min)"
            value={Math.round(config.orderCooldownMs / 60000)}
            min={5}
            max={120}
            onChange={(n) => onChange({ orderCooldownMs: n * 60000 })}
          />
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

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => {
          const n = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="font-mono text-xs"
      />
    </div>
  );
}
