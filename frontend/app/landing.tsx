"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight,
  Mic,
  MessageSquare,
  Star,
  Zap,
  Moon,
  Sun,
  Globe,
  BookOpen,
  Trophy,
} from "lucide-react";

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const stored = localStorage.getItem("sema_theme") as "light" | "dark" | null;
    return stored === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

const FEATURES = [
  {
    icon: Mic,
    title: "Voice & text practice",
    body: "Speak or type — Mzizi understands both. Practice real-world scenarios like markets, taxis, clinics, and more.",
  },
  {
    icon: Star,
    title: "Scored feedback",
    body: "Every reply is graded on comprehension, grammar, and pronunciation — with corrections and word-root breakdowns.",
  },
  {
    icon: Globe,
    title: "In-character AI",
    body: "Amara stays in role: a native Swahili speaker who responds naturally, pushing you to keep up.",
  },
  {
    icon: Trophy,
    title: "Session summaries",
    body: "After each scenario, see exactly what went well, what to focus on next, and common mistakes to fix.",
  },
  {
    icon: BookOpen,
    title: "Word-root breakdowns",
    body: "Understand how Swahili words are built. See stems, prefixes, and suffixes explained in context.",
  },
  {
    icon: Zap,
    title: "Real scenarios",
    body: "10+ carefully crafted situations — from negotiating prices at a market to asking for directions in town.",
  },
];

const SCENARIOS = [
  { label: "Sokoni", sub: "Market bargaining" },
  { label: "Hospitalini", sub: "Clinic visit" },
  { label: "Teksini", sub: "Taxi fare" },
  { label: "Mkahawani", sub: "Restaurant order" },
  { label: "Benkini", sub: "Banking" },
  { label: "Mjini", sub: "City directions" },
];

