// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ConfirmDialog } from '../lib/confirm-dialog';

/**
 * FUT-755 — what the reports area restates about MUI's dialog, pinned.
 *
 * `visual-pass.md` §Components asks for one button case and one radius family;
 * §Type asks for a scale in which the page title is the largest thing on the
 * screen. This dialog broke all three by default: uppercase `CANCELAR`, a 50%
 * close control, and a 20px `h6` title above an 18px report name.
 *
 * The restatement lives in one `sx` object, and jsdom will not cascade it — an
 * emotion class is injected but not applied, so `getComputedStyle` here proves
 * nothing about px. What it CAN prove is the DOM shape the title rule depends
 * on: `AlertDialog` paints the words in a `MuiTypography-h6` span nested inside
 * the `MuiDialogTitle-root` heading, and that span's own 20px beats anything
 * inherited. Flatten that nesting and the descendant half of the rule stops
 * matching, silently, with the title back at 20px. Measured in a browser at
 * 1440px it is 18px.
 */

afterEach(cleanup);

function renderDialog(): void {
  render(
    <ConfirmDialog
      open
      destructive
      title="Remover bloco?"
      description="O bloco sai do relatório."
      confirmText="Remover"
      cancelText="Cancelar"
      onConfirm={() => undefined}
      onCancel={() => undefined}
      dataTestId="confirm"
    />,
  );
}

describe('ConfirmDialog — the title is a section heading, not a page title', () => {
  it('paints the question in a Typography nested inside the title', () => {
    renderDialog();

    const title = document.querySelector('.MuiDialogTitle-root');
    expect(title).toBeTruthy();

    // The element the descendant half of the rule exists for. Its own class
    // sets 20px, so sizing the heading alone would leave the words at 20 —
    // which is why both selectors are written, and why this shape is pinned.
    const typography = title?.querySelector('.MuiTypography-root');
    expect(typography?.textContent).toBe('Remover bloco?');
  });
});

describe('ConfirmDialog — one button case', () => {
  it('names both actions in sentence case', () => {
    renderDialog();

    // The strings themselves, because `text-transform` is a paint-time change
    // jsdom does not perform: MUI's uppercase would leave these unchanged in
    // the DOM. The case that ships is a browser check; the case that is
    // WRITTEN is this.
    expect(screen.getByRole('button', { name: 'Remover' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });
});
