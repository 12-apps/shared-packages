import { redactValue, type RecordedHttpCall } from '../../core/traffic-recorder';
import { pagbankApiBase } from '../../providers/pagbank-api-base';
import { pendingStep, stepOf, summarize as summary } from './steps';
import {
  EVIDENCE_STEP_KEYS,
  SECTION_OF,
  type EvidenceChargeRow,
  type EvidenceRecord,
  type EvidenceSection,
  type EvidenceStep,
  type EvidenceStepKey,
  type EvidenceSummary,
  type EvidenceWebhookEvent,
  type HomologacaoEvidenceCopy,
  type HomologacaoEvidenceStore,
} from './types';

/**
 * The evidence FILE (FUT-3696): the latest Connect record and the latest run,
 * plus the webhooks that have actually arrived for that run's orders, rendered
 * as the plain-text document PagBank's form takes.
 *
 * Rendered fresh on every download rather than stored, because the webhook
 * half keeps changing after the run: a notification that lands a minute later
 * is in the next download, and one that never lands stays PENDING.
 *
 * What it will not do is the point: every scenario the file lists is printed
 * whether or not it ran, a missing one is PENDING with the reason, and the
 * closing section counts what is still open and says the file guarantees no
 * approval. Nothing here can turn an absent call into a passed one.
 */

const PROVIDER = 'pagbank';
const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';
const RULE = '='.repeat(72);
const THIN = '-'.repeat(72);

export interface EvidenceFileDeps {
  store: HomologacaoEvidenceStore;
  copy: HomologacaoEvidenceCopy;
  identification: {
    name: string;
    site: string;
    /** The sandbox application's client id — public, and the reviewer needs it. */
    clientId: string | null;
    callbackUrl: string;
  };
  /** Stored deliveries whose payload names any of these provider ids. */
  webhookEvents: (ids: readonly string[]) => Promise<EvidenceWebhookEvent[]>;
  /** The charge row for any of these provider ids, as it stands now. */
  chargeRow: (ids: readonly string[]) => Promise<EvidenceChargeRow | null>;
  timeZone?: string;
  now?: () => Date;
}

export interface EvidenceFile {
  filename: string;
  content: string;
  summary: EvidenceSummary;
}

