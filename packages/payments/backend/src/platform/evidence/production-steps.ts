import type { EvidenceStepKey, HomologacaoEvidenceCopy } from './types';

/** A pack's steps with production's own sentences over the sandbox ones (FUT-4198). */
type Steps = HomologacaoEvidenceCopy['steps'];

export function withSteps(base: Steps, overrides: Partial<Record<EvidenceStepKey, { scenario: string; expected: string }>>): Steps {
  return { ...base, ...overrides } as Steps;
}

