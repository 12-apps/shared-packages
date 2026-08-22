// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActivationChargeCopy } from '../charge-copy';
import { useActivationCharge } from '../use-activation-charge';
import { PT_BR_CARD_COPY } from '../../card/pt-BR';

/**
 * The card half of the activation step.
 *
 * The property under test throughout: the owner's card goes through the SAME
 * path a shopper's does. Nothing reaches the provider unvalidated, nothing is
 * charged without a real encrypted token, and a "pass" is only ever the
 * server's own answer.
 */

/**
 * The card module is spied on, not replaced: both spies DEFAULT to the real
 * implementation, so a test that says nothing about tokenization exercises the
 * real refusal path (a missing key is an error, never a fallback — the exact
 * false positive the activation charge exists to catch).
 */
vi.mock('../../card', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../card')>();
  return {
    ...actual,
    tokenizerFor: vi.fn(actual.tokenizerFor),
    tokenizeCard: vi.fn(actual.tokenizeCard),
  };
});

const { tokenizeCard, tokenizerFor } = await import('../../card');
const realCard = await vi.importActual<typeof import('../../card')>('../../card');

const COPY: ActivationChargeCopy = {
  card: PT_BR_CARD_COPY,
  noTokenizer: 'copy:no-tokenizer for {provider}',
  chargeFailed: 'copy:charge-failed',
  unreachable: 'copy:unreachable',
};

const URL_UNDER_TEST = '/api/admin/loja/payments/providers/pagbank/verify-charge';

/** A card that passes every local validator, so the flow reaches the network. */
const GOOD_CARD = {
  number: '4111 1111 1111 1111',
  holder: 'MARIA SOUZA',
  expiry: '12/34',
  cvv: '123',
};
const GOOD_CPF = '111.444.777-35';

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

/** What the verification endpoint's `GET` says about the charge to come. */
interface ProbeAnswers {
  publicKey?: string | null;
  amountCents?: number | null;
}

/** Records every ask; answers the probe GET and a queue of POST bodies. */
function stubFetch(answers: ProbeAnswers & { post?: unknown[] } = {}) {
  const calls: Call[] = [];
  const posts = [...(answers.post ?? [])];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({
        url: String(input),
        method,
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      });
      // `in`, not `??`: the store having NO key is the case that matters most
      // here, and `null ?? 'PUBKEY'` would hand it one.
      const publicKey = 'publicKey' in answers ? answers.publicKey : 'PUBKEY';
      // Same reason as the key: a host that answers NO amount is a case, and
      // `null ?? 1` would quietly invent the very cent this hook refuses to.
      const amountCents = 'amountCents' in answers ? answers.amountCents : 1;
      const payload =
        method === 'GET'
          ? { publicKey, amountCents }
          : (posts.shift() ?? { ok: true, refunded: true });
      return { ok: true, json: async () => payload } as unknown as Response;
    }),
  );
  return { calls, posted: () => calls.filter((c) => c.method === 'POST') };
}

/** Mint successfully, so a test can reach the charge itself. */
function stubTokenizer(): void {
  vi.mocked(tokenizeCard).mockResolvedValue({
    ok: true,
    data: { token: 'ENCRYPTED', brand: 'visa', last4: '1111' },
  });
}

function options(overrides: Partial<Parameters<typeof useActivationCharge>[0]> = {}) {
  return {
    verifyChargeUrl: URL_UNDER_TEST,
    provider: 'pagbank',
    email: 'dona@loja.example',
    onVerified: vi.fn(),
    copy: COPY,
    ...overrides,
  };
}

/** Render with ONE options object, held across every re-render. */
function usingOptions(opts: Parameters<typeof useActivationCharge>[0]) {
  return () => useActivationCharge(opts);
}

/** Type a valid card and CPF into the form the hook owns. */
function fillIn(result: { current: ReturnType<typeof useActivationCharge> }): void {
  act(() => {
    result.current.setCard(GOOD_CARD);
    result.current.setCpf(GOOD_CPF);
  });
}

