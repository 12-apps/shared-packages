// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActivationChargeCopy } from '../charge-copy';
import { useActivationCharge } from '../use-activation-charge';

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

/** Records every ask; answers the key GET and a queue of POST bodies. */
function stubFetch(answers: { publicKey?: string | null; post?: unknown[] } = {}) {
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
      const payload =
        method === 'GET'
          ? { publicKey }
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
