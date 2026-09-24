"use client";

/**
 * useGeminiLive — bidirectional Gemini Live API voice hook
 *
 * Architecture:
 *   Browser mic → PCM 16kHz → Gemini Live WS → AI audio PCM + transcript events
 *
 * The hook:
 *   1. Opens a WebSocket to wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
 *   2. Sends mic audio as base64-encoded PCM chunks in realtime
 *   3. Receives server-turn audio (plays it) and input/output transcripts
 *   4. Exposes `transcript` (learner text) and `aiTranscript` (AI reply text)
 *      so the parent can parallel-POST the transcript to the backend for stemming.
 *
 * Refs:
 *   https://ai.google.dev/api/multimodal-live
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface GeminiLiveCallbacks {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAiTranscript?: (text: string, isFinal: boolean) => void;
  onAudioChunk?: (pcmB64: string) => void;
  onTurnComplete?: () => void;
  onError?: (msg: string) => void;
}

export interface UseGeminiLiveOptions {
  apiKey: string;
  model?: string;
  /** Swahili system prompt — tells Gemini to play the AI character. */
  systemInstruction?: string;
  callbacks?: GeminiLiveCallbacks;
}

export interface UseGeminiLive {
  connected: boolean;
  recording: boolean;
  error: string | null;
  /** Connect and start the session (call once per conversation). */
  connect: () => Promise<void>;
  /** Start streaming mic audio to Gemini. */
  startSpeaking: () => Promise<void>;
  /** Stop mic streaming; Gemini will process and respond. */
  stopSpeaking: () => void;
  /** Close WebSocket and release all resources. */
  disconnect: () => void;
}

const GEMINI_LIVE_HOST =
  "generativelanguage.googleapis.com";
const GEMINI_LIVE_PATH =
  "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

/** Target sample rate expected by Gemini Live for audio input. */
const INPUT_SAMPLE_RATE = 16000;
/** Output sample rate Gemini Live sends back. */
const OUTPUT_SAMPLE_RATE = 24000;

