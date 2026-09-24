"use client";

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
  Moon,
  Smartphone,
  Stethoscope,
  Store,
  Sun,
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

const LOCATION_META: Record<
  string,
  { sw: string; icon: LucideIcon; color: string; colorLight: string }
> = {
  market: { sw: "Sokoni", icon: Store, color: "#5DCAA5", colorLight: "#0d9488" },
  taxi: { sw: "Teksini", icon: Car, color: "#378ADD", colorLight: "#2563eb" },
  restaurant: { sw: "Mkahawani", icon: Coffee, color: "#EF9F27", colorLight: "#d97706" },
  neighbourhood: { sw: "Mtaani", icon: Hand, color: "#97C459", colorLight: "#16a34a" },
  clinic: { sw: "Hospitalini", icon: Stethoscope, color: "#7F77DD", colorLight: "#6366f1" },
  bank: { sw: "Benkini", icon: Landmark, color: "#5DCAA5", colorLight: "#0d9488" },
  town: { sw: "Mjini", icon: Bus, color: "#D4537E", colorLight: "#db2777" },
  phone_shop: { sw: "Simukani", icon: Smartphone, color: "#7F77DD", colorLight: "#6366f1" },
  office: { sw: "Ofisini", icon: Briefcase, color: "#378ADD", colorLight: "#2563eb" },
  real_estate: { sw: "Nyumbani", icon: HomeIcon, color: "#97C459", colorLight: "#16a34a" },
};

function locationMeta(location: string) {
  return (
    LOCATION_META[location] ?? {
      sw: location,
      icon: MapPin,
      color: "#5DCAA5",
      colorLight: "#0d9488",
    }
  );
}

const BEST_SCORES: Record<string, number> = {
  "market-tomatoes": 84,
  "taxi-fare": 76,
  "restaurant-order": 91,
  "greeting-older": 72,
  "clinic-complaint": 64,
  "directions-city": 58,
};

