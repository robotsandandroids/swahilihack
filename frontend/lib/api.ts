export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface Scenario {
  id: string;
  title: string;
  title_sw: string;
  context: string;
  location: string;
  difficulty: Difficulty;
  opening_line: string;
  hint_sw: string | null;
  hint_en: string | null;
  key_vocab: string[];
}

export interface Correction {
  original: string;
  corrected: string;
  reason: string;
}

export interface VocabNote {
  word: string;
  breakdown: string;
  note: string;
}

export interface Feedback {
  score: number;
  comprehension: number;
  grammar: number;
  enunciation: number;
  headline: string;
  corrections: Correction[];
  good_points: string[];
  vocab: VocabNote[];
  suggestion: string;
}

export interface TurnResponse {
  ai_text: string;
  ai_translation: string;
  feedback: Feedback | null;
  session_status: "active" | "completed";
  turn: number;
  turns_left: number;
}

export interface StartedSession {
  session_id: string;
  scenario: Scenario;
  opening_line: string;
  opening_line_en?: string;
  difficulty: Difficulty;
  max_turns: number;
}

export interface ChatTurn {
  role: "ai" | "user";
  text: string;
  translation?: string;
  feedback?: Feedback;
}

export interface StemSegment {
  segment: string;
  kind: string;
  gloss: string;
}

export interface StemAnalysis {
  word: string;
  breakdown: string;
  segments: StemSegment[];
  lemma: string;
  is_swahili: boolean;
  confidence: number;
}

export interface SentenceDiagnostic {
  sentence: string;
  root?: string;
  given_marker?: string;
  expected_marker?: string;
  cue?: string;
  error_type?: string;
  has_error: boolean;
}

export interface HealthResponse {
  status: string;
  app: string;
  stt_engine: string;
  llm_provider: string;
  llm_model: string;
  llm_max_tokens: number;
}

// In the browser, default to "" so requests use the same-origin Next.js API routes (/api/*).
// In SSR or when explicitly configured, use NEXT_PUBLIC_API_URL or BACKEND_URL.
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (typeof window === "undefined"
    ? (process.env.BACKEND_URL || "http://127.0.0.1:8000")
    : "");

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* keep default */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export async function listScenarios(difficulty?: Difficulty): Promise<Scenario[]> {
  const qs = difficulty ? `?difficulty=${difficulty}` : "";
  return handle<Scenario[]>(await fetch(`${API_URL}/api/scenarios${qs}`));
}

export async function getScenario(scenarioId: string): Promise<Scenario> {
  return handle<Scenario>(
    await fetch(`${API_URL}/api/scenarios/${encodeURIComponent(scenarioId)}`),
  );
}

export async function stemWord(word: string): Promise<StemAnalysis> {
  return handle<StemAnalysis>(
    await fetch(`${API_URL}/api/stem?word=${encodeURIComponent(word)}`),
  );
}

export async function stemBatch(words: string[]): Promise<StemAnalysis[]> {
  return handle<StemAnalysis[]>(
    await fetch(`${API_URL}/api/stem/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(words),
    }),
  );
}

export async function stemSentence(sentence: string): Promise<SentenceDiagnostic> {
  return handle<SentenceDiagnostic>(
    await fetch(`${API_URL}/api/stem/sentence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentence }),
    }),
  );
}

export async function startSession(
  scenarioId: string,
  difficulty?: Difficulty,
): Promise<StartedSession> {
  return handle<StartedSession>(
    await fetch(`${API_URL}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenario_id: scenarioId,
        ...(difficulty ? { difficulty } : {}),
      }),
    }),
  );
}

export async function getSession(sessionId: string): Promise<StartedSession> {
  return handle<StartedSession>(
    await fetch(`${API_URL}/api/sessions/${encodeURIComponent(sessionId)}`),
  );
}

export async function submitTurn(
  sessionId: string,
  payload: { audio?: Blob; transcript?: string; skip_stt?: boolean },
): Promise<TurnResponse> {
  const targetUrl = `${API_URL}/api/sessions/${encodeURIComponent(sessionId)}/turns`;

  if (payload.audio) {
    const form = new FormData();
    form.append("audio", payload.audio, "recording.webm");
    if (payload.transcript) {
      form.append("transcript", payload.transcript);
    }
    if (payload.skip_stt) {
      form.append("skip_stt", "true");
    }
    return handle<TurnResponse>(
      await fetch(targetUrl, {
        method: "POST",
        body: form,
      }),
    );
  }

  return handle<TurnResponse>(
    await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript: payload.transcript ?? "",
        skip_stt: payload.skip_stt ?? false,
      }),
    }),
  );
}

export async function textToSpeech(text: string): Promise<Blob> {
  const form = new FormData();
  form.append("text", text);
  const res = await fetch(`${API_URL}/api/tts`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let detail = `TTS request failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {}
    throw new Error(detail);
  }
  return res.blob();
}

export async function getHealth(): Promise<HealthResponse> {
  return handle<HealthResponse>(await fetch(`${API_URL}/api/health`));
}