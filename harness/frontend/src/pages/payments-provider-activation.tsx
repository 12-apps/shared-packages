/**
 * Activation — the R$0,01 charge that EARNS the sales switch (FUT-463, made
 * real for SDK providers by FUT-689), exercised END TO END on the demo admin
 * surface rather than pinned as a context marker: the fictional one-handle
 * provider declares `activationCharge`, its stub charge half records every
 * cent, and the host's activation step in the `renderVerification` slot runs
 * the published `verifyProviderCharge` through the case's own mount.
 *
 * The typed card decides the outcome, exactly as the wallet page's stub does:
 * the shared decline PAN mints a `-declined` token the adapter refuses with a
 * named reason; any other valid card pays the cent and gets it refunded.
 *
 * The one-handle provider's guide is switched OFF here on purpose: the
 * walkthrough's blocked/hidden choreography is the credentials page's
 * subject, and leaving it on would gate this page's whole point — the pay
 * button — behind a confirm click no scenario is about.
 */
import { useEffect, useRef, useState, type JSX } from 'react';

import {
  NewCardForm,
  detectBrand,
  onlyDigits,
  validateCardNumber,
  validateCpf,
  validateCvv,
  validateExpiry,
  validateHolder,
  type CardDetails,
  type CardFieldErrors,
  type PaymentProviderSettingsProps,
} from '@12-apps/payments-frontend';

import { aurora } from '../payments/admin-adapter';
import { adminCase } from '../payments/admin-cases';
import type { AdminWorld } from '../payments/admin-store';
import { CaseTabs, PageIntro, type HarnessCase } from '../payments/panel';

type VerificationContext = Parameters<
  NonNullable<PaymentProviderSettingsProps['renderVerification']>
>[0];

/** Digits of the shared decline PAN the packaged journeys type. */
const DECLINE_DIGITS = '4000000000000002';

/** The form's starting card — every field present and empty. */
const EMPTY_CARD: CardDetails = { number: '', holder: '', expiry: '', cvv: '' };

type Outcome =
  | { kind: 'idle' }
  | { kind: 'passed'; refunded: boolean }
  | { kind: 'failed'; reason: string };

/**
 * The stub token this fixture mints in place of a real tokenizer: unique per
 * attempt, and carrying the `-declined` suffix the stub convention refuses.
 */
function stubTokenFor(card: CardDetails, attempt: number): string {
  const base = `tok-harness-${attempt}`;
  return onlyDigits(card.number) === DECLINE_DIGITS ? `${base}-declined` : base;
}

/** Local validation, through the package's own validators. */
function validationErrors(card: CardDetails, cpf: string): {
  fields: CardFieldErrors;
  cpf: string | undefined;
} {
  return {
    fields: {
      number: validateCardNumber(card.number),
      holder: validateHolder(card.holder),
      expiry: validateExpiry(card.expiry),
      cvv: validateCvv(card.cvv, detectBrand(onlyDigits(card.number))),
    },
    cpf: validateCpf(cpf),
  };
}

interface ChargeState {
  card: CardDetails;
  setCard: React.Dispatch<React.SetStateAction<CardDetails>>;
  fieldErrors: CardFieldErrors;
  setFieldErrors: React.Dispatch<React.SetStateAction<CardFieldErrors>>;
  cpf: string;
  setCpf: (value: string) => void;
  outcome: Outcome;
  pay: () => Promise<void>;
}

/** The step's whole behaviour: validate, mint the stub token, POST, settle. */
function useActivationCharge(world: AdminWorld, ctx: VerificationContext): ChargeState {
  const [card, setCard] = useState<CardDetails>(EMPTY_CARD);
  const [fieldErrors, setFieldErrors] = useState<CardFieldErrors>({});
  const [cpf, setCpf] = useState('');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const attempts = useRef(0);

  const pay = async (): Promise<void> => {
    const errors = validationErrors(card, cpf);
    setFieldErrors(errors.fields);
    if (Object.values(errors.fields).some(Boolean) || errors.cpf) {
      setOutcome({ kind: 'failed', reason: errors.cpf ?? 'Confira os dados do cartão.' });
      return;
    }
    attempts.current += 1;
    const response = await world.fetchImpl(
      `${world.baseUrl}/activation/verify/${ctx.provider}`,
      {
        method: 'POST',
        body: JSON.stringify({
          token: stubTokenFor(card, attempts.current),
          taxId: onlyDigits(cpf),
          holderName: card.holder.trim(),
          email: 'dona@loja.exemplo',
        }),
      },
    );
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; refunded?: boolean; reason?: string }
      | null;
    if (body?.ok) {
      setOutcome({ kind: 'passed', refunded: body.refunded === true });
      // The published screen refetches, so the chip and the switch update.
      ctx.onVerified();
      return;
    }
    setOutcome({
      kind: 'failed',
      reason: body?.reason ?? 'Não foi possível concluir a cobrança de teste.',
    });
  };

  return { card, setCard, fieldErrors, setFieldErrors, cpf, setCpf, outcome, pay };
}

