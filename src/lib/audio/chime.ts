/**
 * Browser-native Web Audio API synthesizer for Latch restock alerts.
 * Generates a subtle, pleasant two-tone sonar/acoustic chime:
 * - Tone 1: ~587.33 Hz (D5) for ~100ms
 * - Tone 2: ~880 Hz (A5) fading smoothly over ~350ms
 */

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;

  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextClass) return null;

    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new AudioContextClass();
    }

    if (sharedAudioCtx.state === "suspended") {
      void sharedAudioCtx.resume().catch(() => {
        // Silently handle autoplay prevention before user interaction
      });
    }

    return sharedAudioCtx;
  } catch {
    return null;
  }
}

export function playRestockChime(): void {
  if (typeof window === "undefined") return;

  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;

    // Tone 1: D5 (~587.33 Hz) soft acoustic ping (100ms)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, now);

    // Smooth envelope for Tone 1
    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(0.18, now + 0.015);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.11);

    // Tone 2: A5 (~880 Hz) sonar chime fading smoothly over 350ms
    const t2 = now + 0.075;
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();

    osc2.type = "sine";
    osc2.frequency.setValueAtTime(880, t2);

    // Smooth envelope for Tone 2
    gain2.gain.setValueAtTime(0.0001, t2);
    gain2.gain.exponentialRampToValueAtTime(0.22, t2 + 0.02);
    gain2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.35);

    osc2.connect(gain2);
    gain2.connect(ctx.destination);

    osc2.start(t2);
    osc2.stop(t2 + 0.36);

    // Node cleanup on completion
    osc1.onended = () => {
      try {
        osc1.disconnect();
        gain1.disconnect();
      } catch {
        // Safe ignore
      }
    };

    osc2.onended = () => {
      try {
        osc2.disconnect();
        gain2.disconnect();
      } catch {
        // Safe ignore
      }
    };
  } catch (err) {
    console.debug?.("[Latch Audio] Could not play chime:", err);
  }
}
