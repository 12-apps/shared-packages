import TextField from '@mui/material/TextField/index.js';
import { ThemeProvider, createTheme } from '@mui/material/styles/index.js';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TextFieldSlim, type TextFieldSlimProps } from '../text-field-slim';

/**
 * `TextFieldSlim` is MUI's `TextField` with the select branch removed, and this
 * is how that claim is checked: by rendering BOTH and comparing the DOM.
 *
 * A hand-written transcription of someone else's composition rots in exactly one
 * way — quietly. Every case here would still pass if the two diverged on
 * appearance; what it pins is the part a screen reader and a stylesheet depend
 * on and a snapshot of our own would not question: the id wiring, the
 * `aria-describedby` that joins a helper text to its field, the label's `for`,
 * which props land on the ROOT rather than on the input, and the root's class.
 *
 * The real `TextField` is imported HERE and only here. A test file is not
 * shipped, so this costs a consumer nothing — which is the whole point of the
 * exercise it is verifying.
 */

const theme = createTheme();

/** The two, rendered from one set of props, normalised for comparison. */
function bothOf(props: TextFieldSlimProps): { slim: HTMLElement; mui: HTMLElement } {
  const slim = render(
    <ThemeProvider theme={theme}>
      <TextFieldSlim {...props} />
    </ThemeProvider>,
  ).container.firstElementChild as HTMLElement;

  const mui = render(
    <ThemeProvider theme={theme}>
      <TextField {...(props as React.ComponentProps<typeof TextField>)} />
    </ThemeProvider>,
  ).container.firstElementChild as HTMLElement;

  return { slim, mui };
}

/**
 * The shape of the tree, with the values that differ per render removed.
 *
 * Emotion's generated class names and React's generated ids differ between two
 * renders of the SAME component, so comparing them raw would fail on noise. Both
 * are replaced by a stable token, which keeps every structural fact — that an id
 * is present, that `aria-describedby` names the helper text's id, that the label
 * points at the input — while dropping the part that is allowed to differ.
 */
function shapeOf(root: HTMLElement, id: string): string {
  return root.outerHTML
    .replaceAll(id, '«id»')
    .replace(/\bcss-[a-z0-9-]+/g, '«css»')
    .replace(/\bmui-[0-9]+/g, '«id»')
    .replace(/«[^»]*»-(helper-text|label)/g, '«id»-$1');
}

/**
 * The generated id this render happened to get.
 *
 * `input, textarea` and not just `input`: a multiline field renders a textarea,
 * and an empty id here would make `replaceAll` in `shapeOf` match the empty
 * string — which inserts the token between every character and turns a passing
 * comparison into unreadable noise. It cost a diagnosis; the selector says why.
 */
function idOf(root: HTMLElement): string {
  return root.querySelector('input, textarea')?.getAttribute('id') ?? '\u0000never';
}

describe('the slim text field renders what MUI’s TextField renders', () => {
  const cases: ReadonlyArray<[name: string, props: TextFieldSlimProps]> = [
    ['a bare outlined field', {}],
    ['a labelled field', { label: 'Nome' }],
    ['a field with helper text', { label: 'Nome', helperText: 'Como no documento' }],
    ['an errored field', { label: 'Nome', helperText: 'Obrigatório', error: true }],
    ['a required, disabled, full-width field', { label: 'N', required: true, disabled: true, fullWidth: true }],
    ['the filled variant', { label: 'Nome', variant: 'filled', helperText: 'ok' }],
    ['the standard variant', { label: 'Nome', variant: 'standard', helperText: 'ok' }],
    ['a small field with a placeholder and a type', { size: 'small', placeholder: 'dd/mm', type: 'date' }],
    ['a label pinned shrunk', { label: 'Data', InputLabelProps: { shrink: true }, type: 'date' }],
    ['a multiline field', { label: 'Observação', multiline: true, rows: 3 }],
    ['props that only the input should see', { inputProps: { 'aria-label': 'Buscar', 'data-testid': 'x' } }],
    ['props that only the root should see', { className: 'own-class', name: 'field', autoComplete: 'off' }],
  ];

  for (const [name, props] of cases) {
    it(`matches for ${name}`, () => {
      const rendered = bothOf(props);

      expect(shapeOf(rendered.slim, idOf(rendered.slim))).toBe(
        shapeOf(rendered.mui, idOf(rendered.mui)),
      );
    });
  }

  it('carries the root class a stylesheet reaches for, spelled as MUI spells it', () => {
    const rendered = bothOf({ label: 'Nome' });

    // Asserted against the REAL TextField rather than against a literal, so a
    // rename in MUI shows up here instead of in somebody's stylesheet.
    expect([...rendered.mui.classList]).toContain('MuiTextField-root');
    expect([...rendered.slim.classList]).toContain('MuiTextField-root');
  });

  it('joins the helper text to the field for a screen reader', () => {
    const rendered = bothOf({ label: 'Nome', helperText: 'Como no documento' });
    const input = rendered.slim.querySelector('input') as HTMLInputElement;
    const describedBy = input.getAttribute('aria-describedby') ?? '';

    expect(describedBy).not.toBe('');
    expect(rendered.slim.querySelector(`#${CSS.escape(describedBy)}`)?.textContent).toBe(
      'Como no documento',
    );
  });

  it('points the label at the input it labels', () => {
    const rendered = bothOf({ label: 'Nome' });
    const input = rendered.slim.querySelector('input') as HTMLInputElement;
    const label = rendered.slim.querySelector('label') as HTMLLabelElement;

    expect(label.getAttribute('for')).toBe(input.id);
    expect(input.id).not.toBe('');
  });

  it('drops children, because only the select branch ever rendered them', () => {
    const rendered = bothOf({ children: <span data-testid="orphan" /> } as TextFieldSlimProps);

    // Asserted on the MARKUP rather than as a missing-element lookup: nothing is
    // being removed here, so there is no state to wait for — the child was never
    // rendered by either component, and `outerHTML` says that without pretending
    // to be a disappearance check.
    expect(rendered.slim.outerHTML).not.toContain('orphan');
    expect(rendered.mui.outerHTML).not.toContain('orphan');
  });
});
