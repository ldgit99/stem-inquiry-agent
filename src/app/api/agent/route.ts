import { NextResponse } from "next/server";

import {
  coachingResponseJsonSchema,
  coachingResponseSchema,
  fetchInquiryStateInputSchema,
  recordDecisionInputSchema,
  updateReportDraftInputSchema,
} from "@/lib/agent/schemas";
import {
  INQUIRY_STAGES,
  canTransition,
  isInquiryStage,
  type InquiryStage,
} from "@/lib/agent/state-machine";
import { evaluateGuardrails } from "@/lib/security/guardrails";

type RequestBody = {
  sessionId: string;
  message: string;
  currentStage: string;
};

type ToolCall = {
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
};

type SessionState = {
  currentStage: InquiryStage;
  decisions: Array<{
    stage: InquiryStage;
    decisionType: string;
    summary: string;
    evidence: string[];
    alternatives: string[];
    createdAt: string;
  }>;
  reportDraft: string;
};

const MEMORY_STORE = new Map<string, SessionState>();

function ensureSessionState(sessionId: string, currentStage: InquiryStage): SessionState {
  const found = MEMORY_STORE.get(sessionId);
  if (found) {
    return found;
  }

  const created: SessionState = {
    currentStage,
    decisions: [],
    reportDraft: "",
  };
  MEMORY_STORE.set(sessionId, created);
  return created;
}

function buildSystemPrompt(currentStage: InquiryStage): string {
  return [
    "You are a STEM inquiry coach for middle/high school students.",
    "Never provide direct final answers, copy-paste conclusions, or assignment-complete text.",
    "Use questions to deepen reasoning and connect each claim to evidence.",
    `Current inquiry stage: ${currentStage}.`,
    `Allowed stages: ${INQUIRY_STAGES.join(", ")}. Do not skip stages without explicit evidence.`,
    "You must return valid JSON matching the provided schema.",
  ].join(" ");
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractToolCalls(response: unknown): ToolCall[] {
  if (!response || typeof response !== "object") {
    return [];
  }

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return [];
  }

  return output
    .filter((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const type = (item as { type?: unknown }).type;
      return type === "function_call";
    })
    .map((item) => item as ToolCall);
}

function extractOutputText(response: unknown): string | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const direct = (response as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct;
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
        return text;
      }
    }
  }

  return null;
}

async function callResponsesApi(payload: Record<string, unknown>): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Responses API request failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function runAgentWithTools(body: {
  sessionId: string;
  message: string;
  currentStage: InquiryStage;
}): Promise<unknown> {
  const tools = [
    {
      type: "function",
      name: "record_decision",
      description: "Record a decision event for report traceability.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["sessionId", "stage", "decisionType", "summary"],
        properties: {
          sessionId: { type: "string" },
          stage: { type: "string", enum: INQUIRY_STAGES },
          decisionType: { type: "string" },
          summary: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          alternatives: { type: "array", items: { type: "string" } },
        },
      },
    },
    {
      type: "function",
      name: "fetch_inquiry_state",
      description: "Fetch current session stage and decision history.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["sessionId"],
        properties: {
          sessionId: { type: "string" },
        },
      },
    },
    {
      type: "function",
      name: "update_report_draft",
      description: "Append new content to the report draft.",
      parameters: {
        type: "object",
        additionalProperties: false,
        required: ["sessionId", "stage", "markdownAppend"],
        properties: {
          sessionId: { type: "string" },
          stage: { type: "string", enum: INQUIRY_STAGES },
          markdownAppend: { type: "string" },
        },
      },
    },
  ];

  const model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  let payload: Record<string, unknown> = {
    model,
    input: [
      { role: "system", content: buildSystemPrompt(body.currentStage) },
      { role: "user", content: body.message },
    ],
    tools,
    text: {
      format: {
        type: "json_schema",
        ...coachingResponseJsonSchema,
      },
    },
  };

  let response = await callResponsesApi(payload);

  for (let i = 0; i < 4; i += 1) {
    const calls = extractToolCalls(response);
    if (calls.length === 0) {
      return response;
    }

    const outputs = calls.map((call) => {
      const args = typeof call.arguments === "string" ? safeJsonParse(call.arguments) : null;
      const name = call.name ?? "";

      if (name === "fetch_inquiry_state") {
        const parsed = fetchInquiryStateInputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            type: "function_call_output",
            call_id: call.call_id ?? call.id,
            output: JSON.stringify({ error: "Invalid fetch_inquiry_state args" }),
          };
        }

        const state = ensureSessionState(parsed.data.sessionId, body.currentStage);
        return {
          type: "function_call_output",
          call_id: call.call_id ?? call.id,
          output: JSON.stringify(state),
        };
      }

      if (name === "record_decision") {
        const parsed = recordDecisionInputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            type: "function_call_output",
            call_id: call.call_id ?? call.id,
            output: JSON.stringify({ error: "Invalid record_decision args" }),
          };
        }

        const state = ensureSessionState(parsed.data.sessionId, body.currentStage);
        const transition = canTransition(state.currentStage, parsed.data.stage, {
          allowBackward: false,
          allowSkip: false,
        });
        if (!transition.ok) {
          return {
            type: "function_call_output",
            call_id: call.call_id ?? call.id,
            output: JSON.stringify({ error: transition.reason }),
          };
        }

        state.currentStage = parsed.data.stage;
        state.decisions.push({
          stage: parsed.data.stage,
          decisionType: parsed.data.decisionType,
          summary: parsed.data.summary,
          evidence: parsed.data.evidence,
          alternatives: parsed.data.alternatives,
          createdAt: new Date().toISOString(),
        });

        return {
          type: "function_call_output",
          call_id: call.call_id ?? call.id,
          output: JSON.stringify({ ok: true, currentStage: state.currentStage }),
        };
      }

      if (name === "update_report_draft") {
        const parsed = updateReportDraftInputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            type: "function_call_output",
            call_id: call.call_id ?? call.id,
            output: JSON.stringify({ error: "Invalid update_report_draft args" }),
          };
        }

        const state = ensureSessionState(parsed.data.sessionId, body.currentStage);
        state.reportDraft = `${state.reportDraft}\n\n${parsed.data.markdownAppend}`.trim();

        return {
          type: "function_call_output",
          call_id: call.call_id ?? call.id,
          output: JSON.stringify({ ok: true, length: state.reportDraft.length }),
        };
      }

      return {
        type: "function_call_output",
        call_id: call.call_id ?? call.id,
        output: JSON.stringify({ error: `Unsupported tool: ${name}` }),
      };
    });

    payload = {
      model,
      previous_response_id: (response as { id?: string }).id,
      input: outputs,
      tools,
      text: {
        format: {
          type: "json_schema",
          ...coachingResponseJsonSchema,
        },
      },
    };

    response = await callResponsesApi(payload);
  }

  return response;
}

