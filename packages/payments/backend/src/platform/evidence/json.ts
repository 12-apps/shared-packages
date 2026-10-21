import type { RecordedHttpCall } from '../../core/traffic-recorder';
import { pagbankApiBase } from '../../providers/pagbank-api-base';
import { evidenceStamp, loadEvidence, type EvidenceFile, type EvidenceFileDeps } from './file';
import { summarize } from './steps';
import type { EvidenceStep } from './types';

/**
 * The evidence as JSON (FUT-3755) — the same records the TXT renders, in the
 * shape PagBank's triage asked for: "logs completos no formato JSON (request e
 * response)".
 *
 * Built from the STORED records, never by parsing the TXT, so it cannot drift
 * from it: both read {@link loadEvidence}, and both get the same redaction,
 * because the calls were redacted when they were recorded. A PENDING scenario
 * is listed with no calls, exactly as in the TXT — absence stays visible.
 */

interface JsonCall {
  at: string;
  request: { method: string; url: string; headers: Record<string, string>; body: unknown };
  response: { status: number; statusText: string | null; body: unknown } | null;
  error: string | null;
}

function callOf(call: RecordedHttpCall): JsonCall {
  return {
    at: call.at,
    request: {
      method: call.method,
      url: call.url,
      headers: call.requestHeaders,
      body: call.requestBody ?? null,
    },
    response:
      call.status === undefined
        ? null
        : { status: call.status, statusText: call.statusText ?? null, body: call.responseBody ?? null },
    error: call.error ?? null,
  };
}

function scenarioOf(deps: EvidenceFileDeps, step: EvidenceStep, number: string) {
  const { scenario, expected } = deps.copy.steps[step.key];
  return {
    number,
    key: step.key,
    scenario,
    status: step.status,
    at: step.status === 'PENDING' ? null : (step.at ?? null),
    ids: step.ids,
    expected,
    observed: step.observed,
    notes: step.notes,
    calls: step.calls.map(callOf),
  };
}

/** The JSON evidence file: same name as the TXT of the same moment, `.json`. */
export async function buildHomologacaoEvidenceJson(deps: EvidenceFileDeps): Promise<EvidenceFile> {
  const { generatedAt, steps, numbers } = await loadEvidence(deps);
  const summary = summarize(steps);
  const document = {
    title: deps.copy.title,
    generatedAt: generatedAt.toISOString(),
    environment: { name: 'SANDBOX', apiBase: pagbankApiBase('SANDBOX') },
    identification: deps.identification,
    summary,
    scenarios: steps.map((step) => scenarioOf(deps, step, numbers.get(step.key) ?? '')),
  };
  return {
    filename: `pagbank-homologacao-evidencias-${evidenceStamp(generatedAt)}.json`,
    content: JSON.stringify(document, null, 2),
    summary,
  };
}
