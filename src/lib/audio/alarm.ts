/**
 * Browser-native Web Audio API restock alarm synthesizer.
 * Generates an urgent, rhythmic dual-tone radar siren for restock events:
 * - Tone 1: 987.77 Hz (B5)
 * - Tone 2: 1318.51 Hz (E6)
 * Cycles in sharp bursts of 3 rapid pulses, pausing briefly, then repeating.
 * Supports continuous ringing with manual stop or 45-second auto-silence safety.
 */

let audioCtx: AudioContext | null = null;
let alarmInterval: number | null = null;
let autoSilenceTimer: number | null = null;
let isAlarmActive = false;
const listeners = new Set<(active: boolean) => void>();

function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!audioCtx || audioCtx.state === "closed") {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === "suspended") {
      void audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

function notifyListeners(active: boolean): void {
  isAlarmActive = active;
  listeners.forEach((cb) => {
    try {
      cb(active);
    } catch {
      /* ignore */
    }
  });
}

/**
 * Play a single sharp dual-frequency pulse burst (3 quick beeps over ~450ms)
 */
export function playAlarmPulse(): void {
  const ctx = getContext();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }

    const startTime = ctx.currentTime;
    const beepTimes = [startTime, startTime + 0.14, startTime + 0.28];

    for (let i = 0; i < beepTimes.length; i++) {
      const t = beepTimes[i];
      const freq = i % 2 === 0 ? 1046.5 : 1318.51; // High C6 alternating with E6

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);

      // Sharp percussive envelope
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.28, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.095);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.1);

      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {
          /* ignore */
        }
      };
    }
  } catch (err) {
    console.debug?.("[Latch Alarm] Pulse error:", err);
  }
}

/**
 * Start continuous restock alarm.
 * Rings every 950ms until stopRestockAlarm() is called or 45s safety timeout triggers.
 */
export function startRestockAlarm(maxDurationMs = 45000): void {
  if (typeof window === "undefined") return;
  if (isAlarmActive) return;

  const ctx = getContext();
  if (!ctx) return;

  // Immediate first burst
  playAlarmPulse();
  notifyListeners(true);

  // Interval for repeating bursts
  alarmInterval = window.setInterval(() => {
    playAlarmPulse();
  }, 950);

  // Safety auto-silence
  if (maxDurationMs > 0) {
    autoSilenceTimer = window.setTimeout(() => {
      stopRestockAlarm();
    }, maxDurationMs);
  }
}

/**
 * Stop and silence the restock alarm.
 */
export function stopRestockAlarm(): void {
  if (typeof window === "undefined") return;

  if (alarmInterval !== null) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }

  if (autoSilenceTimer !== null) {
    clearTimeout(autoSilenceTimer);
    autoSilenceTimer = null;
  }

  if (isAlarmActive) {
    notifyListeners(false);
  }
}

/**
 * Check if the alarm is actively ringing.
 */
export function isAlarmRinging(): boolean {
  return isAlarmActive;
}

/**
 * Subscribe to alarm active/inactive transitions.
 */
export function onAlarmStateChange(cb: (active: boolean) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