beforeEach(() => {
  // Real by default, re-installed each test so `restoreAllMocks` below cannot
  // leave a spy answering `undefined` and turn a refusal into a silent pass.
  vi.mocked(tokenizerFor).mockImplementation(realCard.tokenizerFor);
  vi.mocked(tokenizeCard).mockImplementation(realCard.tokenizeCard);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useActivationCharge — before anything is charged', () => {
  it('reads the store’s key from the VERIFICATION endpoint on mount', async () => {
    const io = stubFetch({ publicKey: 'PUBKEY' });
    renderHook(usingOptions(options()));

    await waitFor(() => expect(io.calls).toHaveLength(1));
    expect(io.calls[0]).toMatchObject({ url: URL_UNDER_TEST, method: 'GET' });
  });

  it('refuses to charge an invalid card, and says which field', async () => {
    const io = stubFetch();
    stubTokenizer();
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(io.calls.length).toBeGreaterThan(0));

    act(() => {
      result.current.setCard({ ...GOOD_CARD, number: '4111 1111 1111 1112' });
      result.current.setCpf(GOOD_CPF);
    });
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.fieldErrors.number).toBeTruthy();
    expect(result.current.state).toEqual({ kind: 'idle' });
    // Nothing left the browser: local validation is the first gate, not a hint.
    expect(io.posted()).toHaveLength(0);
  });

  it('refuses to charge an invalid CPF', async () => {
    const io = stubFetch();
    stubTokenizer();
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(io.calls.length).toBeGreaterThan(0));

    act(() => {
      result.current.setCard(GOOD_CARD);
      result.current.setCpf('111.111.111-11');
    });
    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.cpfError).toBeTruthy();
    expect(io.posted()).toHaveLength(0);
  });

  it('fails with the provider NAMED when nothing can tokenize for it', async () => {
    stubFetch();
    vi.mocked(tokenizerFor).mockReturnValue(null);
    const { result } = renderHook(usingOptions(options({ provider: 'novoprovedor' })));
    fillIn(result);

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.state).toEqual({
      kind: 'failed',
      reason: 'copy:no-tokenizer for novoprovedor',
    });
  });

  it('does not charge when the store has no key — an unencrypted card is not a charge', async () => {
    const io = stubFetch({ publicKey: null });
    // Deliberately NOT stubbed: this is the real tokenizer refusing.
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(io.calls.length).toBeGreaterThan(0));
    fillIn(result);

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.state.kind).toBe('failed');
    // A mock token that "passed" would switch on a store that cannot charge.
    expect(io.posted()).toHaveLength(0);
  });
});