export default function LandingPage({ onLaunch }: { onLaunch: () => void }) {
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme((curr) => {
      const next = curr === "dark" ? "light" : "dark";
      try {
        localStorage.setItem("sema_theme", next);
      } catch {}
      return next;
    });
  };

  return (
    <div className="min-h-dvh bg-background text-[var(--text-primary)]">
      {/* Nav */}
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6 lg:px-10">
        <div className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)]">
          <div className="h-[26px] w-[26px] rounded-[7px] bg-brand shadow-xs" />
          Mzizi
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            className="flex items-center gap-1.5 rounded-full border border-[var(--btn-secondary-border)] px-3 py-1.5 text-xs text-[var(--btn-secondary-text)] transition hover:bg-[var(--btn-secondary-hover-bg)] hover:text-[var(--btn-secondary-hover-text)]"
          >
            {theme === "dark" ? (
              <>
                <Sun className="h-3.5 w-3.5 text-warning" />
                <span>Light</span>
              </>
            ) : (
              <>
                <Moon className="h-3.5 w-3.5" />
                <span>Dark</span>
              </>
            )}
          </button>
          <button
            onClick={onLaunch}
            className="flex items-center gap-1.5 rounded-full bg-brand px-4 py-1.5 text-xs font-medium text-white shadow-xs transition hover:brightness-110"
          >
            Try it free
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-4 pb-16 pt-16 sm:px-6 sm:pt-20 lg:px-10 lg:pt-28">
        <div className="flex flex-col items-center text-center">
          {/* Badge */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/[0.08] px-4 py-1.5 text-xs font-medium text-brand-soft">
            <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
            AI-powered Kiswahili practice
          </div>

          <h1 className="mb-5 max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-[var(--text-primary)] sm:text-5xl lg:text-6xl">
            Speak Swahili with{" "}
            <span className="text-brand">confidence</span>
          </h1>
          <p className="mb-8 max-w-xl text-base text-[var(--text-muted)] sm:text-lg">
            Practice real conversations with an in-character AI. Get instant
            scored feedback, grammar corrections, and word-root breakdowns —
            built for learners who want to actually speak.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={onLaunch}
              className="flex items-center gap-2 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:brightness-110 active:scale-[0.98]"
            >
              <Mic className="h-4 w-4" />
              Try a scenario
            </button>
            <button
              onClick={onLaunch}
              className="flex items-center gap-2 rounded-full border border-[var(--btn-secondary-border)] bg-[var(--card-bg)] px-6 py-3 text-sm font-medium text-[var(--btn-secondary-text)] transition hover:bg-[var(--btn-secondary-hover-bg)]"
            >
              <MessageSquare className="h-4 w-4" />
              Text mode
            </button>
          </div>
        </div>
      </section>

      {/* Scenario pills preview */}
      <section className="mx-auto mb-20 max-w-5xl px-4 sm:px-6 lg:px-10">
        <p className="mb-4 text-center text-xs font-medium uppercase tracking-widest text-[var(--text-muted)]">
          Available scenarios
        </p>
        <div className="flex flex-wrap justify-center gap-2.5">
          {SCENARIOS.map((s) => (
            <button
              key={s.label}
              onClick={onLaunch}
              className="flex items-center gap-2 rounded-full border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:border-brand/40 hover:text-brand"
            >
              <span className="font-medium">{s.label}</span>
              <span className="text-[var(--text-muted)]">· {s.sub}</span>
            </button>
          ))}
          <button
            onClick={onLaunch}
            className="rounded-full border border-dashed border-[var(--surprise-border)] px-4 py-2 text-sm text-[var(--surprise-text)] transition hover:border-brand hover:text-brand"
          >
            + more
          </button>
        </div>
      </section>

      {/* Mock app preview card */}
      <section className="mx-auto mb-24 max-w-5xl px-4 sm:px-6 lg:px-10">
        <div
          className="overflow-hidden rounded-2xl border border-[var(--panel-border)] bg-panel shadow-2xl"
          style={{ boxShadow: "0 32px 80px rgba(0,0,0,0.18)" }}
        >
          {/* Fake title bar */}
          <div className="flex items-center gap-1.5 border-b border-[var(--panel-border)] bg-[var(--card-bg)] px-4 py-3">
            <div className="h-2.5 w-2.5 rounded-full bg-[var(--danger)]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[var(--warning)]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[var(--positive)]" />
            <span className="ml-3 text-xs text-[var(--text-muted)]">Mzizi — Sokoni · Market bargaining</span>
          </div>

          {/* Fake chat */}
          <div className="space-y-4 p-6 sm:p-8">
            {/* AI bubble */}
            <div className="flex justify-start">
              <div className="max-w-[75%] rounded-2xl rounded-tl-sm border border-[var(--card-border)] bg-[var(--ai-bubble-bg)] px-4 py-3 text-sm text-[var(--ai-bubble-fg)]">
                <p>Habari! Unataka nini leo? Tuna nyanya nzuri sana, kilo moja ni shilingi mia tatu.</p>
                <p className="mt-1 text-xs text-[var(--ai-translation)]">Hello! What do you want today? We have very good tomatoes, one kilo is 300 shillings.</p>
              </div>
            </div>

            {/* User bubble */}
            <div className="flex justify-end">
              <div className="max-w-[75%] rounded-2xl rounded-tr-sm bg-[var(--user-bubble-bg)] px-4 py-3 text-sm text-[var(--user-bubble-fg)]">
                <p>Kilo moja ni ghali sana. Unaweza punguza bei?</p>
              </div>
            </div>

            {/* Feedback chip */}
            <div className="ml-0 max-w-[75%]">
              <div className="rounded-xl border border-[var(--feedback-border)] bg-[var(--feedback-bg)] p-3 text-xs">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="font-semibold text-[var(--text-primary)]">Good negotiation phrase!</span>
                  <span className="font-bold text-positive">Score 82</span>
                </div>
                <div className="flex flex-wrap gap-x-3 text-[11px] text-[var(--text-muted)]">
                  <span>Comprehension <b className="text-[var(--text-primary)]">88</b></span>
                  <span>Grammar <b className="text-[var(--text-primary)]">79</b></span>
                  <span>Enunciation <b className="text-[var(--text-primary)]">80</b></span>
                </div>
                <p className="mt-1.5 text-[11px] italic text-[var(--text-muted)]">→ Try adding "kidogo" to sound more natural: "Punguza bei kidogo?"</p>
              </div>
            </div>

            {/* CTA overlay */}
            <div className="pt-2 text-center">
              <button
                onClick={onLaunch}
                className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
              >
                <Mic className="h-4 w-4" />
                Start your own session
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Features grid */}
      <section className="mx-auto mb-24 max-w-5xl px-4 sm:px-6 lg:px-10">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">
            Everything you need to actually speak
          </h2>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Not flashcards. Real conversations.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 transition hover:border-brand/30 hover:bg-[var(--card-hover)]"
              >
                <div className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand/10">
                  <Icon className="h-4.5 w-4.5 text-brand" style={{ width: 18, height: 18 }} />
                </div>
                <h3 className="mb-1.5 text-sm font-semibold text-[var(--text-primary)]">{f.title}</h3>
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">{f.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="mx-auto mb-20 max-w-5xl px-4 sm:px-6 lg:px-10">
        <div className="flex flex-col items-center gap-6 rounded-2xl border border-[var(--brand-card-border)] px-6 py-12 text-center sm:py-16"
          style={{ background: "var(--brand-card-bg)" }}>
          <div className="h-14 w-14 rounded-2xl bg-brand/20 flex items-center justify-center">
            <div className="h-7 w-7 rounded-[7px] bg-brand" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl">
              Ready to speak Swahili?
            </h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              No signup needed. Pick a scenario and start talking.
            </p>
          </div>
          <button
            onClick={onLaunch}
            className="flex items-center gap-2 rounded-full bg-brand px-8 py-3.5 text-base font-semibold text-white shadow-xl transition hover:brightness-110 active:scale-[0.98]"
          >
            <Mic className="h-5 w-5" />
            Try it now — it's free
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--panel-border)] py-8">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-2 px-4 text-center sm:px-6 lg:px-10">
          <div className="flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
            <div className="h-5 w-5 rounded-[5px] bg-brand" />
            Mzizi
          </div>
          <p className="text-xs text-[var(--text-faint)]">
            AI-powered Kiswahili speaking practice
          </p>
        </div>
      </footer>
    </div>
  );
}
