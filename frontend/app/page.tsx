"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bus,
  Briefcase,
  Car,
  Coffee,
  Dices,
  Hand,
  Landmark,
  type LucideIcon,
  MapPin,
  Mic,
  Smartphone,
  Stethoscope,
  Store,
  Home as HomeIcon,
} from "lucide-react";
import {
  ChatTurn,
  Feedback,
  Scenario,
  StartedSession,
  TurnResponse,
  listScenarios,
  startSession,
  stemWord,
  submitTurn,
} from "@/lib/api";
import { useRecorder } from "@/lib/useRecorder";

const VOICE_LANG = "sw-KE";

// SemaAI identity: greens/limes/gold only — no blue, purple, pink or orange.
const LOCATION_META: Record<string, { sw: string; icon: LucideIcon; color: string }> = {
  market: { sw: "Sokoni", icon: Store, color: "#C6F135" },
  taxi: { sw: "Teksini", icon: Car, color: "#6EE7B7" },
  restaurant: { sw: "Mkahawani", icon: Coffee, color: "#E3C067" },
  neighbourhood: { sw: "Mtaani", icon: Hand, color: "#A3E635" },
  clinic: { sw: "Hospitalini", icon: Stethoscope, color: "#5EEAD4" },
  bank: { sw: "Benkini", icon: Landmark, color: "#86EFAC" },
  town: { sw: "Mjini", icon: Bus, color: "#C6F135" },
  phone_shop: { sw: "Simukani", icon: Smartphone, color: "#5EEAD4" },
  office: { sw: "Ofisini", icon: Briefcase, color: "#6EE7B7" },
  real_estate: { sw: "Nyumbani", icon: HomeIcon, color: "#A3E635" },
};

function locationMeta(location: string) {
  return LOCATION_META[location] ?? { sw: location, icon: MapPin, color: "#C6F135" };
}

function scoreTier(score: number): "good" | "mid" | "needs-work" {
  if (score >= 75) return "good";
  if (score >= 50) return "mid";
  return "needs-work";
}

function scoreTextClass(score: number) {
  const tier = scoreTier(score);
  return {
    good: "text-positive",
    mid: "text-warning",
    "needs-work": "text-[#FF8A80]",
  }[tier];
}