function fallbackCoachingResponse(currentStage: InquiryStage) {
  return {
    stageSummary: `${currentStage} 단계에서 핵심 근거를 정리하는 중입니다.`,
    thinkingQuestions: [
      "이 주장을 직접 지지하는 관찰/데이터는 무엇인가요?",
      "통제하지 못한 변수가 결과에 어떤 영향을 줄 수 있나요?",
    ],
    nextAction: "가장 중요한 근거 1개와 부족한 근거 1개를 구분해 적어보세요.",
    checklist: {
      evidence: ["주장마다 근거 출처를 1개 이상 연결했는가"],
      variables: ["독립/종속/통제 변수를 구분했는가"],
      error: ["오차 원인 1개 이상을 명시했는가"],
      alternatives: ["대안 해석 또는 반례 가능성을 점검했는가"],
    },
    transferQuestion: "이 탐구 원리를 다른 과목 주제에 적용하면 어떤 질문이 가능할까요?",
  };
}

export async function POST(request: Request) {
  let json: RequestBody;
  try {
    json = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!json?.sessionId || !json?.message || !json?.currentStage) {
    return NextResponse.json(
      { error: "sessionId, message, currentStage are required" },
      { status: 400 },
    );
  }

  if (!isInquiryStage(json.currentStage)) {
    return NextResponse.json(
      {
        error: `Invalid currentStage. Allowed values: ${INQUIRY_STAGES.join(", ")}`,
      },
      { status: 400 },
    );
  }

  const guardrail = evaluateGuardrails(json.message);
  if (guardrail.blocked) {
    return NextResponse.json(
      {
        blocked: true,
        reason: guardrail.reason,
        safeAlternative: guardrail.safeAlternative,
      },
      { status: 200 },
    );
  }

  try {
    const response = await runAgentWithTools({
      sessionId: json.sessionId,
      message: json.message,
      currentStage: json.currentStage,
    });

    const outputText = extractOutputText(response);
    if (!outputText) {
      return NextResponse.json({ data: fallbackCoachingResponse(json.currentStage) }, { status: 200 });
    }

    const parsed = coachingResponseSchema.safeParse(safeJsonParse(outputText));
    if (!parsed.success) {
      return NextResponse.json({ data: fallbackCoachingResponse(json.currentStage) }, { status: 200 });
    }

    return NextResponse.json({ data: parsed.data }, { status: 200 });
  } catch {
    return NextResponse.json({ data: fallbackCoachingResponse(json.currentStage) }, { status: 200 });
  }
}