describe('useActivationCharge — the charge', () => {
  it('sends the TOKEN and never the typed card', async () => {
    const io = stubFetch({ post: [{ ok: true, refunded: true }] });
    stubTokenizer();
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(io.calls.length).toBeGreaterThan(0));
    fillIn(result);

    await act(async () => {
      await result.current.submit();
    });

    const sent = io.posted()[0];
    expect(sent?.body).toEqual({
      token: 'ENCRYPTED',
      taxId: '11144477735',
      holderName: 'MARIA SOUZA',
      email: 'dona@loja.example',
    });
    expect(JSON.stringify(sent?.body)).not.toContain('4111');
    expect(JSON.stringify(sent?.body)).not.toContain('123');
  });

  it('passes only on the server’s own answer, and reports the refund', async () => {
    const io = stubFetch({ post: [{ ok: true, refunded: true }] });
    stubTokenizer();
    const onVerified = vi.fn();
    const { result } = renderHook(usingOptions(options({ onVerified })));
    await waitFor(() => expect(io.calls.length).toBeGreaterThan(0));
    fillIn(result);

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.state).toEqual({ kind: 'passed', refunded: true });
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('reports a charge that landed but was NOT refunded', async () => {
    const io = stubFetch({ post: [{ ok: true }] });
    stubTokenizer();
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(io.calls.length).toBeGreaterThan(0));
    fillIn(result);

    await act(async () => {
      await result.current.submit();
    });

    // The owner is owed the truth about their own cent.
    expect(result.current.state).toEqual({ kind: 'passed', refunded: false });
  });

  it('clears the card once it has served its purpose', async () => {
    const io = stubFetch({ post: [{ ok: true, refunded: true }] });
    stubTokenizer();
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(io.calls.length).toBeGreaterThan(0));
    fillIn(result);

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.card).toEqual({ number: '', holder: '', expiry: '', cvv: '' });
    expect(result.current.cpf).toBe('');
  });

  it('KEEPS the card typed in on a refusal, so one field can be fixed', async () => {
    const io = stubFetch({ post: [{ ok: false, reason: 'saldo insuficiente' }] });
    stubTokenizer();
    const onVerified = vi.fn();
    const { result } = renderHook(usingOptions(options({ onVerified })));
    await waitFor(() => expect(io.calls.length).toBeGreaterThan(0));
    fillIn(result);

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.card.number).toBe(GOOD_CARD.number);
    expect(result.current.state).toMatchObject({ kind: 'failed', reason: 'saldo insuficiente' });
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('carries the provider’s raw refusal alongside the reworded one', async () => {
    const io = stubFetch({
      post: [{ ok: false, reason: 'Cartão recusado', providerMessage: 'DECLINED_51' }],
    });
    stubTokenizer();
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(io.calls.length).toBeGreaterThan(0));
    fillIn(result);

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.state).toEqual({
      kind: 'failed',
      reason: 'Cartão recusado',
      providerMessage: 'DECLINED_51',
    });
  });

  it('falls back to the host’s sentence when the server sends no reason', async () => {
    const io = stubFetch({ post: [{ ok: false }] });
    stubTokenizer();
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(io.calls.length).toBeGreaterThan(0));
    fillIn(result);

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.state).toMatchObject({ kind: 'failed', reason: COPY.chargeFailed });
  });

  it('reports an unreachable server as its own failure, not a bad card', async () => {
    stubFetch();
    stubTokenizer();
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
    fillIn(result);
    vi.mocked(fetch).mockImplementation(async () => {
      throw new Error('offline');
    });

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.state).toMatchObject({ kind: 'failed', reason: COPY.unreachable });
  });
});

describe('useActivationCharge — trying again', () => {
  it('reset returns to the form and drops the stale validation messages', async () => {
    const io = stubFetch({ post: [{ ok: false, reason: 'recusado' }] });
    stubTokenizer();
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(io.calls.length).toBeGreaterThan(0));
    fillIn(result);

    await act(async () => {
      await result.current.submit();
    });
    act(() => {
      result.current.reset();
    });

    expect(result.current.state).toEqual({ kind: 'idle' });
    expect(result.current.fieldErrors).toEqual({});
    expect(result.current.cpfError).toBeUndefined();
  });
});

/** A second provider's endpoint, for the tests about moving between them. */
const OTHER_URL = '/api/admin/loja/payments/providers/infinitepay/verify-charge';

/** Render against a URL the test can change, as a provider switch would. */
function renderForUrl(url: string) {
  return renderHook(
    ({ verifyChargeUrl }: { verifyChargeUrl: string }) =>
      useActivationCharge(options({ verifyChargeUrl })),
    { initialProps: { verifyChargeUrl: url } },
  );
}

