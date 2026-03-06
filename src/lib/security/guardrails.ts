const DIRECT_ANSWER_PATTERNS = [
  /answer only/i,
  /just the answer/i,
  /final answer/i,
  /give me the answer/i,
  /do my homework/i,
  /write the report for me/i,
  /copy[- ]?paste/i,
];

const RISKY_EXPERIMENT_PATTERNS = [
  /explosive/i,
  /gunpowder/i,
  /high voltage/i,
  /flammable/i,
  /hydrochloric acid/i,
  /sulfuric acid/i,
  /bleach.+mix/i,
];

export type GuardrailDecision = {
  blocked: boolean;
  reason?: string;
  safeAlternative?: string;
};

export function detectDirectAnswerRequest(message: string): boolean {
  return DIRECT_ANSWER_PATTERNS.some((pattern) => pattern.test(message));
}

export function detectRiskyExperiment(message: string): boolean {
  return RISKY_EXPERIMENT_PATTERNS.some((pattern) => pattern.test(message));
}

export function evaluateGuardrails(message: string): GuardrailDecision {
  if (detectRiskyExperiment(message)) {
    return {
      blocked: true,
      reason: "Potentially hazardous experiment detected. Detailed procedures require teacher approval.",
      safeAlternative:
        "Start with a safety checklist and redesign the topic into a low-risk experiment.",
    };
  }

  if (detectDirectAnswerRequest(message)) {
    return {
      blocked: true,
      reason: "Direct final answers or complete writeups are not allowed.",
      safeAlternative:
        "I can provide hints, reasoning checks, and step-by-step coaching for your current stage.",
    };
  }

  return { blocked: false };
}