/** `17/10/2026 14:03:22 (GMT-03:00, America/Sao_Paulo)` — the zone always named. */
export function formatEvidenceTime(iso: string, timeZone = DEFAULT_TIME_ZONE): string {
  const date = new Date(iso);
  const local = new Intl.DateTimeFormat('pt-BR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  const offset =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
  return `${local.replace(',', '')} (${offset}, ${timeZone})`;
}

function stepIds(steps: readonly EvidenceStep[], keys: readonly EvidenceStepKey[]): string[] {
  return [
    ...new Set(
      steps
        .filter((step) => keys.includes(step.key))
        .flatMap((step) => [step.ids['order_id'], step.ids['charge_id']])
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
}

/** The inbound half of a scenario: what arrived, and what it moved. */
async function webhookStep(
  deps: EvidenceFileDeps,
  key: 'pix.webhook' | 'card.webhook',
  ids: readonly string[],
): Promise<EvidenceStep> {
  const outcome = deps.copy.outcome;
  if (ids.length === 0) return pendingStep(key, outcome);
  const events = await deps.webhookEvents(ids);
  if (events.length === 0) return pendingStep(key, outcome, outcome.webhookNone);
  const verdict = webhookVerdict(outcome, key, events, await deps.chargeRow(ids));
  const first = [...events].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())[0]!;
  const timeZone = deps.timeZone ?? DEFAULT_TIME_ZONE;
  const notes = events.flatMap((event) => [
    `${formatEvidenceTime(event.receivedAt.toISOString(), timeZone)} — ${event.status}` +
      (event.processedAt ? ` (${formatEvidenceTime(event.processedAt.toISOString(), timeZone)})` : ''),
    JSON.stringify(redactValue(event.payload), null, 2),
  ]);
  return stepOf(key, verdict.status, first.receivedAt, {
    notes,
    ids: Object.fromEntries(ids.map((id) => [id.startsWith('ORDE_') ? 'order_id' : 'charge_id', id])),
    observed: verdict.observed,
  });
}

/**
 * "Received AND processed": every delivery processed, and the charge row it
 * moved in the state the scenario ends in (a Pix one PAID). A delivery still
 * waiting in the inbox is PENDING — never counted as processed.
 */
function webhookVerdict(
  outcome: HomologacaoEvidenceCopy['outcome'],
  key: 'pix.webhook' | 'card.webhook',
  events: readonly EvidenceWebhookEvent[],
  row: EvidenceChargeRow | null,
): { status: EvidenceStep['status']; observed: string } {
  if (events.some((event) => event.status === 'FAILED')) return { status: 'FAILED', observed: outcome.webhookFailed };
  const statuses = [...new Set(events.map((event) => event.status))].join(', ');
  const rowStatus = row?.status ?? null;
  const processed =
    events.every((event) => event.status === 'PROCESSED') && row !== null && (key !== 'pix.webhook' || row.status === 'PAID');
  return processed
    ? { status: 'EXECUTED', observed: outcome.webhookReceived(events.length, statuses, rowStatus) }
    : { status: 'PENDING', observed: outcome.webhookNotProcessed(statuses, rowStatus) };
}

/** Every scenario in canonical order — a missing one is PENDING, never dropped. */
async function allSteps(
  deps: EvidenceFileDeps,
  connect: EvidenceRecord | null,
  run: EvidenceRecord | null,
): Promise<EvidenceStep[]> {
  const recorded = new Map<EvidenceStepKey, EvidenceStep>();
  for (const step of [...(connect?.steps ?? []), ...(run?.steps ?? [])]) recorded.set(step.key, step);
  const runSteps = run?.steps ?? [];
  recorded.set('pix.webhook', await webhookStep(deps, 'pix.webhook', stepIds(runSteps, ['pix.create', 'pix.consult'])));
  recorded.set(
    'card.webhook',
    await webhookStep(deps, 'card.webhook', stepIds(runSteps, ['card.approved', 'card.declined'])),
  );
  return EVIDENCE_STEP_KEYS.map((key) => recorded.get(key) ?? pendingStep(key, deps.copy.outcome));
}

function numbering(steps: readonly EvidenceStep[]): Map<EvidenceStepKey, string> {
  const sections: EvidenceSection[] = ['CONNECT', 'PIX', 'CARD'];
  const numbers = new Map<EvidenceStepKey, string>();
  sections.forEach((section, s) => {
    steps
      .filter((step) => SECTION_OF[step.key] === section)
      .forEach((step, i) => numbers.set(step.key, `${s + 2}.${i + 1}`));
  });
  return numbers;
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function renderCall(copy: HomologacaoEvidenceCopy, call: RecordedHttpCall, n: number, timeZone: string): string[] {
  const lines = [
    `${copy.labels.request} ${n} — ${formatEvidenceTime(call.at, timeZone)}`,
    `${call.method} ${call.url}`,
    ...Object.entries(call.requestHeaders).map(([name, value]) => `${name}: ${value}`),
  ];
  if (call.requestBody !== undefined) lines.push('', json(call.requestBody));
  lines.push('', `${copy.labels.response} ${n}`);
  if (call.status === undefined) {
    lines.push(copy.labels.noResponse(call.error ?? ''));
  } else {
    lines.push(`${copy.labels.httpStatus}: ${call.status} ${call.statusText ?? ''}`.trimEnd());
    if (call.responseBody !== undefined) lines.push('', json(call.responseBody));
  }
  return [...lines, ''];
}

function renderStep(copy: HomologacaoEvidenceCopy, step: EvidenceStep, number: string, timeZone: string): string {
  const { scenario, expected } = copy.steps[step.key];
  const conclusion =
    step.status === 'EXECUTED'
      ? copy.outcome.asExpected
      : step.status === 'FAILED'
        ? copy.outcome.notAsExpected
        : copy.outcome.notRun;
  const ids = Object.entries(step.ids).map(([name, value]) => `${name}=${value}`);
  const lines = [
    THIN,
    `[${number}] ${scenario} — ${copy.statusLabels[step.status]}`,
    THIN,
    `${copy.labels.scenario}: ${scenario}`,
    `${copy.labels.time}: ${step.at && step.status !== 'PENDING' ? formatEvidenceTime(step.at, timeZone) : '—'}`,
    ...(ids.length > 0 ? [`${copy.labels.ids}: ${ids.join(', ')}`] : []),
    '',
  ];
  if (step.notes.length > 0) lines.push(`${copy.labels.notes}:`, ...step.notes, '');
  if (step.calls.length > 0) {
    step.calls.forEach((call, i) => lines.push(...renderCall(copy, call, i + 1, timeZone)));
  } else {
    lines.push(step.status === 'PENDING' ? copy.labels.noCallsPending : copy.labels.noCalls, '');
  }
  lines.push(
    `${copy.labels.expected}: ${expected}`,
    `${copy.labels.observed}: ${step.observed}`,
    `${copy.labels.conclusion}: ${conclusion}`,
    '',
  );
  return lines.join('\n');
}

function renderIdentification(
  deps: EvidenceFileDeps,
  connect: EvidenceRecord | null,
  run: EvidenceRecord | null,
  generatedAt: Date,
  summary: EvidenceSummary,
): string[] {
  const { identification: id, copy } = deps;
  const timeZone = deps.timeZone ?? DEFAULT_TIME_ZONE;
  // The first moment something in the group actually ran — never a record's
  // creation time, which exists even when every step in it stayed pending.
  const when = (record: EvidenceRecord | null): string => {
    const ran = (record?.steps ?? []).filter((step) => step.status !== 'PENDING' && step.at).map((step) => step.at!);
    return ran.length > 0 ? formatEvidenceTime(ran.sort()[0]!, timeZone) : copy.identification.notRun;
  };
  return [
    RULE,
    `1. ${copy.identification.heading}`,
    RULE,
    `${copy.identification.name}: ${id.name}`,
    `${copy.identification.site}: ${id.site}`,
    `${copy.identification.environment}: SANDBOX (${pagbankApiBase('SANDBOX')})`,
    `${copy.identification.testsAt} — ${copy.identification.testsAtConnect}: ${when(connect)} · ` +
      `${copy.identification.testsAtRun}: ${when(run)}`,
    `${copy.identification.clientId}: ${id.clientId ?? '—'}`,
    `${copy.identification.callback}: ${id.callbackUrl}`,
    `${copy.identification.generatedAt}: ${formatEvidenceTime(generatedAt.toISOString(), timeZone)}`,
    `${copy.labels.status}: ${copy.identification.situation(summary)}`,
    '',
    copy.redactionNote,
    '',
  ];
}

function renderPendencies(copy: HomologacaoEvidenceCopy, steps: readonly EvidenceStep[], numbers: Map<EvidenceStepKey, string>): string[] {
  const open = steps.filter((step) => step.status !== 'EXECUTED');
  return [
    RULE,
    copy.pendencies.heading,
    RULE,
    open.length > 0
      ? copy.pendencies.incomplete(
          open.filter((step) => step.status === 'FAILED').length,
          open.filter((step) => step.status === 'PENDING').length,
        )
      : copy.pendencies.allExecuted,
    '',
    ...open.map(
      (step) =>
        `- [${numbers.get(step.key)}] ${copy.steps[step.key].scenario} — ${copy.statusLabels[step.status]}: ${step.observed}`,
    ),
    ...(open.length > 0 ? [''] : []),
    ...copy.pendencies.notCovered.map((line) => `- ${line}`),
    '',
    copy.pendencies.noGuarantee,
    '',
  ];
}

/** Build the file from what is stored and what has arrived since. */
export async function buildHomologacaoEvidenceFile(deps: EvidenceFileDeps): Promise<EvidenceFile> {
  const generatedAt = (deps.now ?? (() => new Date()))();
  const timeZone = deps.timeZone ?? DEFAULT_TIME_ZONE;
  const [connect, run] = await Promise.all([
    deps.store.latest(PROVIDER, 'CONNECT'),
    deps.store.latest(PROVIDER, 'RUN'),
  ]);
  const steps = await allSteps(deps, connect, run);
  const numbers = numbering(steps);
  const { copy } = deps;

  const index = [
    RULE,
    copy.labels.index,
    RULE,
    ...steps.map(
      (step) => `[${numbers.get(step.key)}] ${copy.steps[step.key].scenario} — ${copy.statusLabels[step.status]}`,
    ),
    '',
  ];
  const sections = (['CONNECT', 'PIX', 'CARD'] as const).flatMap((section, s) => [
    RULE,
    `${s + 2}. ${copy.sectionTitles[section]}`,
    RULE,
    '',
    ...steps
      .filter((step) => SECTION_OF[step.key] === section)
      .map((step) => renderStep(copy, step, numbers.get(step.key)!, timeZone)),
  ]);

  const content = [
    copy.title,
    '',
    ...renderIdentification(deps, connect, run, generatedAt, summary(steps)),
    ...index,
    ...sections,
    ...renderPendencies(copy, steps, numbers),
  ].join('\n');
  const stamp = generatedAt.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return { filename: `pagbank-homologacao-evidencias-${stamp}.txt`, content, summary: summary(steps) };
}
