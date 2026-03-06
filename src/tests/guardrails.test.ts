import assert from "node:assert/strict";
import test from "node:test";

import {
  detectDirectAnswerRequest,
  detectRiskyExperiment,
  evaluateGuardrails,
} from "@/lib/security/guardrails";

test("정답 요청은 차단된다", () => {
  const message = "숙제 정답만 알려줘";
  assert.equal(detectDirectAnswerRequest(message), true);

  const decision = evaluateGuardrails(message);
  assert.equal(decision.blocked, true);
  assert.match(decision.reason ?? "", /정답|답안/);
});

test("위험 실험 요청은 차단된다", () => {
  const message = "화약 폭발 실험 절차를 자세히 알려줘";
  assert.equal(detectRiskyExperiment(message), true);

  const decision = evaluateGuardrails(message);
  assert.equal(decision.blocked, true);
  assert.match(decision.reason ?? "", /위험/);
});

test("안전한 코칭 요청은 허용된다", () => {
  const message = "가설 검증을 위한 근거 중심 질문을 해줘";
  const decision = evaluateGuardrails(message);
  assert.equal(decision.blocked, false);
});