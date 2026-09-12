/**
 * WHETHER AN ALERT INTERRUPTS.
 *
 * `role` and `aria-live` are two attributes with one meaning between them, and
 * before `announce` they were free to contradict each other. Every alert gets
 * `role="alert"` from `ALERT_DEFAULTS` whatever its variant, and `role="alert"`
 * is IMPLICITLY an assertive live region — so an `info` alert shipped
 * `aria-live="polite"` and `role="alert"` together, and assistive tech that
 * honours the implicit role interrupts regardless of the explicit attribute.
 *
 * The cases below are the four the pairing has to get right, plus the two
 * escape hatches, plus the one that matters most for a change to a component
 * with hundreds of call sites: SILENCE STILL MEANS WHAT IT MEANT. An alert that
 * names none of the three renders exactly what it rendered before.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { Alert } from '../Alert';
import { resolveAnnouncement } from '../Alert.helpers';

const alertRoot = (ui: React.ReactElement): HTMLElement =>
  render(ui).getByTestId('alert');

describe('Given an alert that says nothing about how it announces', () => {
  it('then an info alert keeps the role and live setting it always had', () => {
    const root = alertRoot(<Alert variant="info" title="Olá" data-testid="alert" />);

    expect(root).toHaveAttribute('role', 'alert');
    expect(root).toHaveAttribute('aria-live', 'polite');
  });

  it('then a danger alert still derives assertive from its variant', () => {
    const root = alertRoot(<Alert variant="danger" title="Erro" data-testid="alert" />);

    expect(root).toHaveAttribute('role', 'alert');
    expect(root).toHaveAttribute('aria-live', 'assertive');
  });
});

describe('Given an alert that asks to announce politely', () => {
  it('then it is a status region, which is implicitly polite', () => {
    const root = alertRoot(
      <Alert variant="info" announce="polite" title="Mais 1 pessoa está aqui" data-testid="alert" />,
    );

    // `status`, not `alert` — this is the entire point. A polite `aria-live`
    // under `role="alert"` is contradicted by the role's own implicit setting.
    expect(root).toHaveAttribute('role', 'status');
    expect(root).toHaveAttribute('aria-live', 'polite');
  });

  it('then the prop itself does not reach the DOM', () => {
    const root = alertRoot(
      <Alert variant="info" announce="polite" title="Olá" data-testid="alert" />,
    );

    expect(root.getAttributeNames()).not.toContain('announce');
  });
});

describe('Given an alert that asks to interrupt', () => {
  it('then it is an alert region in both attributes', () => {
    const root = alertRoot(
      <Alert variant="info" announce="assertive" title="Pare" data-testid="alert" />,
    );

    expect(root).toHaveAttribute('role', 'alert');
    expect(root).toHaveAttribute('aria-live', 'assertive');
  });
});

describe('Given a call site that already spells the attributes by hand', () => {
  it('then an explicit role wins over announce', () => {
    const root = alertRoot(
      <Alert variant="info" announce="polite" role="alert" title="Olá" data-testid="alert" />,
    );

    expect(root).toHaveAttribute('role', 'alert');
  });

  it('then an explicit aria-live wins over announce', () => {
    const root = alertRoot(
      <Alert variant="info" announce="polite" aria-live="off" title="Olá" data-testid="alert" />,
    );

    expect(root).toHaveAttribute('aria-live', 'off');
  });
});

describe('Given resolveAnnouncement on its own', () => {
  it('then it answers the same four pairings the rendered alert does', () => {
    expect(resolveAnnouncement({}, 'info')).toEqual({ role: 'alert', 'aria-live': 'polite' });
    expect(resolveAnnouncement({}, 'danger')).toEqual({ role: 'alert', 'aria-live': 'assertive' });
    expect(resolveAnnouncement({ announce: 'polite' }, 'info')).toEqual({
      role: 'status',
      'aria-live': 'polite',
    });
    expect(resolveAnnouncement({ announce: 'assertive' }, 'info')).toEqual({
      role: 'alert',
      'aria-live': 'assertive',
    });
  });

  it('then a variant cannot override an announce that was asked for', () => {
    // `danger` derives assertive on its own; asking for polite has to beat it,
    // or "quieten this one alert" is unexpressible for exactly the variant
    // most likely to need it turned down.
    expect(resolveAnnouncement({ announce: 'polite' }, 'danger')).toEqual({
      role: 'status',
      'aria-live': 'polite',
    });
  });
});
