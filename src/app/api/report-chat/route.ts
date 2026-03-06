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
    "You are a STEM inquiry report writing assistant.",
    "Help the student write clear, evidence-based report sections.",
    "Do not fabricate data. If data is missing, ask for it and provide placeholders.",
    "Prioritize structure: claim, evidence, reasoning, limitations, and next experiment.",
    "Keep replies concise and actionable.",
    `Current inquiry stage: ${stage}.`,
  ].join(" ");
}

function fallbackReply(stage: string, reportDraft: string): string {
  const hasDraft = reportDraft.trim().length > 0;
  const opening = hasDraft
    ? "I reviewed your draft."
    : "Start with a short report skeleton before expanding paragraphs.";

  return [
    opening,
    `For ${stage}, write:`,
    "1) One claim sentence",
    "2) Two evidence bullets (with numbers or observations)",
    "3) One reasoning sentence linking evidence to the claim",
    "4) One limitation and one next-step experiment",
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
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.sessionId || !body?.stage || !body?.userMessage) {
    return NextResponse.json(
      { error: "sessionId, stage, and userMessage are required" },
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
          `Session ID: ${body.sessionId}`,
          "Current report draft:",
          body.reportDraft?.trim() ? body.reportDraft : "(empty draft)",
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
      body: JSON.stringify({
        model,
        input,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Responses API failed (${response.status}): ${text}`);
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