// ---------------------------------------------------------------------------
// PCM helpers
// ---------------------------------------------------------------------------

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useGeminiLive(options: UseGeminiLiveOptions): UseGeminiLive {
  const {
    apiKey,
    model = "gemini-2.0-flash-live-001",
    systemInstruction,
    callbacks,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const outputQueueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);
  const outputAudioCtxRef = useRef<AudioContext | null>(null);

  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep callbacks fresh without re-creating effects
  const cbRef = useRef(callbacks);
  useEffect(() => {
    cbRef.current = callbacks;
  }, [callbacks]);

  // ---- Output audio playback queue ----------------------------------------
  const playNextChunk = useCallback(async () => {
    if (playingRef.current || outputQueueRef.current.length === 0) return;
    playingRef.current = true;
    const chunk = outputQueueRef.current.shift()!;

    const outCtx =
      outputAudioCtxRef.current ??
      (outputAudioCtxRef.current = new AudioContext({
        sampleRate: OUTPUT_SAMPLE_RATE,
      }));

    // PCM s16le → AudioBuffer
    const samples = new Int16Array(chunk);
    const audioBuffer = outCtx.createBuffer(
      1,
      samples.length,
      OUTPUT_SAMPLE_RATE
    );
    const channelData = audioBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      channelData[i] = samples[i] / 32768;
    }

    const source = outCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(outCtx.destination);
    source.onended = () => {
      playingRef.current = false;
      playNextChunk();
    };
    source.start();
  }, []);

  const enqueueAudio = useCallback(
    (b64: string) => {
      const buf = base64ToArrayBuffer(b64);
      outputQueueRef.current.push(buf);
      cbRef.current?.onAudioChunk?.(b64);
      playNextChunk();
    },
    [playNextChunk]
  );

  // ---- WebSocket message handler ------------------------------------------
  const handleMessage = useCallback(
    (raw: string) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      // Gemini Live response envelope
      const serverContent = (msg as { serverContent?: unknown }).serverContent as
        | Record<string, unknown>
        | undefined;
      if (!serverContent) return;

      // Audio output
      const parts = (serverContent.modelTurn as { parts?: unknown[] } | undefined)
        ?.parts ?? [];
      for (const part of parts) {
        const p = part as Record<string, unknown>;
        const inlineData = p.inlineData as
          | { mimeType: string; data: string }
          | undefined;
        if (inlineData?.mimeType?.startsWith("audio/pcm")) {
          enqueueAudio(inlineData.data);
        }
      }

      // Input transcript (learner's speech)
      const inputTranscription = serverContent.inputTranscription as
        | { text?: string; finished?: boolean }
        | undefined;
      if (inputTranscription?.text) {
        cbRef.current?.onTranscript?.(
          inputTranscription.text,
          inputTranscription.finished ?? false
        );
      }

      // Output transcript (AI reply text)
      const outputTranscription = serverContent.outputTranscription as
        | { text?: string; finished?: boolean }
        | undefined;
      if (outputTranscription?.text) {
        cbRef.current?.onAiTranscript?.(
          outputTranscription.text,
          outputTranscription.finished ?? false
        );
      }

      // Turn complete
      if (serverContent.turnComplete) {
        cbRef.current?.onTurnComplete?.();
      }
    },
    [enqueueAudio]
  );

  // ---- Connect -------------------------------------------------------------
  const connect = useCallback(async () => {
    if (wsRef.current) return; // already connected

    const url = `wss://${GEMINI_LIVE_HOST}${GEMINI_LIVE_PATH}?key=${apiKey}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        // Send BidiGenerateContentSetup
        const setup: Record<string, unknown> = {
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ["audio", "text"],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: "Aoede" },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          },
        };
        if (systemInstruction) {
          (setup.setup as Record<string, unknown>).systemInstruction = {
            parts: [{ text: systemInstruction }],
          };
        }
        ws.send(JSON.stringify(setup));
        setConnected(true);
        resolve();
      };
      ws.onerror = (e) => {
        const msg = "Gemini Live WebSocket error";
        setError(msg);
        cbRef.current?.onError?.(msg);
        reject(new Error(msg));
      };
      ws.onclose = () => {
        setConnected(false);
        setRecording(false);
        wsRef.current = null;
      };
    });

    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string") handleMessage(ev.data);
    };
  }, [apiKey, model, systemInstruction, handleMessage]);

  // ---- Start speaking (mic → WS) ------------------------------------------
  const startSpeaking = useCallback(async () => {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      audioCtxRef.current = ctx;

      const source = ctx.createMediaStreamSource(stream);
      sourceRef.current = source;

      // ScriptProcessorNode for raw PCM access (widely supported)
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (ev) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        const pcm16 = floatTo16BitPCM(ev.inputBuffer.getChannelData(0));
        const b64 = arrayBufferToBase64(pcm16.buffer as ArrayBuffer);
        const msg = {
          realtimeInput: {
            mediaChunks: [{ mimeType: "audio/pcm;rate=16000", data: b64 }],
          },
        };
        wsRef.current.send(JSON.stringify(msg));
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      setRecording(true);
      setError(null);
    } catch (e) {
      const msg =
        e instanceof Error && e.name === "NotAllowedError"
          ? "Microphone permission denied."
          : `Could not start microphone: ${(e as Error).message}`;
      setError(msg);
      cbRef.current?.onError?.(msg);
    }
  }, [recording]);

  // ---- Stop speaking -------------------------------------------------------
  const stopSpeaking = useCallback(() => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();

    processorRef.current = null;
    sourceRef.current = null;
    streamRef.current = null;
    audioCtxRef.current = null;

    setRecording(false);

    // Signal end-of-turn to Gemini
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          realtimeInput: { activityHandling: { endOfSpeech: {} } },
        })
      );
    }
  }, []);

  // ---- Disconnect ----------------------------------------------------------
  const disconnect = useCallback(() => {
    stopSpeaking();
    wsRef.current?.close();
    wsRef.current = null;
    outputAudioCtxRef.current?.close();
    outputAudioCtxRef.current = null;
    outputQueueRef.current = [];
    playingRef.current = false;
    setConnected(false);
  }, [stopSpeaking]);

  // Cleanup on unmount
  useEffect(() => () => disconnect(), [disconnect]);

  return { connected, recording, error, connect, startSpeaking, stopSpeaking, disconnect };
}
