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
  difficulty: Difficulty;
  max_turns: number;
}

export interface ChatTurn {
  role: "ai" | "user";
  text: string;
  translation?: string;
  feedback?: Feedback;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      /* keep default */
    }
    // Produce clean, user-facing messages for known status codes
    if (res.status === 429) {
      detail = "Rate limit reached — please wait a moment before trying again.";
    } else if (res.status === 503 || res.status === 502) {
      detail = "The AI service is temporarily unavailable. Please try again shortly.";
    } else if (res.status === 401 || res.status === 403) {
      detail = "Authentication error — please refresh the page.";
    } else if (res.status >= 500) {
      detail = `Server error (${res.status}) — please try again.`;
    }
    const err = new Error(detail) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function listScenarios(difficulty?: Difficulty): Promise<Scenario[]> {
  const qs = difficulty ? `?difficulty=${difficulty}` : "";
  return handle<Scenario[]>(await fetch(`${API_URL}/api/scenarios${qs}`));
}

export async function stemWord(word: string) {
  return handle<{ word: string; breakdown: string; lemma: string; confidence: number }>(
    await fetch(`${API_URL}/api/stem?word=${encodeURIComponent(word)}`),
  );
}

export async function startSession(scenarioId: string): Promise<StartedSession> {
  return handle<StartedSession>(
    await fetch(`${API_URL}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scenario_id: scenarioId }),
    }),
  );
}

export async function submitTurn(
  sessionId: string,
  payload: { audio?: Blob; transcript?: string },
): Promise<TurnResponse> {
  if (payload.audio) {
    const form = new FormData();
    form.append("audio", payload.audio, "recording.webm");
    return handle<TurnResponse>(
      await fetch(`${API_URL}/api/sessions/${sessionId}/turns`, {
        method: "POST",
        body: form,
      }),
    );
  }
  return handle<TurnResponse>(
    await fetch(`${API_URL}/api/sessions/${sessionId}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript: payload.transcript ?? "" }),
    }),
  );
}