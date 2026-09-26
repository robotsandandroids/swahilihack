   "use client";

    import { useCallback, useEffect, useRef, useState } from "react";
    import {
      BookOpen,
      Bus,
      Briefcase,
      Car,
      CheckCircle,
      ChevronRight,
      Coffee,
      Dices,
      Hand,
      Languages,
      Landmark,
      type LucideIcon,
      MapPin,
      MessageSquare,
      Mic,
      Moon,
      MoreHorizontal,
      Pause,
      Play,
      RotateCcw,
      Smartphone,
      Stethoscope,
      Store,
      Sun,
      Trophy,
      TrendingUp,
      Volume2,
      VolumeX,
      X,
      Home as HomeIcon,
    } from "lucide-react";
    import {
      type ChatTurn,
      type Feedback,
      type Scenario,
      type StartedSession,
      type TurnResponse,
      listScenarios,
      startSession,
      stemWord,
      submitTurn,
    } from "@/lib/api";
    import { useRecorder } from "@/lib/useRecorder";
    import LandingPage from "./landing";
    import { speakAzure, cancelAzureTTS } from "@/lib/tts";

    // Mzizi AI identity: greens/limes/gold only
    const LOCATION_META: Record<
      string,
      { sw: string; icon: LucideIcon; color: string; colorLight: string }
    > = {
      market: { sw: "Sokoni", icon: Store, color: "#C6F135", colorLight: "#4d7c0f" },
      taxi: { sw: "Teksini", icon: Car, color: "#6EE7B7", colorLight: "#059669" },
      restaurant: { sw: "Mkahawani", icon: Coffee, color: "#E3C067", colorLight: "#b45309" },
      neighbourhood: { sw: "Mtaani", icon: Hand, color: "#A3E635", colorLight: "#4d7c0f" },
      clinic: { sw: "Hospitalini", icon: Stethoscope, color: "#5EEAD4", colorLight: "#0f766e" },
      bank: { sw: "Benkini", icon: Landmark, color: "#86EFAC", colorLight: "#15803d" },
      town: { sw: "Mjini", icon: Bus, color: "#C6F135", colorLight: "#4d7c0f" },
      phone_shop: { sw: "Simukani", icon: Smartphone, color: "#5EEAD4", colorLight: "#0f766e" },
      office: { sw: "Ofisini", icon: Briefcase, color: "#6EE7B7", colorLight: "#059669" },
      real_estate: { sw: "Nyumbani", icon: HomeIcon, color: "#A3E635", colorLight: "#4d7c0f" },
    };

    const BEST_SCORES: Record<string, number> = {
      "market-tomatoes": 82,
      "taxi-fare": 76,
      "restaurant-order": 91,
      "greeting-older": 72,
      "clinic-complaint": 64,
      "directions-city": 58,
    };

    function locationMeta(location: string) {
      return (
        LOCATION_META[location] ?? {
          sw: location,
          icon: MapPin,
          color: "#C6F135",
          colorLight: "#4d7c0f",
        }
      );
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
        "needs-work": "text-danger",
      }[tier];
    }

    function speak(
      text: string,
      enabled: boolean,
      onStart?: () => void,
      onEnd?: () => void,
      mode: "swahili" | "codeswitched" = "swahili",
    ) {
      if (!enabled) {
        onEnd?.();
        return;
      }
      // Use Azure Neural TTS (edge-tts backend) — fires in parallel, plays when ready
      speakAzure(text, { mode, onStart, onEnd });
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

    function formatCallTime(secs: number) {
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      return `${m}:${s < 10 ? "0" : ""}${s}`;
    }

    function SplashLoading() {
      return (
        <main className="flex min-h-dvh items-center justify-center bg-background">
          <div className="text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-xl bg-brand" />
            <p className="text-sm text-[var(--text-muted)]">Loading Mzizi…</p>
          </div>
        </main>
      );
    }

    function ScenarioError({
      message,
      onRetry,
    }: {
      message: string | null;
      onRetry: () => void;
    }) {
      return (
        <main className="flex min-h-dvh items-center justify-center p-6 bg-background">
          <div className="w-full max-w-md rounded-2xl border border-[var(--panel-border)] bg-panel p-6 text-center shadow-sm">
            <h2 className="mb-2 text-lg font-semibold text-[var(--text-primary)]">
              Couldn’t load scenarios
            </h2>
            <p className="mb-5 text-sm text-[var(--text-muted)]">
              {message || "Something went wrong while loading practice scenarios."}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
            >
              Try again
            </button>
          </div>
        </main>
      );
    }

    export default function Home() {
      const [view, setView] = useState<"landing" | "app">("landing");
      const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);
      const [scenarios, setScenarios] = useState<Scenario[]>([]);
      const [session, setSession] = useState<StartedSession | null>(null);
      const [turns, setTurns] = useState<ChatTurn[]>([]);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState<string | null>(null);
      const [textInput, setTextInput] = useState("");
      const [ttsEnabled, setTtsEnabled] = useState(true);
      const [isAiSpeaking, setIsAiSpeaking] = useState(false);
      const [isPaused, setIsPaused] = useState(false);
      const [recordingSeconds, setRecordingSeconds] = useState(0);
      const [scenarioLoad, setScenarioLoad] = useState<"loading" | "loaded" | "error">("loading");
      const [sessionSummary, setSessionSummary] = useState<SessionSummaryData | null>(null);
      const [lastAttempt, setLastAttempt] = useState<{ audio?: Blob; text?: string } | null>(null);
      const { recording, error: recError, start, stop } = useRecorder();
      const bottomRef = useRef<HTMLDivElement>(null);

      useEffect(() => {
        if (theme === "dark") {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
      }, [theme]);

      // Restore app view for returning users — runs client-side only, no SSR mismatch
      useEffect(() => {
        try {
          if (localStorage.getItem("sema_seen") === "1") setView("app");
        } catch {}
      }, []);

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
        if (!recording) return;
        const interval = window.setInterval(() => {
          setRecordingSeconds((prev) => prev + 1);
        }, 1000);
        return () => window.clearInterval(interval);
      }, [recording]);

      const launchApp = useCallback(() => {
        try { localStorage.setItem("sema_seen", "1"); } catch {}
        setView("app");
      }, []);

      const loadScenarios = useCallback(() => {
        setScenarioLoad("loading");
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
          setIsPaused(false);
          try {
            const s = await startSession(scenario.id);
            setSession(s);
            setTurns([
              { role: "ai", text: s.opening_line, translation: s.scenario.context },
            ]);
            speak(
              s.opening_line,
              ttsEnabled,
              () => setIsAiSpeaking(true),
              () => setIsAiSpeaking(false),
            );
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
          setLastAttempt(null);
          try {
            const res = await submitTurn(session.session_id, { audio, transcript: fallbackText });
            const aiTurn: ChatTurn = {
              role: "ai",
              text: res.ai_text,
              translation: res.ai_translation,
              feedback: res.feedback ? await enrichVocab(res.feedback) : undefined,
            };
            setTurns((prev) => [...prev, aiTurn]);
            speak(
              res.ai_text,
              ttsEnabled,
              () => setIsAiSpeaking(true),
              () => setIsAiSpeaking(false),
            );
            return res;
          } catch (e) {
            setError((e as Error).message);
            setLastAttempt({ audio, text: fallbackText });
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
          cancelAzureTTS();
            setIsAiSpeaking(false);
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
        (text: string) =>
          speak(
            text,
            true,
            () => setIsAiSpeaking(true),
            () => setIsAiSpeaking(false),
          ),
        [],
      );

      const retryLast = useCallback(async () => {
        if (!lastAttempt) return;
        const { audio, text } = lastAttempt;
        await respondTo(audio, text);
      }, [lastAttempt, respondTo]);

      const togglePause = useCallback(() => {
        setIsPaused((prev) => {
          const next = !prev;
          // HTMLAudioElement doesn't support pause/resume mid-TTS easily;
          // we cancel on pause and the user can replay. Acceptable UX tradeoff.
          if (next) cancelAzureTTS();
          return next;
        });
      }, []);

      const exitSession = useCallback((currentTurns?: ChatTurn[], currentSession?: StartedSession | null) => {
        cancelAzureTTS();
        // Compute summary from turns before clearing
        const turnsToUse = currentTurns !== undefined ? currentTurns : [];
        const sessionToUse = currentSession !== undefined ? currentSession : null;
        const feedbacks = turnsToUse.filter((t) => t.role === "ai" && t.feedback).map((t) => t.feedback!);
        if (feedbacks.length > 0 && sessionToUse) {
          const avgScore = Math.round(feedbacks.reduce((s, f) => s + f.score, 0) / feedbacks.length);
          const avgGrammar = Math.round(feedbacks.reduce((s, f) => s + f.grammar, 0) / feedbacks.length);
          const avgComprehension = Math.round(feedbacks.reduce((s, f) => s + f.comprehension, 0) / feedbacks.length);
          const avgEnunciation = Math.round(feedbacks.reduce((s, f) => s + f.enunciation, 0) / feedbacks.length);
          const allCorrections = feedbacks.flatMap((f) => f.corrections);
          const allGoodPoints = [...new Set(feedbacks.flatMap((f) => f.good_points))];
          const suggestions = feedbacks.map((f) => f.suggestion).filter(Boolean);
          setSessionSummary({
            scenario: sessionToUse.scenario,
            overallScore: avgScore,
            grammar: avgGrammar,
            comprehension: avgComprehension,
            enunciation: avgEnunciation,
            turnsCompleted: turnsToUse.filter((t) => t.role === "user").length,
            maxTurns: sessionToUse.max_turns,
            corrections: allCorrections,
            goodPoints: allGoodPoints,
            suggestions,
          });
        }
        setSession(null);
        setTurns([]);
        setIsAiSpeaking(false);
        setIsPaused(false);
        setError(null);
      }, []);

      if (view === "landing") {
        return <LandingPage onLaunch={launchApp} />;
      }

      if (scenarioLoad === "loading") {
        return <SplashLoading />;
      }

      if (scenarioLoad === "error") {
        return <ScenarioError message={error} onRetry={loadScenarios} />;
      }

      return (
        <>
        <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col p-4 sm:p-6 lg:p-10">
          <div className="min-h-[580px] flex-1 rounded-2xl border border-[var(--panel-border)] bg-panel px-4 py-6 shadow-sm transition-colors sm:px-10 sm:py-8 dashboard-enter">
            {!session ? (
              <>
                <header className="mb-7 flex items-center justify-between">
                  <button
                    onClick={() => setView("landing")}
                    className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)] transition hover:opacity-75"
                    aria-label="Go to home"
                  >
                    <div className="h-[26px] w-[26px] rounded-[7px] bg-brand shadow-xs" />
                    Mzizi
                  </button>
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
                    <div className="h-8 w-8 rounded-full border border-[var(--card-border)] bg-[var(--avatar-bg)]" />
                  </div>
                </header>

                {error && (
                  <div className="mb-4 rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-danger">
                    {error}
                  </div>
                )}

                <HomeMenu
                  scenarios={scenarios}
                  busy={busy}
                  onPick={begin}
                  theme={theme}
                />
              </>
            ) : (
              <VoiceModule
                session={session}
                turns={turns}
                recording={recording}
                recordingSeconds={recordingSeconds}
                recError={recError}
                busy={busy}
                isAiSpeaking={isAiSpeaking}
                isPaused={isPaused}
                ttsEnabled={ttsEnabled}
                theme={theme}
                textInput={textInput}
                setTextInput={setTextInput}
                turnError={error}
                hasRetry={!!lastAttempt}
                onTogglePause={togglePause}
                onToggleTts={() => setTtsEnabled((v) => !v)}
                onToggleTheme={toggleTheme}
                onRecord={recordAndSend}
                onSendText={sendText}
                onRetry={retryLast}
                onExit={() => exitSession(turns, session)}
                onReplay={replay}
              />
            )}
          </div>
          <div ref={bottomRef} />
        </main>
        {sessionSummary && (
          <SessionSummaryModal
            data={sessionSummary}
            onClose={() => setSessionSummary(null)}
          />
        )}
        </>
      );
    }

    function RobotIcon({ className = "h-16 w-16 text-[#F0997B]" }: { className?: string }) {
      return (
        <svg
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={className}
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="5" x2="18" y2="10" />
          <line x1="30" y1="5" x2="30" y2="10" />
          <rect x="12" y="10" width="24" height="18" rx="4" />
          <circle cx="18" cy="18" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="30" cy="18" r="1.5" fill="currentColor" stroke="none" />
          <line x1="20" y1="23" x2="28" y2="23" />
          <rect x="16" y="28" width="16" height="10" rx="2" />
          <path d="M12 30 L8 34 L8 38" />
          <path d="M36 30 L40 34 L40 38" />
          <line x1="20" y1="38" x2="20" y2="44" />
          <line x1="28" y1="38" x2="28" y2="44" />
        </svg>
      );
    }

    function WaveformVisualizer({ active }: { active: boolean }) {
      const bars = [14, 22, 32, 44, 32, 22, 14];
      return (
        <div className="flex h-12 items-center justify-center gap-1.5">
          {bars.map((h, i) => (
            <span
              key={i}
              className={`w-1 rounded-full bg-brand transition-all duration-300 ${
                active ? "animate-waveform" : "opacity-80"
              }`}
              style={{
                height: active ? `${h}px` : `${Math.max(8, h * 0.35)}px`,
                animationDelay: `${i * 110}ms`,
              }}
            />
          ))}
        </div>
      );
    }

    function VoiceModule({
      session,
      turns,
      recording,
      recordingSeconds,
      recError,
      busy,
      isAiSpeaking,
      isPaused,
      ttsEnabled,
      theme,
      textInput,
      setTextInput,
      onTogglePause,
      onToggleTts,
      onToggleTheme,
      turnError,
      hasRetry,
      onRecord,
      onSendText,
      onRetry,
      onExit,
      onReplay,
    }: {
      session: StartedSession;
      turns: ChatTurn[];
      recording: boolean;
      recordingSeconds: number;
      recError: string | null;
      busy: boolean;
      isAiSpeaking: boolean;
      isPaused: boolean;
      ttsEnabled: boolean;
      theme: "light" | "dark";
      textInput: string;
      setTextInput: (v: string) => void;
      onTogglePause: () => void;
      onToggleTts: () => void;
      onToggleTheme: () => void;
      turnError: string | null;
      hasRetry: boolean;
      onRecord: () => void;
      onSendText: () => void;
      onRetry: () => void;
      onExit: () => void;
      onReplay: (t: string) => void;
    }) {
      const [callSeconds, setCallSeconds] = useState(0);
      const [showSubtitles, setShowSubtitles] = useState(false);
      const [showMenu, setShowMenu] = useState(false);
      const [viewMode, setViewMode] = useState<"voice" | "chat">("voice");

      useEffect(() => {
        if (isPaused) return;
        const interval = setInterval(() => {
          setCallSeconds((s) => s + 1);
        }, 1000);
        return () => clearInterval(interval);
      }, [isPaused]);

      const meta = locationMeta(session.scenario.location);
      const latestAiTurn = [...turns].reverse().find((t) => t.role === "ai");
      const turnsLeft = Math.max(session.max_turns - turns.filter((t) => t.role === "user").length, 0);

      const pillText = `${meta.sw} · ${session.scenario.hint_en ?? session.scenario.title}`;

      if (viewMode === "chat") {
        return (
          <div className="flex flex-col">
            <div className="mb-4 flex items-center justify-between border-b border-[var(--card-border)] pb-3">
              <button
                onClick={() => setViewMode("voice")}
                className="flex items-center gap-1.5 rounded-full border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-medium text-brand transition hover:bg-brand/20"
              >
                ← Return to voice call
              </button>
              <button
                onClick={onExit}
                className="rounded-full border border-[var(--card-border)] px-3 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              >
                End session
              </button>
            </div>

            <Conversation
              session={session}
              turns={turns}
              recording={recording}
              recordingSeconds={recordingSeconds}
              recError={recError}
              busy={busy}
              textInput={textInput}
              setTextInput={setTextInput}
              turnError={turnError}
              hasRetry={hasRetry}
              onRecord={onRecord}
              onSend={onSendText}
              onRetry={onRetry}
              onReplay={onReplay}
            />
          </div>
        );
      }

      return (
        <div className="relative flex min-h-[540px] flex-col justify-between py-2 sm:py-4">
          {/* Top Bar */}
          <div className="flex items-center justify-between">
            <button
              onClick={onExit}
              className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
              aria-label="Exit call"
              title="Exit call"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)]">
              <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{formatCallTime(callSeconds)}</span>
            </div>

            <div className="relative">
              <button
                onClick={() => setShowMenu((v) => !v)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
                aria-label="More options"
                title="More options"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>

              {showMenu && (
                <div className="absolute right-0 top-12 z-20 w-48 rounded-xl border border-[var(--card-border)] bg-panel p-2 shadow-lg animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
                    {turnsLeft} turn{turnsLeft === 1 ? "" : "s"} remaining
                  </div>
                  <div className="my-1 border-t border-[var(--card-border)]" />
                  <button
                    onClick={() => {
                      setViewMode("chat");
                      setShowMenu(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] transition hover:bg-[var(--card-hover)]"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    <span>Text chat mode</span>
                  </button>
                  <button
                    onClick={() => {
                      onToggleTts();
                      setShowMenu(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] transition hover:bg-[var(--card-hover)]"
                  >
                    {ttsEnabled ? (
                      <>
                        <Volume2 className="h-3.5 w-3.5 text-brand" />
                        <span>Mute AI voice</span>
                      </>
                    ) : (
                      <>
                        <VolumeX className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                        <span>Unmute AI voice</span>
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      onToggleTheme();
                      setShowMenu(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] transition hover:bg-[var(--card-hover)]"
                  >
                    {theme === "dark" ? (
                      <>
                        <Sun className="h-3.5 w-3.5 text-warning" />
                        <span>Light theme</span>
                      </>
                    ) : (
                      <>
                        <Moon className="h-3.5 w-3.5" />
                        <span>Dark theme</span>
                      </>
                    )}
                  </button>
                  <div className="my-1 border-t border-[var(--card-border)]" />
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      onExit();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-danger transition hover:bg-danger/10"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span>End scenario</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Center Voice Module Content */}
          <div className="my-auto flex flex-col items-center justify-center py-6 text-center">
            <div className="mb-8 max-w-sm sm:max-w-md truncate rounded-full border border-brand/35 bg-brand/[0.08] px-5 py-2 text-xs sm:text-[13px] font-medium text-brand-soft shadow-xs">
              <span>{pillText}</span>
            </div>

            <div className="relative mb-8 flex items-center justify-center">
              <div
                className={`absolute h-44 w-44 rounded-full transition-all duration-700 ${
                  recording || isAiSpeaking
                    ? "scale-115 bg-brand/25 blur-2xl"
                    : "scale-100 bg-brand/12 blur-xl"
                }`}
              />
              <div className="relative flex h-36 w-36 items-center justify-center rounded-full border border-brand/25 bg-[#161413] shadow-inner transition-transform duration-300">
                <RobotIcon className="h-16 w-16 text-[#F0997B]" />
              </div>
            </div>

            <div className="mb-4">
              <WaveformVisualizer active={recording || isAiSpeaking} />
            </div>

            <p className="text-sm font-medium tracking-wide text-[var(--text-muted)]">
              {recording
                ? "Listening..."
                : isAiSpeaking
                ? "Amara is speaking..."
                : busy
                ? "Listening & grading…"
                : isPaused
                ? "Paused"
                : "Listening..."}
            </p>

            {showSubtitles && latestAiTurn && (
              <div className="mt-5 w-full max-w-md rounded-2xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4 text-left shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-200">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {latestAiTurn.text}
                    </p>
                    {latestAiTurn.translation && (
                      <p className="mt-1 text-xs text-[var(--ai-translation)]">
                        {latestAiTurn.translation}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => onReplay(latestAiTurn.text)}
                    className="shrink-0 text-xs text-[var(--text-muted)] underline hover:text-[var(--text-primary)]"
                  >
                    replay
                  </button>
                </div>

                {latestAiTurn.feedback && (
                  <div className="mt-3 border-t border-[var(--card-border)] pt-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--text-primary)]">
                        {latestAiTurn.feedback.headline}
                      </span>
                      <ScoreBadge label="Score" score={latestAiTurn.feedback.score} />
                    </div>
                    {latestAiTurn.feedback.corrections.length > 0 && (
                      <p className="mt-1.5 text-[11px]">
                        <s className="text-danger">
                          {latestAiTurn.feedback.corrections[0].original || "…"}
                        </s>{" "}
                        <span className="font-semibold text-positive">
                          {latestAiTurn.feedback.corrections[0].corrected}
                        </span>{" "}
                        <span className="text-[var(--text-muted)]">
                          — {latestAiTurn.feedback.corrections[0].reason}
                        </span>
                      </p>
                    )}
                    {latestAiTurn.feedback.vocab.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {latestAiTurn.feedback.vocab
                          .filter((v) => v.breakdown)
                          .map((v, i) => (
                            <span
                              key={i}
                              className="rounded bg-[var(--tag-bg)] px-1.5 py-0.5 text-[10px] text-[var(--text-primary)] ring-1 ring-[var(--tag-border)]"
                            >
                              {v.word} → <b className="font-mono">{v.breakdown}</b>
                            </span>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {recError && <p className="mt-3 text-xs text-danger">{recError}</p>}
            {turnError && (
              <div className="mt-4 flex w-full max-w-md items-start gap-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-danger leading-snug">{turnError}</p>
                </div>
                {hasRetry && (
                  <button
                    onClick={onRetry}
                    disabled={busy}
                    className="shrink-0 rounded-full bg-danger px-3 py-1 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Bottom Controls */}
          <div className="mt-4 flex items-center justify-center gap-6">
            <button
              onClick={() => setShowSubtitles((v) => !v)}
              className={`flex h-14 w-14 items-center justify-center rounded-full border transition ${
                showSubtitles
                  ? "border-brand bg-brand/20 text-brand"
                  : "border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)] hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
              }`}
              title={showSubtitles ? "Hide subtitles & feedback" : "Show subtitles & feedback"}
              aria-label="Toggle subtitles"
            >
              <Languages className="h-5 w-5" />
            </button>

            <button
              onClick={onRecord}
              disabled={busy}
              className={`relative flex h-20 w-20 items-center justify-center rounded-full bg-brand text-white shadow-xl
  transition-transform duration-200 hover:scale-105 active:scale-95 disabled:opacity-50 ${
                recording
                  ? "ring-4 ring-brand/50 ring-offset-2 ring-offset-panel animate-pulse"
                  : ""
              }`}
              title={recording ? "Stop speaking" : "Start speaking"}
              aria-label={recording ? "Stop speaking" : "Start speaking"}
            >
              {recording ? (
                <span className="h-5 w-5 rounded-sm bg-white" />
              ) : (
                <Mic className="h-8 w-8 text-white" />
              )}
            </button>

            <button
              onClick={onTogglePause}
              className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] text-[var(--text-secondary)] transition hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
              title={isPaused ? "Resume call" : "Pause call"}
              aria-label={isPaused ? "Resume call" : "Pause call"}
            >
              {isPaused ? <Play className="h-5 w-5 fill-current" /> : <Pause className="h-5 w-5" />}
            </button>
          </div>
        </div>
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
            No practice scenarios available right now. Check back soon.
          </p>
        );
      }

      const suggested =
        scenarios.find((s) => s.id === "market-tomatoes") ?? scenarios[0];
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

          {/* Score summary row */}
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

          {/* Suggested scenario */}
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
      recordingSeconds,
      recError,
      busy,
      textInput,
      setTextInput,
      turnError,
      hasRetry,
      onRecord,
      onSend,
      onRetry,
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
      turnError: string | null;
      hasRetry: boolean;
      onRecord: () => void;
      onSend: () => void;
      onRetry: () => void;
      onReplay: (text: string) => void;
    }) {
      const turnsLeft = Math.max(
        session.max_turns - turns.filter((t) => t.role === "user").length,
        0,
      );

      const formattedRecordingTime = `${Math.floor(recordingSeconds / 60)}:${String(
        recordingSeconds % 60,
      ).padStart(2, "0")}`;

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

          {(recError || turnError) && (
            <div className="mb-2 flex items-start gap-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-2.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-danger leading-snug">
                  {turnError ?? recError}
                </p>
              </div>
              {hasRetry && turnError && (
                <button
                  onClick={onRetry}
                  disabled={busy}
                  className="shrink-0 rounded-full bg-danger px-3 py-1 text-xs font-medium text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  Retry
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={onRecord}
              disabled={busy}
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white shadow-sm transition
  disabled:opacity-50 ${
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

          <style jsx>{`
            .recording-bar {
              display: block;
              width: 3px;
              border-radius: 9999px;
              background: var(--brand);
              animation: recording-bar 0.9s ease-in-out infinite alternate;
              transform-origin: bottom center;
            }
            .recording-bar:nth-child(1) { height: 35%; }
            .recording-bar:nth-child(2) { height: 60%; }
            .recording-bar:nth-child(3) { height: 85%; }
            .recording-bar:nth-child(4) { height: 100%; }

            @keyframes recording-bar {
              0% { opacity: 0.35; transform: scaleY(0.5); }
              100% { opacity: 1; transform: scaleY(1); }
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
      const [showAllVocab, setShowAllVocab] = useState(false);
      const vocabEntries = feedback.vocab.filter((v) => v.breakdown);
      const visibleVocab =
        showAllVocab || vocabEntries.length <= 4
          ? vocabEntries
          : vocabEntries.slice(0, 4);

      return (
        <div className="mt-3 rounded-xl border border-[var(--feedback-border)] bg-[var(--feedback-bg)] p-3 text-xs text-[var(--text-secondary)] feedback-panel-enter">
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
                {visibleVocab.map((v, i) => (
                  <span
                    key={i}
                    className="rounded bg-[var(--tag-bg)] px-1.5 py-0.5 text-[10px] text-[var(--text-primary)] ring-1 ring-[var(--tag-border)]"
                  >
                    {v.word} → <b className="font-mono">{v.breakdown}</b>
                  </span>
                ))}
              </div>

              {vocabEntries.length > 4 && (
                <button
                  type="button"
                  onClick={() => setShowAllVocab((v) => !v)}
                  className="mt-2 text-[11px] text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text-primary)]"
                >
                  {showAllVocab ? "Show less" : `Show ${vocabEntries.length - 4} more`}
                </button>
              )}
            </div>
          )}

          {feedback.suggestion && (
            <p className="italic text-[var(--text-muted)]">→ {feedback.suggestion}</p>
          )}

          <style jsx>{`
            @keyframes feedback-panel-enter {
              0% { opacity: 0; transform: translateY(8px); }
              100% { opacity: 1; transform: translateY(0); }
            }
            .feedback-panel-enter {
              animation: feedback-panel-enter 0.35s ease-out both;
            }
          `}</style>
        </div>
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

    interface SessionSummaryData {
      scenario: Scenario;
      overallScore: number;
      grammar: number;
      comprehension: number;
      enunciation: number;
      turnsCompleted: number;
      maxTurns: number;
      corrections: import("@/lib/api").Correction[];
      goodPoints: string[];
      suggestions: string[];
    }

    function SessionSummaryModal({
      data,
      onClose,
    }: {
      data: SessionSummaryData;
      onClose: () => void;
    }) {
      const meta = locationMeta(data.scenario.location);
      const tier = scoreTier(data.overallScore);
      const tierConfig = {
        good: { label: "Great job!", color: "text-positive", icon: Trophy, ringColor: "ring-positive/30 bg-positive/10" },
        mid: { label: "Keep it up!", color: "text-warning", icon: TrendingUp, ringColor: "ring-warning/30 bg-warning/10" },
        "needs-work": { label: "Room to grow!", color: "text-danger", icon: BookOpen, ringColor: "ring-danger/30 bg-danger/10" },
      }[tier];
      const TierIcon = tierConfig.icon;

      const subscores = [
        { label: "Grammar", value: data.grammar },
        { label: "Comprehension", value: data.comprehension },
        { label: "Enunciation", value: data.enunciation },
      ].sort((a, b) => a.value - b.value);

      const focusAreas = subscores.filter((s) => s.value < 75).slice(0, 2);

      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <div
            className="relative w-full max-w-md rounded-2xl border border-[var(--panel-border)] bg-panel shadow-2xl animate-in fade-in zoom-in-95 duration-200"
            style={{ maxHeight: "90dvh", overflowY: "auto" }}
          >
            <button
              onClick={onClose}
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-muted)] transition hover:bg-[var(--card-hover)] hover:text-[var(--text-primary)]"
              aria-label="Close summary"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="p-6 pb-2">
              <div className="mb-5 flex flex-col items-center text-center">
                <div className={`mb-3 flex h-16 w-16 items-center justify-center rounded-full ring-2 ${tierConfig.ringColor}`}>
                  <TierIcon className={`h-8 w-8 ${tierConfig.color}`} />
                </div>
                <p className={`text-lg font-semibold ${tierConfig.color}`}>{tierConfig.label}</p>
                <p className="mt-0.5 text-sm text-[var(--text-muted)]">
                  {meta.sw} · {data.scenario.title}
                </p>
              </div>

              <div className="mb-5 flex flex-col items-center">
                <div className={`text-5xl font-bold tabular-nums ${scoreTextClass(data.overallScore)}`}>
                  {data.overallScore}
                </div>
                <div className="mt-0.5 text-xs text-[var(--text-muted)]">overall score / 100</div>
              </div>

              <div className="mb-5 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">Skill breakdown</p>
                <div className="flex flex-col gap-2.5">
                  {[
                    { label: "Comprehension", value: data.comprehension },
                    { label: "Grammar", value: data.grammar },
                    { label: "Enunciation", value: data.enunciation },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center gap-3">
                      <span className="w-28 shrink-0 text-xs text-[var(--text-secondary)]">{label}</span>
                      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[var(--card-border)]">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            value >= 75 ? "bg-positive" : value >= 50 ? "bg-warning" : "bg-danger"
                          }`}
                          style={{ width: `${value}%` }}
                        />
                      </div>
                      <span className={`w-8 shrink-0 text-right text-xs font-semibold ${scoreTextClass(value)}`}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 text-right text-[11px] text-[var(--text-faint)]">
                  {data.turnsCompleted} / {data.maxTurns} turns completed
                </div>
              </div>

              {data.goodPoints.length > 0 && (
                <div className="mb-4 rounded-xl border border-[var(--card-border)] bg-[var(--positive-bg)] p-3">
                  <p className="mb-2 text-xs font-semibold text-positive">What went well</p>
                  <ul className="flex flex-col gap-1">
                    {data.goodPoints.slice(0, 3).map((pt, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
                        <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" />
                        {pt}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {focusAreas.length > 0 && (
                <div className="mb-4 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3">
                  <p className="mb-2 text-xs font-semibold text-warning">Focus on next time</p>
                  <ul className="flex flex-col gap-1.5">
                    {focusAreas.map((area) => (
                      <li key={area.label} className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-warning" />
                        <span>
                          <span className="font-medium">{area.label}</span>{" "}
                          <span className="text-[var(--text-muted)]">— scored {area.value}/100, keep practising</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.corrections.length > 0 && (
                <div className="mb-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3">
                  <p className="mb-2 text-xs font-semibold text-[var(--text-primary)]">Common corrections</p>
                  <ul className="flex flex-col gap-1.5">
                    {data.corrections.slice(0, 3).map((c, i) => (
                      <li key={i} className="text-xs">
                        <s className="text-danger">{c.original || "…"}</s>{" "}
                        <span className="font-semibold text-positive">{c.corrected}</span>{" "}
                        <span className="text-[var(--text-muted)]">— {c.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.suggestions.length > 0 && (
                <div className="mb-4 rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-3">
                  <p className="mb-1 text-xs font-semibold text-[var(--text-primary)]">Coach tip</p>
                  <p className="text-xs italic text-[var(--text-muted)]">→ {data.suggestions[data.suggestions.length - 1]}</p>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 flex gap-3 rounded-b-2xl border-t border-[var(--card-border)] bg-panel px-6 py-4">
              <button
                onClick={onClose}
                className="flex-1 rounded-full border border-[var(--btn-secondary-border)] py-2.5 text-sm text-[var(--btn-secondary-text)] transition hover:bg-[var(--btn-secondary-hover-bg)]"
              >
                Back to scenarios
              </button>
              <button
                onClick={onClose}
                className="flex-1 rounded-full bg-brand py-2.5 text-sm font-medium text-white shadow-xs transition hover:brightness-110"
              >
                Practice again
              </button>
            </div>
          </div>
        </div>
      );
    }