describe('useActivationCharge — what the charge will cost', () => {
  it('reports the amount the endpoint answers, rather than the cent everyone expects', async () => {
    // Not hypothetical: at least one provider refuses a one-cent total, so its
    // activation charge is worth R$ 1,01. A screen promising R$ 0,01 while
    // charging that is the kind of lie this whole flow exists to remove.
    stubFetch({ amountCents: 101 });
    const { result } = renderHook(usingOptions(options()));

    await waitFor(() => expect(result.current.amountCents).toBe(101));
  });

  it('asks ONCE for both the key and the amount', async () => {
    const io = stubFetch({ publicKey: 'PUBKEY', amountCents: 101 });
    stubTokenizer();
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(result.current.amountCents).toBe(101));

    fillIn(result);
    await act(async () => {
      await result.current.submit();
    });

    // One GET, and both facts came out of it — the amount on screen and the key
    // the card was encrypted with are the same endpoint's same answer.
    expect(io.calls.filter((call) => call.method === 'GET')).toHaveLength(1);
    expect(tokenizeCard).toHaveBeenCalledWith(
      expect.anything(),
      'PUBKEY',
      expect.anything(),
      expect.anything(),
    );
  });

  it('says nothing about the cost until the endpoint has answered', async () => {
    const gate: { release: () => void } = { release: () => undefined };
    const answered = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        await answered;
        return { ok: true, json: async () => ({ amountCents: 101 }) } as unknown as Response;
      }),
    );
    const { result } = renderHook(usingOptions(options()));

    // The gap is the point: a guess here would be shown, and then corrected.
    expect(result.current.amountCents).toBeNull();

    gate.release();
    await waitFor(() => expect(result.current.amountCents).toBe(101));
  });

  it('stays unknown when the host answers no amount at all', async () => {
    const io = stubFetch({ publicKey: 'ONLY-KEY', amountCents: null });
    stubTokenizer();
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(io.calls).toHaveLength(1));

    fillIn(result);
    await act(async () => {
      await result.current.submit();
    });

    // The body WAS read — its key reached the tokenizer — so the null is the
    // host's answer, not a request that failed.
    expect(tokenizeCard).toHaveBeenCalledWith(
      expect.anything(),
      'ONLY-KEY',
      expect.anything(),
      expect.anything(),
    );
    expect(result.current.amountCents).toBeNull();
  });

  it('ignores an amount that is not a number', async () => {
    const io = stubFetch({ publicKey: 'ONLY-KEY', amountCents: '101' as unknown as number });
    stubTokenizer();
    const { result } = renderHook(usingOptions(options()));
    await waitFor(() => expect(io.calls).toHaveLength(1));

    fillIn(result);
    await act(async () => {
      await result.current.submit();
    });

    // Read through the SAME body that carried the key, so the null is the
    // guard's doing rather than an answer that had not arrived yet.
    expect(tokenizeCard).toHaveBeenCalledWith(
      expect.anything(),
      'ONLY-KEY',
      expect.anything(),
      expect.anything(),
    );
    expect(result.current.amountCents).toBeNull();
  });
});

describe('useActivationCharge — moving between providers', () => {
  it('forgets the previous provider’s answers the moment the URL changes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        // The second provider's endpoint never answers. What the hook reports
        // in that gap is the whole question.
        if (String(input) !== URL_UNDER_TEST) return new Promise<Response>(() => undefined);
        return {
          ok: true,
          json: async () => ({ publicKey: 'PAGBANK-KEY', amountCents: 101 }),
        } as unknown as Response;
      }),
    );
    const view = renderForUrl(URL_UNDER_TEST);
    await waitFor(() => expect(view.result.current.amountCents).toBe(101));

    view.rerender({ verifyChargeUrl: OTHER_URL });

    // The cost is unknown again rather than the last provider's.
    expect(view.result.current.amountCents).toBeNull();

    // And so is the key — which matters more: encrypting the card with one
    // vendor's key and sending the blob to another arrives as the SECOND
    // provider's refusal, reading exactly like a bad card.
    fillIn(view.result);
    await act(async () => {
      await view.result.current.submit();
    });
    expect(view.result.current.state).toMatchObject({ kind: 'failed' });
    expect(tokenizeCard).not.toHaveBeenCalledWith(
      expect.anything(),
      'PAGBANK-KEY',
      expect.anything(),
      expect.anything(),
    );
  });
});
