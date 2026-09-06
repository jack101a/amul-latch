import { useState, useRef, useEffect } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Laptop,
  LoaderCircle,
  Phone,
  RefreshCw,
  Smartphone,
  Sparkles,
  Volume2,
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
import { cn, copyTextToClipboard } from "@/lib/utils";

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
  const [origin, setOrigin] = useState("");
  const [isMobile, setIsMobile] = useState(false);
  const [showAndroidGuide, setShowAndroidGuide] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setOrigin(window.location.origin);
      const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent);
      setIsMobile(mobile);
      if (mobile) setShowAndroidGuide(true);
    }
  }, []);

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

  const latchOrigin = origin || (typeof window !== "undefined" ? window.location.origin : "http://127.0.0.1:8082");
  const bookmarkletHref = `javascript:(function(){const m=document.cookie.match(/jsessionid=([^;]+)/i);if(m){const targetUrl='${latchOrigin}/?import_cookie='+encodeURIComponent(m[1]);if(location.origin.includes('amul.com')){try{const w=window.open(targetUrl,'_blank');if(!w||w.closed||typeof w.closed==='undefined'){window.location.href=targetUrl;}}catch(e){window.location.href=targetUrl;}}else{alert('Please run this bookmarklet while browsing shop.amul.com!');}}else{alert('No active session found. Please log in on shop.amul.com first!')}})()`;

  const [copiedScript, setCopiedScript] = useState(false);

  const handleCopyScript = async () => {
    const ok = await copyTextToClipboard(bookmarkletHref);
    if (ok) {
      setCopiedScript(true);
      toast.success("Bookmarklet code copied to clipboard!");
      setTimeout(() => setCopiedScript(false), 2500);
    } else {
      toast.info("Browser blocked clipboard copy. Tap the script box to select & copy.");
    }
  };

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
                <div className="pt-1.5 border-t border-border/40 space-y-1">
                  <p className="text-warn text-[11px] font-medium">
                    No saved delivery address found on this Amul account.
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-normal">
                    <strong>Is an address needed?</strong> Only if you enable <em>Auto-order on restock</em>. Stock tracking, audio chimes, and Telegram alerts work 100% without any saved address.
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
                      Already logged into Amul in your browser? Sync your session with one click:
                    </p>
                  </div>

                  {/* Mobile Advisory Card */}
                  <div className="flex flex-col gap-2 rounded-lg border border-stock/30 bg-stock/10 p-3 text-xs">
                    <div className="flex items-start gap-2.5">
                      <Smartphone className="size-4 shrink-0 text-stock mt-0.5" />
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-foreground text-xs">Using Android or iPhone?</p>
                          <Badge variant="stock" className="text-[10px] border border-stock/40 py-0 px-1.5 font-mono">
                            Recommended
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                          Mobile browsers don't have a bookmark bar for drag-and-drop. The fastest way to sync on mobile is <strong>Phone OTP (Auto)</strong> — get SMS OTP and sign in directly!
                        </p>
                        <div className="pt-0.5 flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => setActiveTab("otp")}
                            className="h-7 text-xs bg-stock text-black font-semibold hover:bg-stock/90 transition-colors"
                          >
                            <Phone className="size-3 mr-1" />
                            Switch to Phone OTP
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowAndroidGuide(!showAndroidGuide)}
                            className="h-7 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
                          >
                            {showAndroidGuide ? "Hide Android Chrome steps" : "How to run script on Android Chrome"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Android Chrome Step-by-Step Guide */}
                  {showAndroidGuide && (
                    <div className="flex flex-col gap-2 rounded bg-card p-3 border border-border/60 text-[11px]">
                      <div className="flex items-center justify-between pb-1.5 border-b border-border/40">
                        <p className="font-semibold text-foreground flex items-center gap-1.5">
                          <Smartphone className="size-3.5 text-stock" />
                          Android Chrome Setup (6 Steps):
                        </p>
                        <Button
                          type="button"
                          variant={copiedScript ? "default" : "outline"}
                          size="sm"
                          onClick={() => void handleCopyScript()}
                          className={cn(
                            "h-6 px-2 text-[10px] border-border/70 text-foreground transition-all cursor-pointer",
                            copiedScript && "bg-stock text-black border-stock hover:bg-stock/90 font-semibold"
                          )}
                        >
                          {copiedScript ? (
                            <>
                              <Check className="size-3 mr-1" /> Copied!
                            </>
                          ) : (
                            <>
                              <Copy className="size-3 mr-1" /> Copy Script
                            </>
                          )}
                        </Button>
                      </div>

                      <ol className="space-y-1.5 text-muted-foreground list-decimal list-inside leading-relaxed text-[11px]">
                        <li>
                          Tap <strong className="text-foreground">Copy Script</strong> above (or tap inside the script box below to select).
                        </li>
                        <li>
                          Open{" "}
                          <a
                            href="https://shop.amul.com"
                            target="_blank"
                            rel="noreferrer"
                            className="text-stock underline font-medium"
                          >
                            shop.amul.com
                          </a>{" "}
                          in Chrome and ensure you are logged in.
                        </li>
                        <li>
                          Tap Chrome menu (<strong>⋮</strong> three dots) → tap the <strong>⭐ Star</strong> to bookmark the page.
                        </li>
                        <li>
                          Tap <strong>Edit</strong> on the bookmark popup (or open Chrome Menu → <strong>Bookmarks</strong> → tap <strong>⋮</strong> on the bookmark → <strong>Edit</strong>).
                        </li>
                        <li>
                          Change Name to <code className="font-mono text-foreground font-semibold px-1 py-0.5 rounded bg-muted">sync</code>, delete the URL, and <strong className="text-foreground">Paste</strong> the copied script. Save it.
                        </li>
                        <li>
                          While on <span className="text-foreground font-mono">shop.amul.com</span>, tap the Chrome URL bar, type <code className="font-mono text-foreground font-semibold px-1 py-0.5 rounded bg-muted">sync</code>, and tap the bookmark suggestion!
                        </li>
                      </ol>

                      {/* Interactive Tap-to-Select Script Box for Mobile */}
                      <div className="mt-2 pt-2 border-t border-border/40 flex flex-col gap-1">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="font-medium text-foreground">Sync Script (Tap to select & copy):</span>
                          {copiedScript ? (
                            <span className="text-stock flex items-center gap-1 font-medium">
                              <Check className="size-3" /> Copied!
                            </span>
                          ) : (
                            <span className="text-[10px] opacity-70">Tap box to select all</span>
                          )}
                        </div>
                        <textarea
                          readOnly
                          value={bookmarkletHref}
                          onClick={(e) => {
                            e.currentTarget.focus();
                            e.currentTarget.select();
                            void handleCopyScript();
                          }}
                          rows={2}
                          className="w-full rounded border border-border/70 bg-muted/60 p-2 font-mono text-[10px] text-foreground/85 select-all focus:outline-none focus:border-stock/50 resize-none cursor-pointer"
                        />
                      </div>
                    </div>
                  )}

                  {/* Desktop Browser Card */}
                  <div className="flex flex-col gap-2 rounded bg-card p-3 border border-border/40">
                    <p className="text-[11px] font-medium text-foreground flex items-center gap-1.5">
                      <Laptop className="size-3.5 text-muted-foreground" />
                      Desktop Browsers (Chrome / Edge / Safari / Brave):
                    </p>
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
                        onClick={() => void handleCopyScript()}
                        className={cn(
                          "h-8 px-2 text-[11px] text-muted-foreground hover:text-foreground transition-all cursor-pointer",
                          copiedScript && "text-stock font-medium"
                        )}
                      >
                        {copiedScript ? (
                          <>
                            <Check className="size-3 mr-1 text-stock" /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="size-3 mr-1" /> Copy Script
                          </>
                        )}
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
        <section className="flex flex-col gap-2.5">
          <div className="grid gap-3 sm:grid-cols-3">
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
            <IntervalField
              label="Order cooldown"
              valueMs={config.orderCooldownMs}
              onChange={(ms) => onChange({ orderCooldownMs: ms })}
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