function speak(text: string, enabled: boolean) {
  if (!enabled || typeof window === "undefined" || !("speechSynthesis" in window)) {
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = VOICE_LANG;
  window.speechSynthesis.speak(utterance);
}

export default function Home() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [session, setSession] = useState<StartedSession | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [scenarioLoad, setScenarioLoad] = useState<"loading" | "loaded" | "error">("loading");
  const { recording, error: recError, start, stop } = useRecorder();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!recording) {
      return;
    }

    const interval = window.setInterval(() => {
      setRecordingSeconds((prev) => prev + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [recording]);

  const loadScenarios = useCallback(() => {
    listScenarios()
      .then((data) => {
        setScenarios(data);
        setScenarioLoad("loaded");
        setError(null);
      })
      .catch((e) => {
        setError((e as Error).message);
        setScenarioLoad("error");
      });
  }, []);

  useEffect(() => {
    loadScenarios();
  }, [loadScenarios]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);

  const begin = useCallback(
    async (scenario: Scenario) => {
      setError(null);
      setBusy(true);
      try {
        const s = await startSession(scenario.id);
        setSession(s);
        setTurns([
          { role: "ai", text: s.opening_line, translation: s.scenario.context },
        ]);
        speak(s.opening_line, ttsEnabled);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [ttsEnabled],
  );

  const respondTo = useCallback(
    async (audio?: Blob, fallbackText?: string): Promise<TurnResponse | null> => {
      if (!session) return null;
      setBusy(true);
      setError(null);
      try {
        const res = await submitTurn(session.session_id, { audio, transcript: fallbackText });
        const aiTurn: ChatTurn = {
          role: "ai",
          text: res.ai_text,
          translation: res.ai_translation,
          feedback: res.feedback ? await enrichVocab(res.feedback) : undefined,
        };
        setTurns((prev) => [...prev, aiTurn]);
        speak(res.ai_text, ttsEnabled);
        return res;
      } catch (e) {
        setError((e as Error).message);
        return null;
      } finally {
        setBusy(false);
      }
    },
    [session, ttsEnabled],
  );

  const recordAndSend = useCallback(async () => {
    if (recording) {
      const blob = await stop();
      if (blob) {
        setTurns((prev) => [...prev, { role: "user", text: "(voice reply)" }]);
        await respondTo(blob);
      }
    } else {
      setRecordingSeconds(0);
      await start();
    }
  }, [recording, start, stop, respondTo]);

  const sendText = useCallback(async () => {
    if (!textInput.trim() || !session) return;
    const txt = textInput.trim();
    setTextInput("");
    setTurns((prev) => [...prev, { role: "user", text: txt }]);
    await respondTo(undefined, txt);
  }, [textInput, session, respondTo]);

  const replay = useCallback(
    (text: string) => speak(text, true),
    [],
  );

  if (scenarioLoad === "loading") {
    return <SplashLoading />;
  }

  if (scenarioLoad === "error") {
    return (
      <ScenarioError
        message={error}
        onRetry={() => {
          setScenarioLoad("loading");
          loadScenarios();
        }}
      />
    );
  }

  return (
    <main className="dashboard-enter mx-auto flex min-h-dvh w-full max-w-5xl flex-col p-4 sm:p-6 lg:p-10">
      <div className="min-h-[560px] flex-1 rounded-2xl bg-panel px-4 py-6 sm:px-10 sm:py-8">
        <header className="mb-7 flex items-center justify-between">
          <div className="flex items-center gap-2 text-base font-medium text-white">
            <div className="h-[26px] w-[26px] rounded-[7px] bg-brand shadow-[0_0_18px_rgba(198,241,53,0.35)]" />
            Sema
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTtsEnabled((v) => !v)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                ttsEnabled
                  ? "border-brand bg-brand text-brand-fg"
                  : "border-white/15 text-white/60 hover:text-white"
              }`}
            >
              Voice {ttsEnabled ? "on" : "off"}
            </button>
            {session && (
              <button
                onClick={() => {
                  setSession(null);
                  setTurns([]);
                }}
                className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/60 transition hover:text-white"
              >
                New topic
              </button>
            )}
            <div className="h-8 w-8 rounded-full bg-white/[0.08]" />
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-[#FF8A80]/30 bg-[#FF8A80]/10 px-4 py-3 text-sm text-[#FF8A80]">
            {error}
          </div>
        )}

        {!session ? (
          <HomeMenu scenarios={scenarios} busy={busy} onPick={begin} />
        ) : (
          <Conversation
            session={session}
            turns={turns}
            recording={recording}
            recordingSeconds={recordingSeconds}
            recError={recError}
            busy={busy}
            textInput={textInput}
            setTextInput={setTextInput}
            onRecord={recordAndSend}
            onSend={sendText}
            onReplay={replay}
          />
        )}
      </div>
      <div ref={bottomRef} />
    </main>
  );
}

function SplashLoading() {
  return (
    <main
      role="status"
      aria-live="polite"
      className="flex min-h-dvh flex-col items-center justify-center bg-[#080808] px-6"
    >
      <Image
        src="/sema-logo.png"
        alt="SemaAI"
        width={168}
        height={161}
        priority
        className="select-none drop-shadow-[0_0_28px_rgba(198,241,53,0.18)]"
      />

      <div className="relative mt-12 flex h-28 w-28 items-center justify-center" aria-hidden>
        <span className="orb-ripple absolute h-16 w-16 rounded-full border border-brand/40" />
        <span
          className="orb-ripple absolute h-16 w-16 rounded-full border border-brand/25"
          style={{ animationDelay: "0.9s" }}
        />
        <span
          className="orb-ripple absolute h-16 w-16 rounded-full border border-brand/15"
          style={{ animationDelay: "1.8s" }}
        />
        <span className="orb-breathe h-12 w-12 rounded-full bg-brand shadow-[0_0_28px_rgba(198,241,53,0.55),0_0_64px_rgba(198,241,53,0.22)]" />
      </div>

      <p className="mt-10 text-sm text-white/70">Getting your practice ready...</p>

      <div className="mt-3 flex items-center gap-1.5" aria-hidden>
        <span className="loading-dot h-1.5 w-1.5 rounded-full bg-brand/90" />
        <span className="loading-dot h-1.5 w-1.5 rounded-full bg-brand/60" style={{ animationDelay: "0.2s" }} />
        <span className="loading-dot h-1.5 w-1.5 rounded-full bg-white/25" style={{ animationDelay: "0.4s" }} />
      </div>

      <style jsx>{`
        .orb-breathe {
          animation: orb-breathe 2.6s ease-in-out infinite;
        }

        @keyframes orb-breathe {
          0%,
          100% {
            opacity: 0.85;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.12);
          }
        }

        .orb-ripple {
          opacity: 0;
          animation: orb-ripple 2.7s ease-out infinite;
        }

        @keyframes orb-ripple {
          0% {
            opacity: 0.7;
            transform: scale(0.55);
          }
          70% {
            opacity: 0.15;
          }
          100% {
            opacity: 0;
            transform: scale(1.7);
          }
        }

        .loading-dot {
          animation: loading-dot 1.2s ease-in-out infinite;
        }

        @keyframes loading-dot {
          0%,
          100% {
            opacity: 0.35;
            transform: translateY(0);
          }
          50% {
            opacity: 1;
            transform: translateY(-3px);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .orb-breathe,
          .loading-dot {
            animation: none;
          }

          .orb-ripple {
            animation: none;
            opacity: 0.25;
          }
        }
      `}</style>
    </main>
  );
}

function ScenarioError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-[#080808] px-6 text-center">
      <Image
        src="/sema-logo.png"
        alt="SemaAI"
        width={112}
        height={107}
        priority
        className="select-none"
      />

      <p className="mt-8 text-base font-medium text-white">Couldn&apos;t load your practice scenarios.</p>
      <p className="mt-2 max-w-sm text-xs leading-relaxed text-white/40">
        {message ?? "Please check your connection and try again."}
      </p>

      <button
        onClick={onRetry}
        className="mt-7 rounded-full bg-brand px-6 py-2.5 text-sm font-medium text-brand-fg transition hover:brightness-110"
      >
        Try again
      </button>
    </main>
  );
}

function HomeMenu({
  scenarios,
  busy,
  onPick,
}: {
  scenarios: Scenario[];
  busy: boolean;
  onPick: (s: Scenario) => void;
}) {
  if (scenarios.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-white/50">
        No practice scenarios available right now. Check back soon.
      </p>
    );
  }

  const suggested = scenarios.find((s) => s.id === "market-tomatoes") ?? scenarios[0];
  const suggestedMeta = locationMeta(suggested.location);

  const surprise = () => {
    const pick = scenarios[Math.floor(Math.random() * scenarios.length)];
    onPick(pick);
  };

  return (
    <>
      <div className="mb-1 text-xl font-medium text-white sm:text-2xl">Habari, Amara</div>
      <p className="mb-6 text-[13px] text-white/45 sm:text-sm">Pick a scenario to practice today</p>

      {/* Score summary row — two columns, matching the design */}
      <div className="mb-7 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white/[0.04] px-4 py-3.5">
          <div className="mb-1.5 text-[11px] text-white/45">Avg. score</div>
          <div className="text-[22px] font-medium text-white">
            78<span className="text-[13px] text-white/40">/100</span>
          </div>
          <div className="mt-0.5 text-[11px] text-positive">↑ 6 this week</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] px-4 py-3.5">
          <div className="mb-1.5 text-[11px] text-white/45">Weakest skill</div>
          <div className="text-[22px] font-medium text-white">Grammar</div>
          <div className="mt-0.5 text-[11px] text-warning">64% avg</div>
        </div>
      </div>

      {/* Suggested scenario — its own full-width band below the score row */}
      <div className="mb-7 flex items-center justify-between gap-4 rounded-[14px] border border-brand/35 bg-gradient-to-br from-brand/[0.18] to-brand/5 px-5 py-[1.1rem]">
        <div className="min-w-0">
          <div className="mb-1 text-[11px] text-brand-soft">Suggested for you</div>
          <div className="truncate text-[15px] font-medium text-white">
            {suggestedMeta.sw} · {suggested.title}
          </div>
          <div className="truncate text-xs text-white/50">
            {suggested.hint_en ?? suggested.context}
          </div>
        </div>
        <button
          disabled={busy}
          onClick={() => onPick(suggested)}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-[18px] py-2.5 text-[13px] font-medium text-brand-fg transition hover:brightness-110 disabled:opacity-50"
        >
          <Mic className="h-[15px] w-[15px]" aria-hidden />
          Start
        </button>
      </div>

      {/* Scenario grid — fixed 3 columns at rest-of-screen widths, matching the design */}
      <div className="mb-2.5 text-xs text-white/50 sm:text-[13px]">All scenarios</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {scenarios.map((s) => {
          const meta = locationMeta(s.location);
          const Icon = meta.icon;
          return (
            <button
              key={s.id}
              disabled={busy}
              onClick={() => onPick(s)}
              className="flex flex-col items-start gap-2 rounded-xl bg-white/[0.04] p-3.5 text-left transition hover:bg-white/[0.08] disabled:opacity-50"
            >
              <Icon className="h-5 w-5" style={{ color: meta.color }} aria-hidden />
              <span className="text-[13px] font-medium text-white">{meta.sw}</span>
              <span className="text-[11px] text-white/45">{s.title}</span>
              <span className="mt-auto pt-1 text-[11px] capitalize text-white/35">
                {s.difficulty}
              </span>
            </button>
          );
        })}

        <button
          disabled={busy}
          onClick={surprise}
          className="flex min-h-[110px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/15 bg-white/[0.02] text-white/35 transition hover:border-brand/40 hover:text-brand-soft disabled:opacity-50"
        >
          <Dices className="h-5 w-5" aria-hidden />
          <span className="text-xs">Surprise me</span>
        </button>
      </div>
    </>
  );
}

function Conversation({
  session,
  turns,
  recording,
  recordingSeconds,
  recError,
  busy,
  textInput,
  setTextInput,
  onRecord,
  onSend,
  onReplay,
}: {
  session: StartedSession;
  turns: ChatTurn[];
  recording: boolean;
  recordingSeconds: number;
  recError: string | null;
  busy: boolean;
  textInput: string;
  setTextInput: (v: string) => void;
  onRecord: () => void;
  onSend: () => void;
  onReplay: (text: string) => void;
}) {
  const turnsLeft = Math.max(session.max_turns - turns.filter((t) => t.role === "user").length, 0);
  const formattedRecordingTime = `${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, "0")}`;

  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{session.scenario.title}</h2>
          <p className="text-sm text-white/45">{session.scenario.title_sw}</p>
        </div>
        <span className="text-sm text-white/50">
          {turnsLeft} turn{turnsLeft === 1 ? "" : "s"} left
        </span>
      </div>

      {session.scenario.hint_en && turns.length <= 1 && (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          Hint: {session.scenario.hint_en}
        </p>
      )}

      <div className="mb-4 flex min-h-[300px] flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        {turns.map((t, i) => (
          <Message key={i} turn={t} onReplay={onReplay} />
        ))}
      </div>

      {recError && <p className="mb-2 text-sm text-[#FF8A80]">{recError}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={onRecord}
          disabled={busy}
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-50 ${
            recording
              ? "animate-pulse bg-red-500 shadow-[0_0_20px_rgba(255,60,60,0.45)]"
              : "bg-brand text-brand-fg hover:brightness-110"
          }`}
          aria-label={recording ? "Stop recording" : "Record reply"}
        >
          {recording ? (
            <span className="h-3 w-3 rounded-sm bg-white" />
          ) : (
            <Mic className="h-5 w-5" aria-hidden />
          )}
        </button>
        {recording && (
          <div className="flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-2 py-1 text-xs font-medium text-brand-soft">
            <div className="flex h-4 items-end gap-1">
              {[0, 1, 2, 3].map((bar) => (
                <span
                  key={bar}
                  className="recording-bar"
                  style={{ animationDelay: `${bar * 120}ms` }}
                />
              ))}
            </div>
            <span>{formattedRecordingTime}</span>
          </div>
        )}
        <input
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSend();
          }}
          placeholder="…or type your reply in Kiswahili"
          className="h-12 flex-1 rounded-full border border-white/15 bg-white/5 px-4 text-sm text-white outline-none placeholder:text-white/40 focus:border-brand"
        />
        <button
          onClick={onSend}
          disabled={busy || !textInput.trim()}
          className="h-12 shrink-0 rounded-full bg-brand px-5 text-sm font-medium text-brand-fg transition hover:brightness-110 disabled:opacity-40"
        >
          Send
        </button>
      </div>
      {busy && <p className="mt-2 text-center text-xs text-white/40">Listening & grading…</p>}
      <style jsx>{`
        .recording-bar {
          display: block;
          width: 3px;
          border-radius: 9999px;
          background: var(--brand);
          animation: recording-bar 0.9s ease-in-out infinite alternate;
          transform-origin: bottom center;
        }

        .recording-bar:nth-child(1) {
          height: 35%;
        }

        .recording-bar:nth-child(2) {
          height: 60%;
        }

        .recording-bar:nth-child(3) {
          height: 85%;
        }

        .recording-bar:nth-child(4) {
          height: 100%;
        }

        @keyframes recording-bar {
          0% {
            opacity: 0.35;
            transform: scaleY(0.5);
          }
          100% {
            opacity: 1;
            transform: scaleY(1);
          }
        }
      `}</style>
    </section>
  );
}

