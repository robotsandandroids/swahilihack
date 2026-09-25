"use client";

/**
 * Azure Neural TTS client (via backend edge-tts proxy).
 *
 * Replaces window.speechSynthesis with sw-KE-ZuriNeural for pure Swahili
 * and en-GB-SoniaNeural for code-switched correction text.
 *
 * The fetch is intentionally fire-and-forget from the caller's perspective:
 *   speakAzure(text, { onStart, onEnd })
 * The audio object is returned so callers can cancel() it if needed.
 *
 * Parallel usage pattern (zero perceived latency cost):
 *   1. Backend returns JSON (ai_text + feedback)
 *   2. React renders the feedback card
 *   3. speakAzure() was already started in step 1 — audio arrives while
 *      React is rendering, plays immediately (or within ~200ms).
 */

const API_URL =
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) ||
  "http://localhost:8000";

export type SpeakMode = "swahili" | "codeswitched";

export interface SpeakOptions {
  mode?: SpeakMode;
  onStart?: () => void;
  onEnd?: () => void;
}

/** Shared audio element — only one voice plays at a time. */
let _current: HTMLAudioElement | null = null;

export function cancelAzureTTS() {
  if (_current) {
    _current.pause();
    _current.src = "";
    _current = null;
  }
}

/**
 * Synthesize *text* via the backend TTS endpoint and play it.
 * Returns a cancel function.
 */
export function speakAzure(
  text: string,
  { mode = "swahili", onStart, onEnd }: SpeakOptions = {},
): () => void {
  cancelAzureTTS();

  let cancelled = false;
  let audio: HTMLAudioElement | null = null;

  // Start the fetch immediately — runs in parallel with whatever the caller does next
  fetch(`${API_URL}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, mode }),
  })
    .then((res) => {
      if (!res.ok || cancelled) throw new Error("TTS fetch failed or cancelled");
      return res.blob();
    })
    .then((blob) => {
      if (cancelled) return;
      const url = URL.createObjectURL(blob);
      audio = new Audio(url);
      _current = audio;

      audio.onplay = () => onStart?.();
      audio.onended = () => {
        URL.revokeObjectURL(url);
        onEnd?.();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        onEnd?.();
      };

      audio.play().catch(() => onEnd?.());
    })
    .catch(() => {
      if (!cancelled) onEnd?.();
    });

  return () => {
    cancelled = true;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    onEnd?.();
  };
}
