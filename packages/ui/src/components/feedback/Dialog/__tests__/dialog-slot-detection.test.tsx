/**
 * A `DialogContent`/`DialogActions` reaches the paper as the paper's own child,
 * however the consumer wrapped it.
 *
 * `Dialog` gives raw children comfortable padding, and skips it for a consumer
 * that passes the spacing slots and manages its own. That decision used to be
 * made by comparing each child's ELEMENT TYPE against `DialogContent` /
 * `DialogActions` — which answers a question one level too shallow. A component
 * that RENDERS a slot is not that slot, so the padded box went in anyway and:
 *
 *  - the slot's own 24px landed INSIDE the wrapper's 24px, indenting the body
 *    by 48px;
 *  - the wrapper became the paper's only flex child, so a `DialogActions`
 *    stopped being a sibling of the scrolling `DialogContent`. MUI's
 *    `scroll="paper"` makes the paper a flex column with `overflow-y: auto`, so
 *    the whole dialog scrolled and took the action bar with it — a footer that
 *    should sit under the thumb ended up below the fold.
 *
 * The trap is that splitting a dialog's body or footer into its own component —
 * an ordinary refactor, and one the size gates actively push you toward —
 * silently changes the layout. Nothing at the call site says so, and on a short
 * dialog nothing looks wrong until the content grows.
 *
 * These cases pass a slot through a component boundary, which is exactly what a
 * type check cannot see.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { JSX } from 'react';

import { Dialog, DialogActions, DialogContent } from '../index';

afterEach(cleanup);

/** A body split into its own component — the shape the type check misses. */
function BodyComponent(): JSX.Element {
  return <DialogContent dataTestId="d">body</DialogContent>;
}

/** A footer split into its own component, likewise. */
function FooterComponent(): JSX.Element {
  return <DialogActions dataTestId="d">footer</DialogActions>;
}

const paper = (element: HTMLElement): HTMLElement | null =>
  element.closest('.MuiDialog-paper');

describe('Dialog slot detection', () => {
  /**
   * Body and footer are siblings IN THE PAPER'S COLUMN, whichever component
   * rendered them. This is the property an adopter's product sheet lost to
   * this, and being siblings is not enough on its own to have it: inside the padded
   * wrapper they were siblings too, one level below the column that gives the
   * body its bounded height. So the test follows them up to the paper and
   * insists nothing between generates a box.
   */
  it('leaves a component-rendered body and footer in the paper column', () => {
    render(
      <Dialog open dataTestId="d">
        <BodyComponent />
        <FooterComponent />
      </Dialog>,
    );

    const content = screen.getByTestId('d-content');
    const actions = screen.getByTestId('d-actions');
    expect(actions.parentElement).toBe(content.parentElement);
    expect(content.contains(actions)).toBe(false);

    for (
      let node = content.parentElement;
      node !== null && node !== paper(content);
      node = node.parentElement
    ) {
      expect(globalThis.getComputedStyle(node).display).toBe('contents');
    }
  });

  /**
   * A component boundary is the one case element-type detection cannot see
   * through, so the wrapper is still in the DOM — but it generates no box.
   * `display: contents` drops both things a wrapper does wrong here: its own
   * 24px on top of the slot's (the role-edit popup's doubled indent), and its
   * position between the paper's flex column and the slot.
   *
   * Asserted on `display`, not on `padding`: a box-less element still COMPUTES
   * padding, it simply never applies it. Reading the padding back would be
   * reading a number no layout uses.
   */
  it('gives a component-rendered body no box of its own', () => {
    render(
      <Dialog open dataTestId="d">
        <BodyComponent />
      </Dialog>,
    );

    const wrapper = screen.getByTestId('d-content').parentElement;
    expect(wrapper).not.toBe(paper(screen.getByTestId('d-content')));
    expect(globalThis.getComputedStyle(wrapper!).display).toBe('contents');
  });

  /** The footer half of the same rule. */
  it('gives a component-rendered footer no box of its own', () => {
    render(
      <Dialog open dataTestId="d">
        <FooterComponent />
      </Dialog>,
    );

    const wrapper = screen.getByTestId('d-actions').parentElement;
    expect(globalThis.getComputedStyle(wrapper!).display).toBe('contents');
  });

  /** A fragment is the other way a slot arrives without being the child. */
  it('sees through a fragment', () => {
    render(
      <Dialog open dataTestId="d">
        <>
          <DialogContent dataTestId="d">body</DialogContent>
          <DialogActions dataTestId="d">footer</DialogActions>
        </>
      </Dialog>,
    );

    const content = screen.getByTestId('d-content');
    expect(content.parentElement).toBe(paper(content));
  });

  /**
   * The other half of the contract, and the reason this is not simply "always
   * skip the padding": a dialog handed raw children still gets them padded.
   * `AppHeader.details` and an adopter's order-history sheet both rely on it.
   */
  it('still pads a body that is not a slot at all', () => {
    render(
      <Dialog open dataTestId="d">
        <div data-testid="raw">body</div>
      </Dialog>,
    );

    const wrapper = screen.getByTestId('raw').parentElement;
    expect(wrapper).not.toBe(paper(screen.getByTestId('raw')));
    expect(globalThis.getComputedStyle(wrapper!).paddingLeft).toBe('24px');
  });

  /** A component rendering something ordinary is raw children too. */
  it('pads a component that renders no slot', () => {
    function Plain(): JSX.Element {
      return <div data-testid="raw">body</div>;
    }
    render(
      <Dialog open dataTestId="d">
        <Plain />
      </Dialog>,
    );

    expect(globalThis.getComputedStyle(screen.getByTestId('raw').parentElement!).paddingLeft).toBe(
      '24px',
    );
  });
});
