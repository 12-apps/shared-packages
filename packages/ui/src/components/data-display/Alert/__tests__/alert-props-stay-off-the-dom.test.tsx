/**
 * ALERT'S OWN PROPS MUST NOT REACH THE DOM.
 *
 * `AlertProps` extends MUI's `AlertProps`, so the rest-spread that carries a
 * host's real HTML attributes onto the root carries the alert's configuration
 * with it. `ALERT_ONLY_PROPS` is the denylist that stops it, and it exists
 * because two names escaped the destructure: `dismissButton` reads `closable`
 * and `closeLabel` off the ORIGINAL props to keep the dismiss union's narrowing
 * intact, so neither left through the destructure that catches every other
 * component prop.
 *
 * It fired on every alert rather than the closable ones, which is what made it
 * worth a guard: `ALERT_DEFAULTS` supplies `closable: false`, so a host that
 * never mentioned the prop still shipped it to the DOM and still logged
 * "Received `false` for a non-boolean attribute `closable`".
 *
 * ## Why this reads the DOM rather than spying on the warning
 *
 * React de-duplicates that warning by prop name, so a `console.error` spy is
 * consumed by the first render in the file and passes for every later one —
 * the same inert guard the DataGrid suite documents. `closeLabel` avoids the
 * problem entirely: it is a STRING, and React writes an unknown string prop
 * onto the element (lowercased), so its presence is an observable fact rather
 * than a message. The boolean `closable` React drops either way, which is
 * exactly why it needs a neighbour that does not.
 */
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { Alert, ALERT_ONLY_PROPS } from '../Alert';
import type { AlertProps } from '../Alert.types';

/** `class`, `style`, `id`, `role`, and any `aria-*` / `data-*` are legitimate. */
const ALLOWED = /^(class|style|id|role|title|tabindex|aria-[a-z-]+|data-[a-z-]+)$/;

const leakedAttributes = (root: HTMLElement): string[] =>
  root.getAttributeNames().filter((name) => !ALLOWED.test(name));

/**
 * Every alert-only prop, as one object so the case below can assert it still
 * COVERS the denylist — add a name to `ALERT_ONLY_PROPS` and forget it here and
 * that assertion fails, which is the hole a hand-written JSX list would leave.
 */
const ALERT_CONFIG = {
  closable: true,
  closeLabel: 'Fechar o aviso',
} satisfies Partial<AlertProps>;

describe('Given an alert carrying every name on the denylist, when it renders', () => {
  it('then the config below still covers the denylist', () => {
    const covered = new Set<string>(Object.keys(ALERT_CONFIG));
    expect(ALERT_ONLY_PROPS.filter((prop) => !covered.has(prop))).toEqual([]);
  });

  it('then the root carries no attribute that is not a real DOM attribute', () => {
    const { getByTestId } = render(
      <Alert {...ALERT_CONFIG} title="Atenção" data-testid="alert" />,
    );

    expect(leakedAttributes(getByTestId('alert'))).toEqual([]);
  });

  it('then closeLabel names the dismiss button instead of the root element', () => {
    const { getByTestId } = render(
      <Alert {...ALERT_CONFIG} title="Atenção" data-testid="alert" />,
    );

    // The label BELONGS in the DOM — it is the dismiss button's only accessible
    // name. What it must not be is an attribute of the alert itself. React
    // lowercases an unknown prop on its way to the element, so the name to look
    // for on the root is `closelabel`, not the camelCase one.
    const root = getByTestId('alert');
    expect(root.hasAttribute('closelabel')).toBe(false);
    expect(getByTestId('alert-close')).toHaveAttribute('aria-label', 'Fechar o aviso');
  });
});

describe('Given an alert that is not closable, when it renders', () => {
  it('then the defaulted closable does not reach the root either', () => {
    // The case the defect actually shipped on: nothing here mentions the
    // dismiss union, and `ALERT_DEFAULTS` supplies `closable: false` anyway.
    const { getByTestId } = render(<Alert title="Atenção" data-testid="alert" />);

    const root = getByTestId('alert');
    expect(root.hasAttribute('closable')).toBe(false);
    expect(leakedAttributes(root)).toEqual([]);
  });
});
