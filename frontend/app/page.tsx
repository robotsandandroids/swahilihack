"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const { recording, error: recError, start, stop } = useRecorder();
  const bottomRef = useRef<HTMLDivElement>(null);

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
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">SemaAI</h1>
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={() => setTtsEnabled((v) => !v)}
            className={`rounded-full border px-3 py-1 ${
              ttsEnabled ? "border-black bg-black text-white" : "border-neutral-300 text-neutral-500"
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
              className="rounded-full border border-neutral-300 px-3 py-1"
            >
              New topic
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!session ? (
        <ScenarioGrid scenarios={scenarios} busy={busy} onPick={begin} />
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
      <div ref={bottomRef} />
    </main>
  );
}

function ScenarioGrid({
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
      <p className="text-neutral-500">
        Loading scenarios… If this stalls, is the backend running on :8000?
      </p>
    );
  }
  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Choose a situation to practice</h2>
      <p className="mb-4 text-sm text-neutral-500">
        You play yourself; the AI plays the other person. Respond by voice.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {scenarios.map((s) => (
          <button
            key={s.id}
            disabled={busy}
            onClick={() => onPick(s)}
            className="group rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:border-black disabled:opacity-50"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
                {s.difficulty}
              </span>
              <span className="text-xs text-neutral-400">{s.title_sw}</span>
            </div>
            <p className="font-medium text-neutral-900">{s.title}</p>
            <p className="mt-1 line-clamp-2 text-sm text-neutral-500">{s.context}</p>
            <div className="mt-3 flex flex-wrap gap-1">
              {s.key_vocab.slice(0, 5).map((v) => (
                <span key={v} className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">
                  {v}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </section>
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
          <h2 className="text-lg font-semibold">{session.scenario.title}</h2>
          <p className="text-sm text-neutral-500">{session.scenario.title_sw}</p>
        </div>
        <span className="text-sm text-neutral-500">
          {turnsLeft} turn{turnsLeft === 1 ? "" : "s"} left
        </span>
      </div>

      {session.scenario.hint_en && turns.length <= 1 && (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Hint: {session.scenario.hint_en}
        </p>
      )}

      <div className="mb-4 flex min-h-[300px] flex-col gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        {turns.map((t, i) => (
          <Message key={i} turn={t} onReplay={onReplay} />
        ))}
      </div>

      {recError && <p className="mb-2 text-sm text-red-600">{recError}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={onRecord}
          disabled={busy}
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-50 ${
            recording ? "animate-pulse bg-red-500" : "bg-black hover:bg-neutral-800"
          }`}
          aria-label={recording ? "Stop recording" : "Record reply"}
        >
          {recording ? (
            <span className="h-3 w-3 rounded-sm bg-white" />
          ) : (
            <MicIcon />
          )}
        </button>
        <input
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSend();
          }}
          placeholder="…or type your reply in Kiswahili"
          className="h-12 flex-1 rounded-full border border-neutral-300 bg-white px-4 text-sm outline-none focus:border-black"
        />
        <button
          onClick={onSend}
          disabled={busy || !textInput.trim()}
          className="h-12 shrink-0 rounded-full bg-black px-5 text-sm font-medium text-white disabled:opacity-40"
        >
          Send
        </button>
      </div>
      {busy && <p className="mt-2 text-center text-xs text-neutral-400">Listening & grading…</p>}
    </section>
  );
}

function Message({ turn, onReplay }: { turn: ChatTurn; onReplay: (t: string) => void }) {
  const isAi = turn.role === "ai";
  return (
    <div className={`flex ${isAi ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
          isAi ? "rounded-tl-sm bg-white text-neutral-900" : "rounded-tr-sm bg-black text-white"
        }`}
      >
        <p>{turn.text}</p>
        {isAi && turn.translation && (
          <p className={`mt-1 text-xs ${isAi ? "text-neutral-400" : "text-neutral-300"}`}>
            {turn.translation}
          </p>
        )}
        {isAi && (
          <button
            onClick={() => onReplay(turn.text)}
            className="mt-2 text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-600"
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
    <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold text-neutral-900">{feedback.headline}</span>
        <ScoreBadge label="Overall" score={feedback.score} />
      </div>
      <div className="mb-3 flex gap-3 text-[11px]">
        <span className="text-neutral-500">Comprehension</span>
        <span className="font-semibold">{feedback.comprehension}</span>
        <span className="text-neutral-500">Grammar</span>
        <span className="font-semibold">{feedback.grammar}</span>
        <span className="text-neutral-500">Enunciation</span>
        <span className="font-semibold">{feedback.enunciation}</span>
      </div>
      {feedback.corrections.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 font-medium text-neutral-900">Corrections</p>
          {feedback.corrections.map((c, i) => (
            <p key={i} className="mb-1">
              <s className="text-red-500">{c.original || "…"}</s>{" "}
              <span className="font-semibold text-emerald-600">{c.corrected}</span>{" "}
              <span className="text-neutral-500">— {c.reason}</span>
            </p>
          ))}
        </div>
      )}
      {feedback.good_points.length > 0 && (
        <p className="mb-2 text-emerald-700">✓ {feedback.good_points.join(" · ")}</p>
      )}
      {feedback.vocab.length > 0 && (
        <div className="mb-2">
          <p className="mb-1 font-medium text-neutral-900">Word roots</p>
          <div className="flex flex-wrap gap-1">
            {feedback.vocab
              .filter((v) => v.breakdown)
              .map((v, i) => (
                <span key={i} className="rounded bg-white px-1.5 py-0.5 ring-1 ring-neutral-200">
                  {v.word} → <b className="font-mono">{v.breakdown}</b>
                </span>
              ))}
          </div>
        </div>
      )}
      {feedback.suggestion && (
        <p className="italic text-neutral-500">→ {feedback.suggestion}</p>
      )}
    </div>
  );
}

function ScoreBadge({ label, score }: { label: string; score: number }) {
  const color = score >= 75 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-600";
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

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
    </svg>
  );
}