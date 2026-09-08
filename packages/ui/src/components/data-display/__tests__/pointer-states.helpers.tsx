/**
 * Shared by `Alert`'s and `Banner`'s pointer-state guards.
 *
 * The two live in separate FILES on purpose. Emotion emits its rules under its
 * own hash — an element carries `css-10q5rg1-MuiPaper-root-MuiAlert-root`
 * while the rule is written as `.css-1q9rkac:focus-visible` — so a guard
 * cannot find "this element's rules" by reading its className, and a file that
 * renders two components can only ask the sheet a question one of them
 * answers. Vitest gives each FILE its own jsdom, so one component per file
 * makes the whole sheet that component's.
 *
 * Emotion also keeps its own record of what it has inserted, so clearing
 * `document.head` between cases does NOT make it re-emit: the sheet comes back
 * empty and every assertion over it passes vacuously. That is how the first
 * draft of this guard shipped cases that stayed green with the defect
 * restored. Nothing here clears it.
 */
import type { JSX } from 'react';
import { expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { ThemeProvider, createTheme } from '../../../mui/styles';

/** Every rule Emotion has injected in this file's jsdom. */
const emittedCss = (): string =>
  Array.from(document.querySelectorAll('style'))
    .map((el) => el.textContent ?? '')
    .join('\n');

/**
 * The declarations inside each block whose selector carries `pseudo`.
 *
 * Written as a split rather than an index walk because the flakiness lane
 * rejects reassigning a binding from inside a loop — `no-global-state-mutation`
 * — and that lane runs only in CI, so the walk this replaced was green on a
 * laptop and red on the runner.
 */
export const blocksFor = (css: string, pseudo: string): string[] =>
  css
    .split('}')
    .filter((chunk) => chunk.includes(pseudo) && chunk.includes('{'))
    .map((chunk) => chunk.slice(chunk.indexOf('{') + 1));

/**
 * The three claims both surfaces make about a pointer.
 *
 * `Alert` and `Banner` are the same kind of thing — a message you read, not a
 * control you operate — and both answered a mouse with a keyboard's
 * affordance: `tabIndex={0}` plus a `:focus-within` ring meant a plain CLICK
 * painted a focus outline, which reads as an error state rather than as "you
 * clicked something" (FUT-1458).
 *
 * jsdom resolves neither `:focus-visible` nor an Emotion pseudo-class through
 * `getComputedStyle`, so there is no rendered ring to measure here — that
 * measurement belongs in a browser and was made in one. What a unit test can
 * hold is the RULE: the ring is attached to the keyboard-only selector, and no
 * pointer state moves the element. Both flip the moment someone restores
 * `:focus-within` or a `transform`, which is the whole job.
 */
export function itAnswersAPointerLikeASurface(
  variants: readonly string[],
  mount: (variant: string) => JSX.Element,
): void {
  /**
   * Every mount, so the sheet holds every variant's rules.
   *
   * Rendering one variant is what made the first version of the "moves
   * nothing" case unfailable: a variant that declares its own `'&:hover'` is
   * never SERIALISED unless something renders it, and `alertVariantStyles` is
   * spread after the root's hover, so such a key replaces the shared block
   * rather than merging into it. `gradient` did exactly that, and re-adding a
   * `transform` to it left this file green.
   *
   * The list is the CALLER's because the two surfaces do not share one:
   * `glass` and `gradient` are Alert's alone, and a Banner asked for either
   * resolves no palette and throws.
   */
  const cssAfterMount = (): string => {
    for (const variant of variants) {
      render(<ThemeProvider theme={createTheme()}>{mount(variant)}</ThemeProvider>);
    }
    return emittedCss();
  };

  it('attaches its focus ring to :focus-visible', () => {
    expect(blocksFor(cssAfterMount(), ':focus-visible').join('\n')).toContain('outline');
  });

  it('attaches no ring to :focus-within, which a mouse click would satisfy', () => {
    expect(blocksFor(cssAfterMount(), ':focus-within').join('\n')).not.toContain('outline');
  });

  it('moves nothing while hovered or pressed', () => {
    const css = cssAfterMount();

    for (const state of [':hover', ':active']) {
      const moved = blocksFor(css, state).filter((block) => /transform\s*:/.test(block));
      expect({ state, moved }).toEqual({ state, moved: [] });
    }
  });

  /**
   * The one-token edit that already shipped once on this branch.
   *
   * The root declares `opacity <ACTIVE.ms>` alongside its `all 0.3s`. A bare
   * `transition` shorthand inside a pointer block outranks it — `.css-x:hover`
   * is (0,2,0) against the root's (0,1,0) — and a mouse `:active` ALWAYS
   * implies `:hover`, so re-adding one silently cuts the press's fade back to
   * 300ms. That is the whole mechanism the press is built on, it was invisible
   * to all 1530 tests, and until this case existed the only thing defending it
   * was a comment asking the next editor not to.
   */
  it('declares no transition on a pointer state, which would outrank the root', () => {
    const css = cssAfterMount();

    for (const state of [':hover', ':focus-visible']) {
      const timed = blocksFor(css, state).filter((block) => /transition\s*:/.test(block));
      expect({ state, timed }).toEqual({ state, timed: [] });
    }
  });

  /**
   * A surface that answers a pointer with NOTHING passes every case above.
   *
   * Banner shipped exactly that — measured ΔE76 0.00 on every variant, in both
   * modes — and the guard forbade movement without ever requiring feedback, so
   * deleting the states again would have stayed green.
   */
  it('answers a hover with a tint layer rather than with nothing', () => {
    // An INSET shadow, which is the tint spread edge to edge. Asserting the
    // mechanism and not merely "some declaration" is deliberate: the tint is
    // additive, and that is the whole reason it replaced a `brightness()`
    // multiplier — which did nothing to a near-black `glass` in dark mode or
    // to Banner's 10%-alpha wash.
    expect(blocksFor(cssAfterMount(), ':hover').join('\n')).toMatch(/box-shadow\s*:[^;]*inset/);
  });
}
