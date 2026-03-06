export const INQUIRY_STAGES = [
  "QUESTION_DEFINITION",
  "HYPOTHESIS",
  "EXPERIMENT_DESIGN",
  "DATA_COLLECTION",
  "DATA_ANALYSIS",
  "CONCLUSION",
  "REFLECTION",
] as const;

export type InquiryStage = (typeof INQUIRY_STAGES)[number];

const STAGE_INDEX = new Map<InquiryStage, number>(
  INQUIRY_STAGES.map((stage, index) => [stage, index]),
);

export type TransitionResult = {
  ok: boolean;
  reason?: string;
};

export function isInquiryStage(value: string): value is InquiryStage {
  return STAGE_INDEX.has(value as InquiryStage);
}

export function getNextStage(stage: InquiryStage): InquiryStage | null {
  const index = STAGE_INDEX.get(stage)!;
  return index >= INQUIRY_STAGES.length - 1 ? null : INQUIRY_STAGES[index + 1];
}

export function getPreviousStage(stage: InquiryStage): InquiryStage | null {
  const index = STAGE_INDEX.get(stage)!;
  return index <= 0 ? null : INQUIRY_STAGES[index - 1];
}

export function canTransition(
  from: InquiryStage,
  to: InquiryStage,
  options?: { allowBackward?: boolean; allowSkip?: boolean },
): TransitionResult {
  const fromIndex = STAGE_INDEX.get(from)!;
  const toIndex = STAGE_INDEX.get(to)!;

  if (fromIndex === toIndex) {
    return { ok: true };
  }

  if (toIndex < fromIndex && !options?.allowBackward) {
    return {
      ok: false,
      reason: `Backward transition is not allowed: ${from} -> ${to}`,
    };
  }

  if (!options?.allowSkip && Math.abs(toIndex - fromIndex) > 1) {
    return {
      ok: false,
      reason: `Stage skipping is not allowed: ${from} -> ${to}`,
    };
  }

  return { ok: true };
}

export function assertTransition(
  from: InquiryStage,
  to: InquiryStage,
  options?: { allowBackward?: boolean; allowSkip?: boolean },
): void {
  const result = canTransition(from, to, options);
  if (!result.ok) {
    throw new Error(result.reason ?? `Invalid inquiry stage transition: ${from} -> ${to}`);
  }
}
