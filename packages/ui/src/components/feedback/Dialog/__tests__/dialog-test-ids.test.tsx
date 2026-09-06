/**
 * ONE TEST ID, THREE SPELLINGS — on the WEB half of `Dialog`.
 *
 * `Dialog.base.ts` puts `testID` in the contract both renderers honour, so
 * `<Dialog testID="x">` type-checks on the web too. Before this it type-checked
 * and did nothing useful: the id was never read, and the raw prop rode the rest
 * spread onto the modal root, the content and the action bar as an invalid
 * `testid` attribute that React warns about. `DialogHeader`, which has no rest
 * spread at all, dropped it silently.
 *
 * The RULE, which `slotTestId` in `src/platform/test-id.ts` now states once for
 * both renderers: a raw `data-testid`/`testID` on a slot names THAT element and
 * is taken verbatim; `dataTestId` names the DIALOG and the slot derives
 * `-title`/`-content`/`-actions` from it.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Dialog, DialogActions, DialogContent, DialogHeader } from '../index';

afterEach(cleanup);

describe('Dialog test ids (web)', () => {
  it('honours testID, dataTestId and data-testid on the paper', () => {
    const { unmount } = render(
      <Dialog open testID="native" title="T">
        body
      </Dialog>,
    );
    expect(screen.getByTestId('native')).toBeInTheDocument();
    unmount();

    render(
      <Dialog open dataTestId="house" title="T">
        body
      </Dialog>,
    );
    expect(screen.getByTestId('house')).toBeInTheDocument();
  });

  it('never leaks testID onto the DOM as an attribute', () => {
    render(
      <Dialog open testID="d" title="T">
        <DialogContent testID="dc">body</DialogContent>
        <DialogActions testID="da">go</DialogActions>
      </Dialog>,
    );

    expect(screen.getByTestId('d')).not.toHaveAttribute('testid');
    expect(screen.getByTestId('dc')).not.toHaveAttribute('testid');
    expect(screen.getByTestId('da')).not.toHaveAttribute('testid');
    expect(document.querySelectorAll('[testid]')).toHaveLength(0);
  });

  it('gives a bare header the id its own testID asks for', () => {
    render(<DialogHeader testID="dh" title="T" />);
    expect(screen.getByTestId('dh')).toHaveTextContent('T');
    expect(screen.getByTestId('dh')).not.toHaveAttribute('testid');
  });

  it('derives the title, close, content and action ids from the dialog id', () => {
    render(
      <Dialog open dataTestId="d" title="T" onClose={() => undefined}>
        <DialogContent dataTestId="d">body</DialogContent>
        <DialogActions dataTestId="d">go</DialogActions>
      </Dialog>,
    );

    for (const id of ['d', 'd-title', 'd-close', 'd-content', 'd-actions']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('keeps the unnamed defaults every existing query relies on', () => {
    render(
      <Dialog open title="T" onClose={() => undefined}>
        <DialogContent>body</DialogContent>
        <DialogActions>go</DialogActions>
      </Dialog>,
    );

    for (const id of ['dialog', 'dialog-title', 'dialog-close', 'dialog-content', 'dialog-actions']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });
});
