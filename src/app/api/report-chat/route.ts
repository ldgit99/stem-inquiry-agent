import { NextResponse } from "next/server";

type ReportChatRequest = {
  sessionId: string;
  stage: string;
  reportDraft: string;
  userMessage: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
};

type ReportChatResponse = {
  reply: string;
  meta: {
    runId: string | null;
    model: string;
    requestMs: number;
  };
};

function buildSystemPrompt(stage: string): string {
  return [
    "당신은 STEM 탐구활동 보고서 작성을 돕는 한국어 코치입니다.",
    "학생이 명확하고 근거 중심으로 보고서를 작성하도록 도와주세요.",
    "데이터를 지어내지 말고, 누락된 정보는 질문하거나 자리표시자로 안내하세요.",
    "구조는 주장-근거-추론-한계-후속실험 순서를 우선합니다.",
    "간결하고 실행 가능한 문장으로 답하세요.",
    `현재 탐구 단계: ${stage}.`,
    "모든 답변은 반드시 한국어로 작성하세요.",
  ].join(" ");
}

function fallbackReply(stage: string, reportDraft: string): string {
  const hasDraft = reportDraft.trim().length > 0;
  const opening = hasDraft
    ? "현재 초안을 검토했습니다."
    : "먼저 짧은 보고서 뼈대를 만든 뒤 문단을 확장해 보세요.";

  return [
    opening,
    `${stage} 단계 보고서 작성 순서:`,
    "1) 주장 1문장",
    "2) 근거 2개(수치/관찰 포함)",
    "3) 근거와 주장을 연결하는 추론 1문장",
    "4) 한계 1개와 후속 실험 1개",
  ].join("\n");
}

function extractReply(response: unknown): string | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const direct = (response as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct.trim();
  }

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    if ((item as { type?: unknown }).type !== "message") {
      continue;
    }

    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const text = (part as { text?: unknown }).text;
      if (typeof text === "string" && text.trim().length > 0) {
        return text.trim();
      }
    }
  }

  return null;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

  let body: ReportChatRequest;
  try {
    body = (await request.json()) as ReportChatRequest;
  } catch {
    return NextResponse.json({ error: "JSON 본문 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (!body?.sessionId || !body?.stage || !body?.userMessage) {
    return NextResponse.json(
      { error: "sessionId, stage, userMessage는 필수입니다." },
      { status: 400 },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const fallback: ReportChatResponse = {
      reply: fallbackReply(body.stage, body.reportDraft ?? ""),
      meta: {
        runId: null,
        model,
        requestMs: Date.now() - startedAt,
      },
    };
    return NextResponse.json(fallback, { status: 200 });
  }

  try {
    const history = Array.isArray(body.history) ? body.history.slice(-8) : [];

    const input: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: buildSystemPrompt(body.stage) },
      {
        role: "user",
        content: [
          `세션 ID: ${body.sessionId}`,
          "현재 보고서 초안:",
          body.reportDraft?.trim() ? body.reportDraft : "(초안 비어 있음)",
        ].join("\n\n"),
      },
      ...history,
      { role: "user", content: body.userMessage },
    ];

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Responses API 요청 실패 (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as { id?: string };
    const reply = extractReply(payload) ?? fallbackReply(body.stage, body.reportDraft ?? "");

    const out: ReportChatResponse = {
      reply,
      meta: {
        runId: payload.id ?? null,
        model,
        requestMs: Date.now() - startedAt,
      },
    };

    return NextResponse.json(out, { status: 200 });
  } catch {
    const fallback: ReportChatResponse = {
      reply: fallbackReply(body.stage, body.reportDraft ?? ""),
      meta: {
        runId: null,
        model,
        requestMs: Date.now() - startedAt,
      },
    };

    return NextResponse.json(fallback, { status: 200 });
  }
}