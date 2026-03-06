const DIRECT_ANSWER_PATTERNS = [
  /정답만/i,
  /답만/i,
  /그냥 답/i,
  /완성 답안/i,
  /숙제.*대신/i,
  /보고서.*써줘/i,
  /복붙/i,
  /answer only/i,
  /just the answer/i,
  /final answer/i,
  /give me the answer/i,
  /do my homework/i,
  /write the report for me/i,
  /copy[- ]?paste/i,
];

const RISKY_EXPERIMENT_PATTERNS = [
  /폭발/i,
  /화약/i,
  /고전압/i,
  /가연성/i,
  /염산/i,
  /황산/i,
  /락스.+혼합/i,
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
      reason: "위험 가능성이 있는 실험 요청입니다. 교사 승인 전에는 구체 절차를 제공할 수 없습니다.",
      safeAlternative:
        "안전 점검표를 먼저 작성하고, 저위험 대체 실험으로 주제를 재설계해 보세요.",
    };
  }

  if (detectDirectAnswerRequest(message)) {
    return {
      blocked: true,
      reason: "정답/완성 답안을 직접 제공하는 요청은 허용되지 않습니다.",
      safeAlternative:
        "현재 단계에 맞는 힌트, 근거 점검 질문, 사고 과정 코칭으로 도와드릴게요.",
    };
  }

  return { blocked: false };
}