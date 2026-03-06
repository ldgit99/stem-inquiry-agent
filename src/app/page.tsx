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

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
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
  QUESTION_DEFINITION: "탐구 문제 정교화",
  HYPOTHESIS: "가설 설정",
  EXPERIMENT_DESIGN: "실험 설계",
  DATA_COLLECTION: "데이터 수집",
  DATA_ANALYSIS: "자료 해석",
  CONCLUSION: "결론 도출",
  REFLECTION: "성찰 및 개선",
};

const STORAGE_KEY = "stem-coach-dashboard-v4";

const GUARDRAIL_PROMPTS = [
  "정답 대신 지금 단계에 맞는 힌트 2개를 주세요.",
  "근거를 더 강하게 만들 수 있는 질문을 해주세요.",
  "오차 원인과 통제 변수 보완점을 짚어주세요.",
];

export default function Home() {
  const defaultSessionId = useMemo(() => `session-${Date.now()}`, []);

  const [activeTab, setActiveTab] = useState<"coach" | "output" | "chat">("coach");
  const [sessionId, setSessionId] = useState(defaultSessionId);
  const [currentStage, setCurrentStage] = useState<Stage>("HYPOTHESIS");
  const [message, setMessage] = useState("가설을 더 타당하게 만들 수 있도록 근거 중심 질문을 해줘.");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusLine, setStatusLine] = useState("준비됨");
  const [blocked, setBlocked] = useState<{ reason?: string; safeAlternative?: string } | null>(null);
  const [result, setResult] = useState<CoachData | null>(null);
  const [meta, setMeta] = useState<ApiMeta | null>(null);

  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [reportDraft, setReportDraft] = useState("");

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "탐구활동 보고서 작성 코치입니다. 초안을 붙여주면 문단 구조, 근거 연결, 한계/후속실험 문장을 함께 다듬어드릴게요.",
    },
  ]);
  const [chatInput, setChatInput] = useState("현재 초안을 바탕으로 결과 해석 문단을 써줘.");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMeta, setChatMeta] = useState<ApiMeta | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const saved = JSON.parse(raw) as {
        sessionId?: string;
        currentStage?: Stage;
        message?: string;
        history?: HistoryItem[];
        notes?: string[];
        reportDraft?: string;
        chatMessages?: ChatMessage[];
      };

      if (saved.sessionId) setSessionId(saved.sessionId);
      if (saved.currentStage && STAGES.includes(saved.currentStage)) setCurrentStage(saved.currentStage);
      if (saved.message) setMessage(saved.message);
      if (saved.history) setHistory(saved.history.slice(0, 30));
      if (saved.notes) setNotes(saved.notes.slice(0, 30));
      if (saved.reportDraft) setReportDraft(saved.reportDraft);
      if (saved.chatMessages && saved.chatMessages.length > 0) setChatMessages(saved.chatMessages.slice(-24));
    } catch {
      // 무시
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
        chatMessages,
      }),
    );
  }, [sessionId, currentStage, message, history, notes, reportDraft, chatMessages]);

  const stageIndex = STAGES.indexOf(currentStage);
  const progressPercent = Math.round(((stageIndex + 1) / STAGES.length) * 100);

  const kpi = useMemo(() => {
    const total = history.length;
    const blockedCount = history.filter((h) => h.blocked).length;

    return {
      questioningRate:
        total === 0
          ? 0
          : Math.round((history.filter((h) => (h.result?.thinkingQuestions.length ?? 0) > 0).length / total) * 100),
      evidenceCoverage:
        total === 0
          ? 0
          : Math.round((history.filter((h) => (h.result?.checklist.evidence.length ?? 0) > 0).length / total) * 100),
      blockedRate: total === 0 ? 0 : Math.round((blockedCount / total) * 100),
      completion: history.some((h) => h.stage === "REFLECTION") ? "완료" : "진행중",
    };
  }, [history]);

  async function runCoaching(retry = false) {
    setLoading(true);
    setError(null);
    setBlocked(null);
    setStatusLine(retry ? "재요청 중..." : "요청 처리 중...");

    const started = Date.now();

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, currentStage, message }),
      });

      if (!response.ok) {
        setError(`요청 실패: ${response.status}`);
        setResult(null);
        setStatusLine("요청 실패");
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
        ].slice(0, 30));
        setStatusLine(`가드레일 차단 (${Date.now() - started}ms)`);
        setActiveTab("output");
        return;
      }

      if (!json.data) {
        setError("응답 데이터가 없습니다.");
        setResult(null);
        setStatusLine("응답 없음");
        return;
      }

      const data = json.data;
      setResult(data);
      setHistory((prev) => [
        {
          at: new Date().toISOString(),
          stage: currentStage,
          message,
          blocked: false,
          result: data,
          meta: json.meta,
        },
        ...prev,
      ].slice(0, 30));

      setStatusLine(`완료 (${json.meta?.requestMs ?? Date.now() - started}ms)`);
      setActiveTab("output");
    } catch {
      setError("/api/agent 호출 중 네트워크 오류가 발생했습니다.");
      setResult(null);
      setStatusLine("네트워크 오류");
    } finally {
      setLoading(false);
    }
  }

  async function sendReportChat() {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = chatInput.trim();
    setChatInput("");
    setChatLoading(true);

    const nextMessages: ChatMessage[] = [...chatMessages, { role: "user", content: userMessage }];
    setChatMessages(nextMessages);

    try {
      const response = await fetch("/api/report-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          stage: currentStage,
          reportDraft,
          userMessage,
          history: nextMessages,
        }),
      });

      if (!response.ok) {
        const fallback: ChatMessage = {
          role: "assistant",
          content: `챗봇 요청 실패: ${response.status}`,
        };
        setChatMessages((prev) => [...prev, fallback].slice(-24));
        return;
      }

      const json = (await response.json()) as { reply?: string; meta?: ApiMeta };
      const reply = json.reply ?? "답변을 생성하지 못했습니다. 다시 시도해주세요.";
      const assistantMessage: ChatMessage = { role: "assistant", content: reply };

      setChatMeta(json.meta ?? null);
      setChatMessages((prev) => [...prev, assistantMessage].slice(-24));
      setActiveTab("chat");
    } catch {
      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: "/api/report-chat 호출 중 네트워크 오류가 발생했습니다.",
      };
      setChatMessages((prev) => [...prev, assistantMessage].slice(-24));
    } finally {
      setChatLoading(false);
    }
  }

  function appendNextActionToNotes() {
    if (!result?.nextAction) return;
    setNotes((prev) => [result.nextAction, ...prev].slice(0, 30));
  }

  function appendNextActionToDraft() {
    if (!result?.nextAction) return;
    const block = `- ${new Date().toISOString()} [${STAGE_LABEL[currentStage]}] ${result.nextAction}`;
    setReportDraft((prev) => (prev ? `${prev}\n${block}` : block));
  }

  function appendLastAssistantToDraft() {
    const last = [...chatMessages].reverse().find((m) => m.role === "assistant");
    if (!last) return;
    const block = `\n\n[챗봇 제안]\n${last.content}`;
    setReportDraft((prev) => `${prev}${block}`.trim());
  }

  function applyGuardrailPrompt(prompt: string) {
    setMessage(prompt);
    setActiveTab("coach");
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(120deg,#fff7ed_0%,#eef2ff_50%,#f0fdfa_100%)] px-4 py-6 text-slate-900 sm:px-8 sm:py-8">
      <div className="mx-auto w-full max-w-[1700px] space-y-6">
        <header className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-lg backdrop-blur sm:p-6">
          <p className="text-xs font-bold tracking-[0.2em] text-cyan-700">STEM 탐구 코칭 대시보드</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-black sm:text-3xl">3분할 탐구 워크스페이스</h1>
            <p className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white">{statusLine}</p>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-600">
              <span>탐구 단계 진행률</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div className="h-full bg-gradient-to-r from-amber-500 via-cyan-500 to-emerald-500" style={{ width: `${progressPercent}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-[10px] font-semibold sm:grid-cols-7 sm:text-xs">
              {STAGES.map((stage, idx) => {
                const active = idx === stageIndex;
                const done = idx < stageIndex;
                return (
                  <div
                    key={stage}
                    className={`rounded-md px-2 py-1 text-center ${
                      active ? "bg-slate-900 text-white" : done ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {STAGE_LABEL[stage]}
                  </div>
                );
              })}
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard title="질문형 코칭률" value={`${kpi.questioningRate}%`} note="사고 촉진 질문 포함 비율" />
          <KpiCard title="근거 점검률" value={`${kpi.evidenceCoverage}%`} note="근거 체크리스트 포함 비율" />
          <KpiCard title="가드레일 차단률" value={`${kpi.blockedRate}%`} note="위험/정답요청 차단 비율" />
          <KpiCard title="단계 완주" value={kpi.completion} note="성찰 및 개선 단계 도달 여부" />
        </section>

        <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm xl:hidden">
          <div className="grid grid-cols-3 gap-2">
            <TabButton active={activeTab === "coach"} onClick={() => setActiveTab("coach")}>코치 입력</TabButton>
            <TabButton active={activeTab === "output"} onClick={() => setActiveTab("output")}>코치 출력</TabButton>
            <TabButton active={activeTab === "chat"} onClick={() => setActiveTab("chat")}>보고서 챗봇</TabButton>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1fr_1fr_0.9fr]">
          <section className={`${activeTab !== "coach" ? "hidden xl:block" : "block"} rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-xl`}>
            <h2 className="text-xl font-extrabold">코치 입력</h2>
            <p className="mt-1 text-sm text-slate-600">탐구 대화와 초안 데이터는 브라우저에 자동 저장됩니다.</p>

            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-sm font-semibold" htmlFor="session-id">세션 ID
                <input id="session-id" value={sessionId} onChange={(e) => setSessionId(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none ring-cyan-200 focus:ring-2" />
              </label>

              <label className="grid gap-2 text-sm font-semibold" htmlFor="stage">탐구 단계
                <select id="stage" value={currentStage} onChange={(e) => setCurrentStage(e.target.value as Stage)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring-2">
                  {STAGES.map((stage) => (<option key={stage} value={stage}>{STAGE_LABEL[stage]} ({stage})</option>))}
                </select>
              </label>

              <label className="grid gap-2 text-sm font-semibold" htmlFor="student-message">학생 질문/요청
                <textarea id="student-message" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring-2" />
              </label>

              <div className="flex flex-wrap gap-2">
                <button onClick={() => runCoaching(false)} disabled={loading || !sessionId || !message} type="button" className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-bold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400">{loading ? "실행 중..." : "코칭 실행"}</button>
                <button onClick={() => runCoaching(true)} disabled={loading || !sessionId || !message} type="button" className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400">재시도</button>
              </div>
            </div>
          </section>

          <section className={`${activeTab !== "output" ? "hidden xl:block" : "block"} rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-xl`}>
            <h2 className="text-xl font-extrabold">코치 출력 & 운영</h2>

            <div aria-live="polite" className="mt-4 space-y-3 text-sm">
              {error ? <p className="rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p> : null}

              {blocked ? (
                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="font-semibold text-amber-900">가드레일 차단</p>
                  <p className="text-amber-800">{blocked.reason}</p>
                  <p className="text-amber-800">{blocked.safeAlternative}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {GUARDRAIL_PROMPTS.map((prompt) => (
                      <button key={prompt} type="button" onClick={() => applyGuardrailPrompt(prompt)} className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100">적용: {prompt}</button>
                    ))}
                  </div>
                </div>
              ) : null}

              {result ? (
                <div className="space-y-3">
                  <Card title="단계 요약" badge="필수">{result.stageSummary}</Card>
                  <Card title="사고 촉진 질문" badge="필수"><ul className="list-disc space-y-1 pl-5">{result.thinkingQuestions.map((q) => (<li key={q}>{q}</li>))}</ul></Card>
                  <Card title="다음 행동" badge="실행">
                    <p>{result.nextAction}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={appendNextActionToNotes} className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white hover:bg-slate-700">노트 추가</button>
                      <button type="button" onClick={appendNextActionToDraft} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-100">초안 반영</button>
                    </div>
                  </Card>
                  <Card title="점검 체크리스트" badge="품질게이트">
                    <p><span className="font-semibold">근거:</span> {result.checklist.evidence.join(" | ")}</p>
                    <p><span className="font-semibold">변수:</span> {result.checklist.variables.join(" | ")}</p>
                    <p><span className="font-semibold">오차:</span> {result.checklist.error.join(" | ")}</p>
                    <p><span className="font-semibold">대안:</span> {result.checklist.alternatives.join(" | ")}</p>
                  </Card>
                  <Card title="다른 맥락 적용 질문" badge="권장">{result.transferQuestion}</Card>
                </div>
              ) : null}

              {!result && !error && !blocked ? <p className="text-slate-500">코칭을 실행하면 구조화된 결과가 표시됩니다.</p> : null}

              <Card title="운영 메타" badge="디버그">
                <p><span className="font-semibold">모델:</span> {meta?.model ?? "-"}</p>
                <p><span className="font-semibold">실행 ID:</span> {meta?.runId ?? "-"}</p>
                <p><span className="font-semibold">요청 시간:</span> {meta?.requestMs ?? 0}ms</p>
                <p><span className="font-semibold">토큰:</span> {meta?.tokenUsage ? `${meta.tokenUsage.input} 입력 / ${meta.tokenUsage.output} 출력 / ${meta.tokenUsage.total} 합계` : "-"}</p>
              </Card>

              <Card title="탐구 노트" badge={`${notes.length}개`}>
                {notes.length === 0 ? <p className="text-slate-500">아직 저장된 노트가 없습니다.</p> : null}
                <ul className="space-y-1">{notes.map((note, idx) => (<li key={`${note}-${idx}`} className="rounded-lg bg-slate-50 px-2 py-1">{note}</li>))}</ul>
              </Card>

              <Card title="보고서 초안" badge={`${reportDraft.length}자`}>
                <textarea value={reportDraft} onChange={(e) => setReportDraft(e.target.value)} rows={8} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm outline-none ring-cyan-200 focus:ring-2" />
              </Card>
            </div>
          </section>

          <section className={`${activeTab !== "chat" ? "hidden xl:flex" : "flex"} min-h-[720px] flex-col rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-xl`}>
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <h2 className="text-lg font-extrabold">보고서 작성 챗봇</h2>
                <p className="text-xs text-slate-600">보고서 문장 구성, 근거 연결, 표현 다듬기를 지원합니다.</p>
              </div>
              <button type="button" onClick={appendLastAssistantToDraft} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold hover:bg-slate-100">마지막 답변 초안 반영</button>
            </div>

            <div className="mt-3 flex-1 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3" aria-live="polite">
              {chatMessages.map((m, idx) => (
                <div key={`${m.role}-${idx}`} className={`max-w-[95%] rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "ml-auto bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-800"}`}>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide opacity-70">{m.role === "user" ? "사용자" : "챗봇"}</p>
                  <p className="whitespace-pre-wrap">{m.content}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 grid gap-2">
              <textarea
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                rows={4}
                placeholder="예: 결론 문단을 근거-주장 연결 중심으로 다시 써줘"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-cyan-200 focus:ring-2"
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-slate-500">{chatMeta ? `${chatMeta.model} · ${chatMeta.requestMs}ms` : "아직 챗봇 실행 기록이 없습니다."}</p>
                <button type="button" onClick={sendReportChat} disabled={chatLoading || !chatInput.trim()} className="rounded-xl bg-cyan-700 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-600 disabled:cursor-not-allowed disabled:bg-cyan-300">{chatLoading ? "생성 중..." : "전송"}</button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function KpiCard({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold tracking-wide text-slate-500">{title}</p>
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      className={`rounded-xl px-3 py-2 text-sm font-bold ${active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}