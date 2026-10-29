// @vitest-environment jsdom
import { cleanup, render, screen } from './settings-test-utils';
import { afterEach, describe, expect, it } from 'vitest';

import { ProbeChecklist, type VerifyProbe } from '../components/CredentialFormAlerts';

/**
 * What "Testar conexão" reports, credential by credential (FUT-796).
 *
 * One boolean over a four-field form told an owner their Stripe connection was
 * fine when only the secret key had been checked. The publishable key and the
 * signing secret failed later — at a buyer's card, and at a payment that never
 * confirmed — where neither looks like a credential problem.
 */

function probeWith(checks: VerifyProbe['checks'], ok = true): VerifyProbe {
  return { environment: 'PRODUCTION', ok, checks } as VerifyProbe;
}

const CHECKS = [
  { key: 'secretKey', status: 'PASS' as const, message: 'Responde pela conta acct_1.' },
  { key: 'publishableKey', status: 'FAIL' as const, message: 'A chave publicável é de teste.' },
  {
    key: 'webhookSecret',
    status: 'UNCHECKED' as const,
    message: 'A Stripe não oferece como conferir se o segredo é o correto.',
  },
];

afterEach(cleanup);

describe('the probe checklist', () => {
  it('reports every credential it was given, each with its own verdict', () => {
    render(<ProbeChecklist probe={probeWith(CHECKS)} />);

    expect(screen.getByTestId('payments-probe-check-secretKey').dataset['status']).toBe('PASS');
    expect(screen.getByTestId('payments-probe-check-publishableKey').dataset['status']).toBe('FAIL');
    expect(screen.getByTestId('payments-probe-check-webhookSecret').dataset['status']).toBe(
      'UNCHECKED',
    );
  });

  /**
   * The case the component exists for. A green probe is exactly when an owner
   * stops looking — so it is exactly when they need to be told which
   * credentials it did not, and could not, check.
   */
  it('is shown on a PASSING probe, not only on a failure', () => {
    render(
      <ProbeChecklist
        probe={probeWith(
          [
            CHECKS[0]!,
            { ...CHECKS[2]! },
          ],
          true,
        )}
      />,
    );

    expect(screen.getByTestId('payments-probe-checks')).toBeTruthy();
    expect(screen.getByText(/não oferece como conferir/i)).toBeTruthy();
  });

  /**
   * A tick, a cross and a dash differ only by glyph and colour. The state has
   * to survive both being unable to see the colour and not knowing what a dash
   * is supposed to mean.
   */
  it('names each verdict in text, not by colour alone', () => {
    render(<ProbeChecklist probe={probeWith(CHECKS)} />);

    const unchecked = screen.getByTestId('payments-probe-check-webhookSecret');
    expect(unchecked.textContent).toContain('Não verificável');
    expect(screen.getByTestId('payments-probe-check-publishableKey').textContent).toContain(
      'Corrigir',
    );
  });

  /**
   * Additive, so an adapter with one thing to check keeps answering with `ok`
   * alone and its screen is unchanged — InfinitePay, Stone and PagBank all
   * still do.
   */
  it('renders nothing for an adapter that reports no findings', () => {
    const { container } = render(<ProbeChecklist probe={probeWith(undefined)} />);

    expect(container.firstChild).toBeNull();
  });
});

/**
 * The verdict's name, read aloud and kept off screen, takes one pixel (FUT-4144).
 *
 * MUI's `sx` reads `width: 1` as 100%, so the "hidden" label was an absolutely
 * positioned box as wide as its container. It widened the settings page by the
 * card's inset at every width — a sideways scroll at 320 on any probe that left
 * a check the form could not place at a box (FUT-4144 run gate).
 */
describe('the off-screen verdict name', () => {
  it('is one pixel square, not as wide as its container', () => {
    render(<ProbeChecklist probe={probeWith(CHECKS)} />);
    const row = screen.getByTestId('payments-probe-check-webhookSecret');
    const hidden = [...row.querySelectorAll('span')].find((span) => getComputedStyle(span).position === 'absolute');
    if (!hidden) throw new Error('no off-screen verdict name');
    expect(getComputedStyle(hidden).width).toBe('1px');
    expect(getComputedStyle(hidden).height).toBe('1px');
  });
});
