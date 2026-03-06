import { z } from "zod";

import { INQUIRY_STAGES } from "@/lib/agent/state-machine";

const stageEnum = z.enum(INQUIRY_STAGES);

export const coachingResponseSchema = z.object({
  stageSummary: z.string().min(1),
  thinkingQuestions: z.array(z.string().min(1)).min(1).max(3),
  nextAction: z.string().min(1),
  checklist: z.object({
    evidence: z.array(z.string().min(1)).min(1),
    variables: z.array(z.string().min(1)).min(1),
    error: z.array(z.string().min(1)).min(1),
    alternatives: z.array(z.string().min(1)).min(1),
  }),
  transferQuestion: z.string().min(1),
});

export type CoachingResponse = z.infer<typeof coachingResponseSchema>;

export const recordDecisionInputSchema = z.object({
  sessionId: z.string().min(1),
  stage: stageEnum,
  decisionType: z.string().min(1),
  summary: z.string().min(1),
  evidence: z.array(z.string().min(1)).default([]),
  alternatives: z.array(z.string().min(1)).default([]),
});

export const fetchInquiryStateInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const updateReportDraftInputSchema = z.object({
  sessionId: z.string().min(1),
  stage: stageEnum,
  markdownAppend: z.string().min(1),
});

export const coachingResponseJsonSchema = {
  name: "stem_coaching_response",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "stageSummary",
      "thinkingQuestions",
      "nextAction",
      "checklist",
      "transferQuestion",
    ],
    properties: {
      stageSummary: { type: "string" },
      thinkingQuestions: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: { type: "string" },
      },
      nextAction: { type: "string" },
      checklist: {
        type: "object",
        additionalProperties: false,
        required: ["evidence", "variables", "error", "alternatives"],
        properties: {
          evidence: { type: "array", minItems: 1, items: { type: "string" } },
          variables: { type: "array", minItems: 1, items: { type: "string" } },
          error: { type: "array", minItems: 1, items: { type: "string" } },
          alternatives: { type: "array", minItems: 1, items: { type: "string" } },
        },
      },
      transferQuestion: { type: "string" },
    },
  },
} as const;
