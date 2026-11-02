/**
 * FUT-3831: the dialog lays out for a phone by the space it is GIVEN — a
 * container query on its `.MuiDialog-container` — never by the viewport. The
 * layout itself is measured in a real browser
 * (`ConfirmAction.test.stories.tsx`, "At 320 …"); jsdom cannot resolve a
 * container query, so here the rules are read from the styles emitted.
 */
import { createTheme } from '@mui/material/styles/index.js';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AlertDialog } from '../AlertDialog';
import { ALERT_DIALOG_CONTAINER, ALERT_DIALOG_NARROW_BELOW, narrowDialog } from '../AlertDialog.parts';

afterEach(cleanup);

/** Every rule emotion has written into the document. */
function emittedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
}

/**
 * The declarations the narrow container query gives `el` itself (its own
 * classes, or `> child` of them). Emotion keeps every sheet it ever wrote, so
 * a rule is matched to the element's own classes, never to the document.
 */
function narrowRulesFor(el: HTMLElement): string {
  const blocks = emittedCss().match(/@container alert-dialog \(width < [\d.]+rem\)\{.*\}\}/g) ?? [];
  return blocks
    .filter((block) => Array.from(el.classList).some((cls) => cls.startsWith('css-') && block.includes(`.${cls}`)))
    .join('\n');
}

function renderDialog(icon?: null): void {
  render(
    <AlertDialog
      open
      variant="destructive"
      title="Encerrar o turno de Cláudia Rangel?"
      confirmText="Encerrar"
      cancelText="Cancelar"
      icon={icon}
      data-testid="ask"
    />,
  );
}

describe('AlertDialog on a narrow container', () => {
  it('reads a named container query, never a media query', () => {
    const query = narrowDialog(createTheme());
    expect(query.startsWith(`@container ${ALERT_DIALOG_CONTAINER} (width <`)).toBe(true);
    expect(query).not.toContain('@media');
    expect(ALERT_DIALOG_NARROW_BELOW).toBe(480);
  });

  it('makes the dialog container the query container and moves the icon above the title', () => {
    renderDialog();
    const css = emittedCss();
    expect(css).toContain(`container-name:${ALERT_DIALOG_CONTAINER}`);
    expect(narrowRulesFor(screen.getByTestId('ask-title'))).toContain('flex-direction:column');
    expect(screen.getByTestId('ask-icon')).toHaveAttribute('data-alert-icon');
  });

  it('grows the buttons so a stacked pair spans the row, Cancel first in the tab order', () => {
    renderDialog();
    expect(narrowRulesFor(screen.getByTestId('ask-actions'))).toMatch(/>\.MuiButton-root\{[^}]*flex-grow:1/);
    const order = Array.from(screen.getByTestId('ask-actions').children).map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual(['ask-cancel-button', 'ask-confirm-button']);
  });

  it('keeps the close button clearance on a title without an icon', () => {
    renderDialog(null);
    // The title alone, no icon beside or above it.
    expect(screen.getByTestId('ask-title').children).toHaveLength(1);
    expect(narrowRulesFor(screen.getByTestId('ask-title'))).toBe('');
  });
});