/** The form half: the SHARED card fields, the CPF, the refusal, the button. */
function ActivationForm({ state }: { state: ChargeState }): JSX.Element {
  return (
    <div style={{ maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <NewCardForm
        card={state.card}
        fieldErrors={state.fieldErrors}
        brand={detectBrand(onlyDigits(state.card.number))}
        setCard={state.setCard}
        setFieldErrors={state.setFieldErrors}
      />
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
        CPF do titular
        <input
          data-testid="buyer-cpf"
          value={state.cpf}
          onChange={(event) => state.setCpf(event.target.value)}
        />
      </label>
      {state.outcome.kind === 'failed' ? (
        <p role="alert" data-testid="activation-error" style={{ color: '#a02020', margin: 0 }}>
          {state.outcome.reason}
        </p>
      ) : null}
      <button type="button" data-testid="activation-pay" onClick={() => void state.pay()}>
        Pagar R$ 0,01 e ativar
      </button>
    </div>
  );
}

/**
 * The host-owned activation step, in the published slot. A settled pass stays
 * on screen — `proven` flips on the refetch, and replacing the report with a
 * bare confirmation would erase the refund line the owner is reading.
 */
function ActivationStep({
  world,
  ctx,
}: {
  world: AdminWorld;
  ctx: VerificationContext;
}): JSX.Element | null {
  const state = useActivationCharge(world, ctx);
  if (!ctx.connected) return null;
  return (
    <section
      data-testid="activation-step"
      style={{ border: '1px solid #9ab', borderRadius: 6, padding: 12, marginTop: 12 }}
    >
      <h3 style={{ marginTop: 0 }}>Cobrança de verificação — {ctx.displayName}</h3>
      {state.outcome.kind === 'passed' ? (
        <div>
          <p role="status" data-testid="activation-result" style={{ margin: 0 }}>
            Cobrança de R$ 0,01 aprovada.
          </p>
          <p data-testid="activation-refunded" style={{ margin: '4px 0 0' }}>
            {state.outcome.refunded
              ? 'O centavo foi estornado.'
              : 'Estorno pendente — concilie o centavo.'}
          </p>
        </div>
      ) : ctx.proven ? (
        <p data-testid="activation-proven" style={{ margin: 0 }}>
          Cobrança de verificação já confirmada.
        </p>
      ) : (
        <ActivationForm state={state} />
      )}
    </section>
  );
}

/**
 * The refusal probe: a RAW enable request, so "the switch is locked" and "the
 * server refuses" are two different facts — the second must not depend on the
 * first. Prints `<status> <error>`, the shape `PriorityRefusalButtons` prints.
 */
function EnableAttemptControl({ world }: { world: AdminWorld }): JSX.Element {
  const [refusal, setRefusal] = useState('(none)');
  const attempt = async (): Promise<void> => {
    const response = await world.fetchImpl(`${world.baseUrl}/settings/providers/aurora/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    setRefusal(`${response.status} ${body?.error ?? ''}`.trim());
  };
  return (
    <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
      <button type="button" data-testid="activation-enable-attempt" onClick={() => void attempt()}>
        Forçar ativação sem prova
      </button>
      <output data-testid="activation-enable-refusal">{refusal}</output>
    </div>
  );
}

/** Re-render whenever the world grows — push, not poll, as the probes do. */
function useWorldTick(world: AdminWorld): number {
  const [tick, setTick] = useState(0);
  useEffect(() => world.subscribe(() => setTick((current) => current + 1)), [world]);
  return tick;
}

/**
 * What the provider actually received, under the SAME ids the packaged wire
 * probe contract names (`provider-charge-count` / `provider-charges`), so the
 * journey's "each attempt was its own charge" reads the standard locators.
 */
function ActivationProbe({ world }: { world: AdminWorld }): JSX.Element {
  useWorldTick(world);
  const lines = world.activationCharges.map(
    (charge) => `${charge.provider}:${charge.status}:${charge.reference}:${charge.token}`,
  );
  const row = { display: 'flex', gap: 10, margin: 0 } as const;
  const term = { color: '#667', minWidth: 240, flexShrink: 0 } as const;
  return (
    <dl
      data-testid="activation-probe"
      style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, marginTop: 12 }}
    >
      <div style={row}>
        <dt style={term}>provider-charge-count</dt>
        <dd data-testid="provider-charge-count" style={{ margin: 0 }}>
          {String(world.activationCharges.length)}
        </dd>
      </div>
      <div style={row}>
        <dt style={term}>provider-charges</dt>
        <dd data-testid="provider-charges" style={{ margin: 0, wordBreak: 'break-all' }}>
          {lines.length > 0 ? lines.join(',') : '(none)'}
        </dd>
      </div>
      <div style={row}>
        <dt style={term}>activation-refunds</dt>
        <dd data-testid="activation-refunds" style={{ margin: 0, wordBreak: 'break-all' }}>
          {world.activationRefunds.length > 0 ? world.activationRefunds.join(',') : '(none)'}
        </dd>
      </div>
    </dl>
  );
}

const CASES: readonly HarnessCase[] = [
  adminCase(
    'unproven',
    'Connected, never charged',
    {
      // Guide OFF — see the header note. Connected: handle stored, probe
      // passed, `chargeVerifiedAt` empty, chain empty. Exactly the state the
      // switch must refuse.
      providers: [aurora({ guide: false })],
      stages: { aurora: 'connected' },
      baseUrl: '/api/harness/payments/activation-unproven',
    },
    {
      renderVerificationWith: (world) => (ctx) => <ActivationStep world={world} ctx={ctx} />,
      controls: (world) => (
        <>
          <EnableAttemptControl world={world} />
          <ActivationProbe world={world} />
        </>
      ),
    },
  ),
];

export function PaymentsProviderActivationPage(): JSX.Element {
  return (
    <>
      <PageIntro title="Provider settings · activation charge">
        The R$0,01 verification that earns the sales switch, end to end over a fictional
        provider: the switch starts locked with the package&apos;s own hint, a raw enable is
        refused as unproven, the owner&apos;s card pays the cent through the published
        verification flow — refunded on the spot — and a refused card names its reason while
        a retry reaches the provider as a fresh charge.
      </PageIntro>
      <CaseTabs cases={CASES} />
    </>
  );
}
