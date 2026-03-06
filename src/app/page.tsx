"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

type Stage =
  | "QUESTION_DEFINITION"
  | "HYPOTHESIS"
  | "EXPERIMENT_DESIGN"
  | "DATA_COLLECTION"
  | "DATA_ANALYSIS"
  | "CONCLUSION"
  | "REFLECTION";

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

type ApiMeta = {
  runId: string | null;
  model: string;
  requestMs: number;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
};

type HistoryItem = {
  at: string;
  stage: Stage;
  message: string;
  blocked: boolean;
  result: CoachData | null;
  meta?: ApiMeta;
};

const STAGES: Stage[] = [
  "QUESTION_DEFINITION",
  "HYPOTHESIS",
  "EXPERIMENT_DESIGN",
  "DATA_COLLECTION",
  "DATA_ANALYSIS",
  "CONCLUSION",
  "REFLECTION",
];

const STAGE_LABEL: Record<Stage, string> = {
  QUESTION_DEFINITION: "Question",
  HYPOTHESIS: "Hypothesis",
  EXPERIMENT_DESIGN: "Design",
  DATA_COLLECTION: "Collect",
  DATA_ANALYSIS: "Analyze",
  CONCLUSION: "Conclusion",
  REFLECTION: "Reflect",
};

const STORAGE_KEY = "stem-coach-dashboard-v1";

const GUARDRAIL_PROMPTS = [
  "Give me two hints, not the final answer.",
  "Ask me evidence-focused questions for this stage.",
  "Help me find one error source and one better control variable.",
];

