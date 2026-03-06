const DIRECT_ANSWER_PATTERNS = [
  /정답만/i,
  /답만/i,
  /그냥 답/i,
  /final answer/i,
  /just answer/i,
  /give me the answer/i,
  /숙제.*대신/i,
  /보고서.*써줘/i,
  /복붙/i,
];

const RISKY_EXPERIMENT_PATTERNS = [
  /폭발/i,
  /화약/i,
  /염산/i,
  /황산/i,
  /가연성/i,
  /high voltage/i,
  /flammable/i,
  /explosive/i,
  /acid/i,
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
      reason: "위험 실험 가능성이 있어 교사 승인 전에는 구체 절차를 제공할 수 없습니다.",
      safeAlternative:
        "안전한 대체 탐구 주제와 위험요소 식별 체크리스트를 먼저 작성해 보세요.",
    };
  }

  if (detectDirectAnswerRequest(message)) {
    return {
      blocked: true,
      reason: "정답/완성 답안 직접 제공은 허용되지 않습니다.",
      safeAlternative:
        "현재 단계에서 필요한 개념 힌트와 검증 질문 중심으로 함께 진행할게요.",
    };
  }

  return { blocked: false };
}
