"use client";

import { useMemo, useState } from "react";

type CoachData = {
  stageSummary: string;
  thinkingQuestions: string[];
  nextAction: string;
  checklist: {
    evidence: string[];
    variables: string[];
    error: string[];
    alternatives: string[];
  };
  transferQuestion: string;
};

const STAGES = [
  "QUESTION_DEFINITION",
  "HYPOTHESIS",
  "EXPERIMENT_DESIGN",
  "DATA_COLLECTION",
  "DATA_ANALYSIS",
  "CONCLUSION",
  "REFLECTION",
] as const;

export default function Home() {
  const defaultSessionId = useMemo(() => `session-${Date.now()}`, []);

  const [sessionId, setSessionId] = useState(defaultSessionId);
  const [currentStage, setCurrentStage] = useState<(typeof STAGES)[number]>("HYPOTHESIS");
  const [message, setMessage] = useState("Help me improve my hypothesis with evidence-focused questions.");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ reason?: string; safeAlternative?: string } | null>(null);
  const [result, setResult] = useState<CoachData | null>(null);

  async function runCoaching() {
    setLoading(true);
    setError(null);
    setBlocked(null);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, currentStage, message }),
      });

      if (!response.ok) {
        setError(`Request failed with status ${response.status}`);
        setResult(null);
        return;
      }

      const json = (await response.json()) as {
        blocked?: boolean;
        reason?: string;
        safeAlternative?: string;
        data?: CoachData;
      };

      if (json.blocked) {
        setBlocked({ reason: json.reason, safeAlternative: json.safeAlternative });
        setResult(null);
        return;
      }

      if (!json.data) {
        setError("No coaching data returned.");
        setResult(null);
        return;
      }

      setResult(json.data);
    } catch {
      setError("Network error while calling /api/agent.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_20%_0%,#fef3c7_0%,#fff7ed_35%,#eef2ff_100%)] px-4 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1.1fr_1fr]">
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-xl backdrop-blur sm:p-8">
          <p className="text-xs font-bold tracking-[0.2em] text-amber-700">STEM INQUIRY COACH</p>
          <h1 className="mt-3 text-3xl font-black leading-tight sm:text-4xl">
            질문으로 사고를 깊게 만드는 탐구 코칭
          </h1>
          <p className="mt-4 text-sm text-slate-600 sm:text-base">
            정답 제공 대신, 근거 중심 질문과 단계별 점검으로 탐구 과정을 구조화합니다.
          </p>

          <div className="mt-7 grid gap-4">
            <label className="grid gap-2 text-sm font-semibold">
              Session ID
              <input
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none ring-amber-200 focus:ring-2"
              />
            </label>

            <label className="grid gap-2 text-sm font-semibold">
              Inquiry Stage
              <select
                value={currentStage}
                onChange={(e) => setCurrentStage(e.target.value as (typeof STAGES)[number])}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-amber-200 focus:ring-2"
              >
                {STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-sm font-semibold">
              Student Message
              <textarea
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-amber-200 focus:ring-2"
              />
            </label>

            <button
              onClick={runCoaching}
              disabled={loading || !sessionId || !message}
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {loading ? "Running..." : "Run Coaching"}
            </button>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-xl backdrop-blur sm:p-8">
          <h2 className="text-xl font-extrabold">Coach Output</h2>

          {error ? (
            <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
          ) : null}

          {blocked ? (
            <div className="mt-4 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
              <p className="font-semibold text-amber-900">Blocked by guardrail</p>
              <p className="text-amber-800">{blocked.reason}</p>
              <p className="text-amber-800">{blocked.safeAlternative}</p>
            </div>
          ) : null}

          {!result && !error && !blocked ? (
            <p className="mt-4 text-sm text-slate-500">Run a request to see structured coaching output.</p>
          ) : null}

          {result ? (
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <p className="font-bold">Stage Summary</p>
                <p className="text-slate-700">{result.stageSummary}</p>
              </div>

              <div>
                <p className="font-bold">Thinking Questions</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-slate-700">
                  {result.thinkingQuestions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="font-bold">Next Action</p>
                <p className="text-slate-700">{result.nextAction}</p>
              </div>

              <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="font-bold">Checklist</p>
                <p><span className="font-semibold">Evidence:</span> {result.checklist.evidence.join(" | ")}</p>
                <p><span className="font-semibold">Variables:</span> {result.checklist.variables.join(" | ")}</p>
                <p><span className="font-semibold">Error:</span> {result.checklist.error.join(" | ")}</p>
                <p><span className="font-semibold">Alternatives:</span> {result.checklist.alternatives.join(" | ")}</p>
              </div>

              <div>
                <p className="font-bold">Transfer Question</p>
                <p className="text-slate-700">{result.transferQuestion}</p>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
