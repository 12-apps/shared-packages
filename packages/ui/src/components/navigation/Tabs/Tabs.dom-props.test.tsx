/**
 * TABS DOES NOT WRITE ITS OWN PROPS ONTO THE DOM (12-86).
 *
 * `Tabs` forms `rest` by destructuring nine props out of the resolved set and
 * spreading whatever is left onto `StyledTabs` — and the comment above that
 * destructuring says exactly why ("Destructured only to keep it OUT of `rest`,
 * which is spread onto the DOM node"). The list was incomplete: every other
 * key of `TABS_DEFAULTS` stayed in `rest`, reached MUI's `Tabs`, and landed on
 * the DOM node, because `StyledTabs`'s `shouldForwardProp` filters only
 * `customVariant`, `size` and `showDividers`.
 *
 * React reports each one, so a storefront cardápio — which renders this
 * component for its category strip — logged a run of warnings on every load,
 * and every jsdom test that mounted the page printed them too. **Measured at
 * eight** on a bare `<Tabs items value onChange closeTabLabel />`, reading the
 * prop name out of React's own `console.error` arguments rather than off a
 * console by eye:
 *
 *   `React does not recognize the … prop`  — fullWidth, stickyOffset,
 *                                            animateContent, animationDuration,
 *                                            persistContent
 *   `Received false for a non-boolean …`   — scrollable, sticky, loading
 *
 * The ticket said six and named them by eye. It undercounted, and `fullWidth`
 * and `scrollable` were not on its list at all — which is the argument for
 * asserting the console rather than a list of names.
 *
 * All eight are THIS component's. The ticket attributed the `loading` one to
 * `Button`, which is wrong and worth recording so nobody re-opens that file:
 * `Button` destructures `loading` out of its own `others`, never passes it to
 * `StyledButton`, and filters it in `shouldForwardProp` besides. `loading` is
 * in `TABS_DEFAULTS` too, and that is where the warning came from.
 *
 * ## Why this asserts the CONSOLE and not the markup
 *
 * A leaked prop is not always visible in the DOM — React drops the ones it
 * decides are invalid rather than writing them — so asserting on attributes
 * would pass while the warning still fired. The warning IS the defect, so the
 * warning is what is asserted, and the matcher is a whitelist of nothing: any
 * unknown-prop or non-boolean-attribute complaint fails it, not just today's
 * eight. A prop added to `TabsProps` tomorrow is caught with no edit here,
 * which is precisely the failure mode that produced these.
 *
 * ## Why there is exactly ONE warning assertion
 *
 * **React warns once per prop name per component type, for the life of the
 * module.** A second test that renders `Tabs` again — with the same props set
 * explicitly, say — cannot re-raise them, so it passes whether the component
 * is fixed or not. This file had such a test; it passed against the UNFIXED
 * component, which is how it was caught. It is gone rather than reworded: a
 * test that cannot fail is worse than no test, because it is counted.
 *
 * The two tests below it are not duplicates of that mistake — they assert
 * behaviour (`aria-label` forwarding, a handler firing), not absence.
 */
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Tabs } from './Tabs';

const ITEMS = [
  { id: 'one', label: 'One', content: <p>first</p> },
  { id: 'two', label: 'Two', content: <p>second</p> },
];

/** React's two spellings for a prop that should never have reached the DOM. */
const DOM_PROP_COMPLAINT = /does not recognize the|non-boolean attribute|Invalid DOM property/i;

/** Collect everything React writes to console.error while `run` renders. */
function warningsDuring(run: () => void): string[] {
  const seen: string[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    // React formats with %s placeholders, so the prop name is an ARGUMENT and
    // joining is what makes the message greppable at all.
    seen.push(args.map(String).join(' '));
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return seen;
}

afterEach(cleanup);

describe('Tabs keeps its own props off the DOM', () => {
  it('renders the default strip without a single unknown-prop warning', () => {
    const warnings = warningsDuring(() => {
      render(<Tabs items={ITEMS} value="one" onChange={() => {}} closeTabLabel="Close" />);
    });

    expect(warnings.filter((w) => DOM_PROP_COMPLAINT.test(w))).toEqual([]);
  });

  it('still forwards genuine DOM passthrough, which is what `rest` is for', () => {
    // The fix must not throw the baby out: an aria attribute a host sets is not
    // a Tabs prop and has to keep reaching the element. Queried by ROLE, not by
    // the `tabs-list` test id — MUI puts `aria-label` on the inner tablist div,
    // not on the root that carries the id, and asserting the root instead is
    // how this test first failed against a component that was forwarding fine.
    const { getByRole } = render(
      <Tabs items={ITEMS} value="one" onChange={() => {}} closeTabLabel="Close" aria-label="Categories" />,
    );

    expect(getByRole('tablist')).toHaveAttribute('aria-label', 'Categories');
  });

  it('forwards a handler the component does not own, which is the same path', () => {
    // `onMouseDown` is not a `TabsProps` key, so it travels the same `rest`
    // route `OWN_PROPS` filters — this is that route's behavioural half.
    //
    // It is deliberately NOT a focus test. `onFocus`/`onBlur` are the handlers
    // the omission list most conspicuously spares, so they were the obvious
    // subject; but the flakiness lane flags any call whose method is `focus`,
    // `fireEvent.focus` included, and exempts only a `waitFor` parent. Three
    // shapes were tried — bare, `act`-wrapped, `waitFor`-wrapped — and all
    // three failed it. The lane is right and the instrument was wrong: focus
    // timing has nothing to do with whether a prop reaches an element, and a
    // non-focus handler proves the same property with none of it.
    const onMouseDown = vi.fn();
    const { getByRole } = render(
      <Tabs
        items={ITEMS}
        value="one"
        onChange={() => {}}
        closeTabLabel="Close"
        onMouseDown={onMouseDown}
      />,
    );

    fireEvent.mouseDown(getByRole('tablist'));

    expect(onMouseDown).toHaveBeenCalled();
  });
});