export default function Home() {
  const defaultSessionId = useMemo(() => `session-${Date.now()}`, []);

  const [activeTab, setActiveTab] = useState<"coach" | "output">("coach");
  const [sessionId, setSessionId] = useState(defaultSessionId);
  const [currentStage, setCurrentStage] = useState<Stage>("HYPOTHESIS");
  const [message, setMessage] = useState("Help me improve my hypothesis with evidence-focused questions.");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState("Ready");
  const [blocked, setBlocked] = useState<{ reason?: string; safeAlternative?: string } | null>(null);
  const [result, setResult] = useState<CoachData | null>(null);
  const [meta, setMeta] = useState<ApiMeta | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [reportDraft, setReportDraft] = useState("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const saved = JSON.parse(raw) as {
        sessionId?: string;
        currentStage?: Stage;
        message?: string;
        history?: HistoryItem[];
        notes?: string[];
        reportDraft?: string;
      };

      if (saved.sessionId) {
        setSessionId(saved.sessionId);
      }
      if (saved.currentStage && STAGES.includes(saved.currentStage)) {
        setCurrentStage(saved.currentStage);
      }
      if (saved.message) {
        setMessage(saved.message);
      }
      if (saved.history) {
        setHistory(saved.history.slice(0, 20));
      }
      if (saved.notes) {
        setNotes(saved.notes.slice(0, 20));
      }
      if (saved.reportDraft) {
        setReportDraft(saved.reportDraft);
      }
    } catch {
      // Ignore malformed local storage.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        sessionId,
        currentStage,
        message,
        history,
        notes,
        reportDraft,
      }),
    );
  }, [sessionId, currentStage, message, history, notes, reportDraft]);

  const stageIndex = STAGES.indexOf(currentStage);
  const progressPercent = Math.round(((stageIndex + 1) / STAGES.length) * 100);

  const kpi = useMemo(() => {
    const total = history.length;
    const blockedCount = history.filter((h) => h.blocked).length;
    const questioningRate =
      total === 0
        ? 0
        : Math.round(
            (history.filter((h) => (h.result?.thinkingQuestions.length ?? 0) > 0).length / total) * 100,
          );

    const evidenceCoverage =
      history.length === 0
        ? 0
        : Math.round(
            (history.filter((h) => (h.result?.checklist.evidence.length ?? 0) > 0).length / total) * 100,
          );

    const completedReflection = history.some((h) => h.stage === "REFLECTION");

    return {
      questioningRate,
      evidenceCoverage,
      blockedRate: total === 0 ? 0 : Math.round((blockedCount / total) * 100),
      completion: completedReflection ? "Complete" : "In Progress",
    };
  }, [history]);

  async function runCoaching(retry = false) {
    setLoading(true);
    setError(null);
    setBlocked(null);
    setStatusLine(retry ? "Retrying request..." : "Request in progress...");

    const requestStarted = Date.now();

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, currentStage, message }),
      });

      if (!response.ok) {
        setError(`Request failed with status ${response.status}`);
        setResult(null);
        setStatusLine("Request failed");
        return;
      }

      const json = (await response.json()) as {
        blocked?: boolean;
        reason?: string;
        safeAlternative?: string;
        data?: CoachData;
        meta?: ApiMeta;
      };

      setMeta(json.meta ?? null);

      if (json.blocked) {
        setBlocked({ reason: json.reason, safeAlternative: json.safeAlternative });
        setResult(null);
        setHistory((prev) => [
          {
            at: new Date().toISOString(),
            stage: currentStage,
            message,
            blocked: true,
            result: null,
            meta: json.meta,
          },
          ...prev,
        ].slice(0, 20));
        setStatusLine(`Blocked by guardrail in ${Date.now() - requestStarted}ms`);
        setActiveTab("output");
        return;
      }

      if (!json.data) {
        setError("No coaching data returned.");
        setResult(null);
        setStatusLine("No data returned");
        return;
      }

      setResult(json.data);
      setHistory((prev) => [
        {
          at: new Date().toISOString(),
          stage: currentStage,
          message,
          blocked: false,
          result: json.data,
          meta: json.meta,
        },
        ...prev,
      ].slice(0, 20));

      setStatusLine(`Completed in ${(json.meta?.requestMs ?? Date.now() - requestStarted)}ms`);
      setActiveTab("output");
    } catch {
      setError("Network error while calling /api/agent.");
      setResult(null);
      setStatusLine("Network error");
    } finally {
      setLoading(false);
    }
  }

  function appendNextActionToNotes() {
    if (!result?.nextAction) {
      return;
    }
    setNotes((prev) => [result.nextAction, ...prev].slice(0, 20));
  }

  function appendNextActionToDraft() {
    if (!result?.nextAction) {
      return;
    }
    const block = `- ${new Date().toISOString()} [${currentStage}] ${result.nextAction}`;
    setReportDraft((prev) => (prev ? `${prev}\n${block}` : block));
  }

  function applyGuardrailPrompt(prompt: string) {
    setMessage(prompt);
    setActiveTab("coach");
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(120deg,#fff7ed_0%,#eef2ff_50%,#f0fdfa_100%)] px-4 py-6 text-slate-900 sm:px-8 sm:py-8">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-lg backdrop-blur sm:p-6">
          <p className="text-xs font-bold tracking-[0.2em] text-cyan-700">STEM COACH DASHBOARD</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-black sm:text-3xl">Reasoning-first inquiry cockpit</h1>
            <p className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">{statusLine}</p>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-600">
              <span>Stage progression</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-cyan-500 to-emerald-500 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-[10px] font-semibold sm:grid-cols-7 sm:text-xs">
              {STAGES.map((stage, idx) => {
                const active = idx === stageIndex;
                const done = idx < stageIndex;
                return (
                  <div
                    key={stage}
                    className={`rounded-md px-2 py-1 text-center ${
                      active
                        ? "bg-slate-900 text-white"
                        : done
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {STAGE_LABEL[stage]}
                  </div>
                );
              })}
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard title="Questioning Rate" value={`${kpi.questioningRate}%`} note="Prompt outputs with coaching questions" />
          <KpiCard title="Evidence Coverage" value={`${kpi.evidenceCoverage}%`} note="Responses with evidence checklist" />
          <KpiCard title="Blocked Rate" value={`${kpi.blockedRate}%`} note="Guardrail-triggered requests" />
          <KpiCard title="Stage Completion" value={kpi.completion} note="Reached reflection stage" />
        </section>

        <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:hidden">
          <div className="grid grid-cols-2 gap-2">
            <button
              className={`rounded-xl px-3 py-2 text-sm font-bold ${activeTab === "coach" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
              onClick={() => setActiveTab("coach")}
              type="button"
            >
              Coach Input
            </button>
            <button
              className={`rounded-xl px-3 py-2 text-sm font-bold ${activeTab === "output" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
              onClick={() => setActiveTab("output")}
              type="button"
            >
              Output & Ops
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <section className={`${activeTab !== "coach" ? "hidden lg:block" : "block"} rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-xl`}>
            <h2 className="text-xl font-extrabold">Coach Input</h2>
            <p className="mt-1 text-sm text-slate-600">Session persists locally. Refresh-safe.</p>

            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm font-semibold" htmlFor="session-id">
                Session ID
                <input
                  id="session-id"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none ring-cyan-200 focus:ring-2"
                />
              </label>

              <label className="grid gap-2 text-sm font-semibold" htmlFor="stage">
                Inquiry Stage
                <select
                  id="stage"
                  value={currentStage}
                  onChange={(e) => setCurrentStage(e.target.value as Stage)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring-2"
                >
                  {STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-semibold" htmlFor="student-message">
                Student Message
                <textarea
                  id="student-message"
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring-2"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => runCoaching(false)}
                  disabled={loading || !sessionId || !message}
                  className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
                  type="button"
                >
                  {loading ? "Running..." : "Run Coaching"}
                </button>
                <button
                  onClick={() => runCoaching(true)}
                  disabled={loading || !sessionId || !message}
                  className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
                  type="button"
                >
                  Retry
                </button>
              </div>
            </div>
          </section>

          <section className={`${activeTab !== "output" ? "hidden lg:block" : "block"} rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-xl`}>
            <h2 className="text-xl font-extrabold">Output & Operations</h2>

            <div aria-live="polite" className="mt-4 space-y-3 text-sm">
              {error ? <p className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p> : null}

              {blocked ? (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="font-semibold text-amber-900">Guardrail active</p>
                  <p className="text-amber-800">{blocked.reason}</p>
                  <p className="text-amber-800">{blocked.safeAlternative}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {GUARDRAIL_PROMPTS.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => applyGuardrailPrompt(prompt)}
                        className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                      >
                        Use: {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {result ? (
                <div className="space-y-3">
                  <Card title="Stage Summary" badge="Required">
                    {result.stageSummary}
                  </Card>

                  <Card title="Thinking Questions" badge="Required">
                    <ul className="list-disc space-y-1 pl-5">
                      {result.thinkingQuestions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </Card>

                  <Card title="Next Action" badge="Actionable">
                    <p>{result.nextAction}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={appendNextActionToNotes} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700">
                        Add to Notes
                      </button>
                      <button type="button" onClick={appendNextActionToDraft} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100">
                        Append to Report Draft
                      </button>
                    </div>
                  </Card>

                  <Card title="Checklist" badge="Quality Gate">
                    <p><span className="font-semibold">Evidence:</span> {result.checklist.evidence.join(" | ")}</p>
                    <p><span className="font-semibold">Variables:</span> {result.checklist.variables.join(" | ")}</p>
                    <p><span className="font-semibold">Error:</span> {result.checklist.error.join(" | ")}</p>
                    <p><span className="font-semibold">Alternatives:</span> {result.checklist.alternatives.join(" | ")}</p>
                  </Card>

                  <Card title="Transfer Question" badge="Recommended">
                    {result.transferQuestion}
                  </Card>
                </div>
              ) : null}

              {!result && !error && !blocked ? (
                <p className="text-slate-500">Run a request to see structured coaching output.</p>
              ) : null}

              <Card title="Operations Meta" badge="Debug">
                <p><span className="font-semibold">Model:</span> {meta?.model ?? "-"}</p>
                <p><span className="font-semibold">Run ID:</span> {meta?.runId ?? "-"}</p>
                <p><span className="font-semibold">Request Time:</span> {meta?.requestMs ?? 0}ms</p>
                <p>
                  <span className="font-semibold">Tokens:</span>{" "}
                  {meta?.tokenUsage
                    ? `${meta.tokenUsage.input} in / ${meta.tokenUsage.output} out / ${meta.tokenUsage.total} total`
                    : "-"}
                </p>
              </Card>
            </div>
          </section>
        </div>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card title="Quick Notes" badge={`${notes.length} items`}>
            {notes.length === 0 ? <p className="text-slate-500">No notes yet.</p> : null}
            <ul className="space-y-1 text-sm">
              {notes.map((note, idx) => (
                <li key={`${note}-${idx}`} className="rounded-lg bg-slate-50 px-2 py-1">{note}</li>
              ))}
            </ul>
          </Card>

          <Card title="Report Draft" badge={`${reportDraft.length} chars`}>
            {reportDraft ? <pre className="whitespace-pre-wrap text-sm">{reportDraft}</pre> : <p className="text-slate-500">Draft is empty.</p>}
          </Card>
        </section>
      </div>
    </main>
  );
}

function KpiCard({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 text-2xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-600">{note}</p>
    </div>
  );
}

function Card({ title, badge, children }: { title: string; badge: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-bold text-slate-900">{title}</p>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">{badge}</span>
      </div>
      <div className="space-y-1 text-sm text-slate-700">{children}</div>
    </div>
  );
}