function Message({ turn, onReplay }: { turn: ChatTurn; onReplay: (t: string) => void }) {
  const isAi = turn.role === "ai";
  return (
    <div className={`flex ${isAi ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
          isAi
            ? "rounded-tl-sm bg-white/[0.07] text-white"
            : "rounded-tr-sm bg-brand text-brand-fg"
        }`}
      >
        <p>{turn.text}</p>
        {isAi && turn.translation && (
          <p className={`mt-1 text-xs ${isAi ? "text-white/45" : "text-brand-fg/60"}`}>
            {turn.translation}
          </p>
        )}
        {isAi && (
          <button
            onClick={() => onReplay(turn.text)}
            className="mt-2 text-xs text-white/40 underline underline-offset-2 hover:text-white/70"
          >
            replay
          </button>
        )}
        {turn.feedback && <FeedbackPanel feedback={turn.feedback} />}
      </div>
    </div>
  );
}

function FeedbackPanel({ feedback }: { feedback: Feedback }) {
  const [showAllVocab, setShowAllVocab] = useState(false);
  const vocabEntries = feedback.vocab.filter((v) => v.breakdown);
  const visibleVocab = showAllVocab || vocabEntries.length <= 4 ? vocabEntries : vocabEntries.slice(0, 4);
  const tier = scoreTier(feedback.score);
  const panelClasses = {
    good: "border-positive/25 bg-positive/[0.08]",
    mid: "border-warning/25 bg-warning/[0.08]",
    "needs-work": "border-[#FF8A80]/25 bg-[#FF8A80]/[0.08]",
  }[tier];

  return (
    <>
      <div className={`feedback-panel-enter mt-3 rounded-xl border p-3 text-xs text-white/70 ${panelClasses}`}>
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold text-white">{feedback.headline}</span>
          <ScoreBadge label="Overall" score={feedback.score} />
        </div>
        <div className="mb-3 flex gap-3 text-[11px]">
          <span className="text-white/50">Comprehension</span>
          <span className="font-semibold text-white">{feedback.comprehension}</span>
          <span className="text-white/50">Grammar</span>
          <span className="font-semibold text-white">{feedback.grammar}</span>
          <span className="text-white/50">Enunciation</span>
          <span className="font-semibold text-white">{feedback.enunciation}</span>
        </div>
        {feedback.corrections.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 font-medium text-white">Corrections</p>
            {feedback.corrections.map((c, i) => (
              <p key={i} className="mb-1">
                <s className="text-[#FF8A80]">{c.original || "…"}</s>{" "}
                <span className="font-semibold text-positive">{c.corrected}</span>{" "}
                <span className="text-white/50">— {c.reason}</span>
              </p>
            ))}
          </div>
        )}
        {feedback.good_points.length > 0 && (
          <p className="mb-2 text-positive">✓ {feedback.good_points.join(" · ")}</p>
        )}
        {vocabEntries.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 font-medium text-white">Word roots</p>
            <div className="flex flex-wrap gap-1">
              {visibleVocab.map((v, i) => (
                <span key={i} className="rounded bg-white/5 px-1.5 py-0.5 ring-1 ring-white/10">
                  {v.word} → <b className="font-mono">{v.breakdown}</b>
                </span>
              ))}
            </div>
            {vocabEntries.length > 4 && (
              <button
                type="button"
                onClick={() => setShowAllVocab((v) => !v)}
                className="mt-2 text-[11px] text-white/50 underline underline-offset-2 hover:text-white/80"
              >
                {showAllVocab ? "Show less" : `Show ${vocabEntries.length - 4} more`}
              </button>
            )}
          </div>
        )}
        {feedback.suggestion && (
          <p className="italic text-white/50">→ {feedback.suggestion}</p>
        )}
      </div>
      <style jsx>{`
        @keyframes feedback-panel-enter {
          0% {
            opacity: 0;
            transform: translateY(8px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .feedback-panel-enter {
          animation: feedback-panel-enter 0.35s ease-out both;
        }
      `}</style>
    </>
  );
}

function ScoreBadge({ label, score }: { label: string; score: number }) {
  return (
    <span className={`flex items-center gap-1 font-bold ${scoreTextClass(score)}`}>
      {label} {score}
    </span>
  );
}

async function enrichVocab(feedback: Feedback): Promise<Feedback> {
  try {
    const words = [...new Set(feedback.vocab.map((v) => v.word))].filter(Boolean);
    const enriched = await Promise.all(
      words.map(async (w) => {
        try {
          const stem = await stemWord(w);
          return { ...feedVocab(w, feedback), breakdown: stem.breakdown };
        } catch {
          return feedVocab(w, feedback);
        }
      }),
    );
    return { ...feedback, vocab: enriched.length ? enriched : feedback.vocab };
  } catch {
    return feedback;
  }
}

function feedVocab(word: string, feedback: Feedback) {
  const existing = feedback.vocab.find((v) => v.word === word);
  return { word, breakdown: existing?.breakdown ?? "", note: existing?.note ?? "" };
}