function scoreTextClass(score: number) {
  if (score >= 70) return "text-positive";
  if (score >= 50) return "text-warning";
  return "text-danger";
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

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const stored = localStorage.getItem("sema_theme") as "light" | "dark" | null;
    return stored === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [session, setSession] = useState<StartedSession | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textInput, setTextInput] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const { recording, error: recError, start, stop } = useRecorder();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((curr) => {
      const next = curr === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("sema_theme", next);
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    listScenarios()
      .then(setScenarios)
      .catch((e) => setError(e.message));
  }, []);

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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col p-4 sm:p-6 lg:p-10">
      <div className="min-h-[560px] flex-1 rounded-2xl border border-[var(--panel-border)] bg-panel px-4 py-6 shadow-sm transition-colors sm:px-10 sm:py-8">
        <header className="mb-7 flex items-center justify-between">
          <div className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
            <div className="h-[26px] w-[26px] rounded-[7px] bg-brand shadow-xs" />
            Sema
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="flex items-center gap-1.5 rounded-full border border-[var(--btn-secondary-border)] px-3 py-1 text-xs text-[var(--btn-secondary-text)] transition hover:bg-[var(--btn-secondary-hover-bg)] hover:text-[var(--btn-secondary-hover-text)]"
            >
              {theme === "dark" ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-warning" aria-hidden />
                  <span>Light</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden />
                  <span>Dark</span>
                </>
              )}
            </button>
            <button
              onClick={() => setTtsEnabled((v) => !v)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                ttsEnabled
                  ? "border-brand bg-brand font-medium text-white shadow-xs"
                  : "border-[var(--btn-secondary-border)] text-[var(--btn-secondary-text)] hover:bg-[var(--btn-secondary-hover-bg)] hover:text-[var(--btn-secondary-hover-text)]"
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
                className="rounded-full border border-[var(--btn-secondary-border)] px-3 py-1 text-xs text-[var(--btn-secondary-text)] transition hover:bg-[var(--btn-secondary-hover-bg)] hover:text-[var(--btn-secondary-hover-text)]"
              >
                New topic
              </button>
            )}
            <div className="h-8 w-8 rounded-full border border-[var(--card-border)] bg-[var(--avatar-bg)]" />
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        {!session ? (
          <HomeMenu
            scenarios={scenarios}
            busy={busy}
            onPick={begin}
            theme={theme}
          />
        ) : (
          <Conversation
            session={session}
            turns={turns}
            recording={recording}
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

function HomeMenu({
  scenarios,
  busy,
  onPick,
  theme,
}: {
  scenarios: Scenario[];
  busy: boolean;
  onPick: (s: Scenario) => void;
  theme: "light" | "dark";
}) {
  if (scenarios.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-[var(--text-muted)]">
        Loading scenarios… If this stalls, is the backend running on :8000?
      </p>
    );
  }

  const suggested = scenarios.find((s) => s.id === "market-tomatoes") ?? scenarios[0];
  const suggestedMeta = locationMeta(suggested.location);

  const surprise = () => {
    const pick = scenarios[Math.floor(Math.random() * scenarios.length)];
    onPick(pick);
  };

  const isDark = theme === "dark";

  return (
    <>
      <div className="mb-1 text-xl font-medium text-[var(--text-primary)] sm:text-2xl">
        Habari, Amara
      </div>
      <p className="mb-6 text-[13px] text-[var(--text-muted)] sm:text-sm">
        Pick a scenario to practice today
      </p>

      {/* Score summary row — two columns */}
      <div className="mb-7 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3.5 transition">
          <div className="mb-1.5 text-[11px] text-[var(--text-muted)]">Avg. score</div>
          <div className="text-[22px] font-medium text-[var(--text-primary)]">
            78<span className="text-[13px] text-[var(--text-faint)]">/100</span>
          </div>
          <div className="mt-0.5 text-[11px] font-medium text-positive">↑ 6 this week</div>
        </div>
        <div className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-3.5 transition">
          <div className="mb-1.5 text-[11px] text-[var(--text-muted)]">Weakest skill</div>
          <div className="text-[22px] font-medium text-[var(--text-primary)]">Grammar</div>
          <div className="mt-0.5 text-[11px] font-medium text-warning">64% avg</div>
        </div>
      </div>

      {/* Suggested scenario — full-width card below score row */}
      <div className="mb-7 flex items-center justify-between gap-4 rounded-[14px] border border-[var(--brand-card-border)] bg-[var(--brand-card-bg)] px-5 py-[1.1rem] transition">
        <div className="min-w-0">
          <div className="mb-1 text-[11px] font-medium text-brand-soft">Suggested for you</div>
          <div className="truncate text-[15px] font-medium text-[var(--text-primary)]">
            {suggestedMeta.sw} · {suggested.title}
          </div>
          <div className="truncate text-xs text-[var(--text-muted)]">
            {suggested.hint_en ?? suggested.context}
          </div>
        </div>
        <button
          disabled={busy}
          onClick={() => onPick(suggested)}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-[18px] py-2.5 text-[13px] font-medium text-white shadow-xs transition hover:brightness-110 disabled:opacity-50"
        >
          <Mic className="h-[15px] w-[15px]" aria-hidden />
          Start
        </button>
      </div>

      {/* Scenario grid */}
      <div className="mb-2.5 text-xs font-medium text-[var(--text-muted)] sm:text-[13px]">
        All scenarios
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {scenarios.map((s) => {
          const meta = locationMeta(s.location);
          const Icon = meta.icon;
          const best = BEST_SCORES[s.id];
          const iconColor = isDark ? meta.color : meta.colorLight;
          return (
            <button
              key={s.id}
              disabled={busy}
              onClick={() => onPick(s)}
              className="flex flex-col items-start gap-2 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3.5 text-left transition hover:border-brand/40 hover:bg-[var(--card-hover)] disabled:opacity-50"
            >
              <Icon className="h-5 w-5" style={{ color: iconColor }} aria-hidden />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">{meta.sw}</span>
              <span className="text-[11px] text-[var(--text-muted)]">{s.title}</span>
              <span
                className={`mt-auto pt-1 text-[11px] font-medium ${
                  best != null ? scoreTextClass(best) : "text-[var(--text-faint)]"
                }`}
              >
                {best != null ? `Best: ${best}` : "Not started"}
              </span>
            </button>
          );
        })}

        <button
          disabled={busy}
          onClick={surprise}
          className="flex min-h-[110px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--surprise-border)] bg-[var(--surprise-bg)] text-[var(--surprise-text)] transition hover:border-brand hover:text-brand disabled:opacity-50"
        >
          <Dices className="h-5 w-5" aria-hidden />
          <span className="text-xs font-medium">Surprise me</span>
        </button>
      </div>
    </>
  );
}

function Conversation({
  session,
  turns,
  recording,
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
  recError: string | null;
  busy: boolean;
  textInput: string;
  setTextInput: (v: string) => void;
  onRecord: () => void;
  onSend: () => void;
  onReplay: (text: string) => void;
}) {
  const turnsLeft = Math.max(session.max_turns - turns.filter((t) => t.role === "user").length, 0);
  return (
    <section>
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{session.scenario.title}</h2>
          <p className="text-sm text-[var(--text-muted)]">{session.scenario.title_sw}</p>
        </div>
        <span className="text-sm text-[var(--text-muted)]">
          {turnsLeft} turn{turnsLeft === 1 ? "" : "s"} left
        </span>
      </div>

      {session.scenario.hint_en && turns.length <= 1 && (
        <p className="mb-4 rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-sm text-warning">
          Hint: {session.scenario.hint_en}
        </p>
      )}

      <div className="mb-4 flex min-h-[300px] flex-col gap-3 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
        {turns.map((t, i) => (
          <Message key={i} turn={t} onReplay={onReplay} />
        ))}
      </div>

      {recError && <p className="mb-2 text-sm text-danger">{recError}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={onRecord}
          disabled={busy}
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition disabled:opacity-50 ${
            recording ? "animate-pulse bg-red-500" : "bg-brand hover:brightness-110"
          }`}
          aria-label={recording ? "Stop recording" : "Record reply"}
        >
          {recording ? (
            <span className="h-3 w-3 rounded-sm bg-white" />
          ) : (
            <Mic className="h-5 w-5" aria-hidden />
          )}
        </button>
        <input
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSend();
          }}
          placeholder="…or type your reply in Kiswahili"
          className="h-12 flex-1 rounded-full border border-[var(--input-border)] bg-[var(--input-bg)] px-4 text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--input-placeholder)] focus:border-brand"
        />
        <button
          onClick={onSend}
          disabled={busy || !textInput.trim()}
          className="h-12 shrink-0 rounded-full bg-brand px-5 text-sm font-medium text-white shadow-xs transition hover:brightness-110 disabled:opacity-40"
        >
          Send
        </button>
      </div>
      {busy && <p className="mt-2 text-center text-xs text-[var(--text-muted)]">Listening & grading…</p>}
    </section>
  );
}

function Message({ turn, onReplay }: { turn: ChatTurn; onReplay: (t: string) => void }) {
  const isAi = turn.role === "ai";
  return (
    <div className={`flex ${isAi ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-xs ${
          isAi
            ? "rounded-tl-sm border border-[var(--card-border)] bg-[var(--ai-bubble-bg)] text-[var(--ai-bubble-fg)]"
            : "rounded-tr-sm bg-[var(--user-bubble-bg)] text-[var(--user-bubble-fg)]"
        }`}
      >
        <p className="leading-relaxed">{turn.text}</p>
        {isAi && turn.translation && (
          <p className="mt-1 text-xs text-[var(--ai-translation)]">
            {turn.translation}
          </p>
        )}
        {isAi && (
          <button
            onClick={() => onReplay(turn.text)}
            className="mt-2 text-xs text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text-primary)]"
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
  return (
    <div className="mt-3 rounded-xl border border-[var(--feedback-border)] bg-[var(--feedback-bg)] p-3 text-xs text-[var(--text-secondary)]">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-[var(--text-primary)]">{feedback.headline}</span>
        <ScoreBadge label="Overall" score={feedback.score} />
      </div>
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        <span className="text-[var(--text-muted)]">Comprehension</span>
        <span className="font-semibold text-[var(--text-primary)]">{feedback.comprehension}</span>
        <span className="text-[var(--text-muted)]">Grammar</span>
        <span className="font-semibold text-[var(--text-primary)]">{feedback.grammar}</span>
        <span className="text-[var(--text-muted)]">Enunciation</span>
        <span className="font-semibold text-[var(--text-primary)]">{feedback.enunciation}</span>
      </div>
      {feedback.corrections.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 font-medium text-[var(--text-primary)]">Corrections</p>
          {feedback.corrections.map((c, i) => (
            <p key={i} className="mb-1">
              <s className="text-danger">{c.original || "…"}</s>{" "}
              <span className="font-semibold text-positive">{c.corrected}</span>{" "}
              <span className="text-[var(--text-muted)]">— {c.reason}</span>
            </p>
          ))}
        </div>
      )}
      {feedback.good_points.length > 0 && (
        <p className="mb-2 font-medium text-positive">✓ {feedback.good_points.join(" · ")}</p>
      )}
      {feedback.vocab.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 font-medium text-[var(--text-primary)]">Word roots</p>
          <div className="flex flex-wrap gap-1">
            {feedback.vocab
              .filter((v) => v.breakdown)
              .map((v, i) => (
                <span
                  key={i}
                  className="rounded bg-[var(--tag-bg)] px-1.5 py-0.5 text-[var(--text-primary)] ring-1 ring-[var(--tag-border)]"
                >
                  {v.word} → <b className="font-mono">{v.breakdown}</b>
                </span>
              ))}
          </div>
        </div>
      )}
      {feedback.suggestion && (
        <p className="italic text-[var(--text-muted)]">→ {feedback.suggestion}</p>
      )}
    </div>
  );
}

function ScoreBadge({ label, score }: { label: string; score: number }) {
  const color =
    score >= 75 ? "text-positive" : score >= 50 ? "text-warning" : "text-danger";
  return (
    <span className={`flex items-center gap-1 font-bold ${color}`}>
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
