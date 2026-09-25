/**
 * THE FIELD'S OWN ARIA STATE REACHES THE `<input>` (FUT-2619).
 *
 * `Input` spreads what it does not consume onto `TextFieldSlim`, and the text
 * field puts everything it does not recognise on its ROOT `FormControl` — a
 * `<div>` with no role. `aria-label` was already routed through `inputProps`
 * for exactly that reason (FUT-755). `aria-describedby` and `aria-busy` were
 * not, so a caller describing its field (CepField's lookup status) or marking
 * it busy described and marked a div nobody reads.
 *
 * The one subtlety: MUI already writes `aria-describedby` on the input when
 * there is helper text, and `inputProps` are spread AFTER it. A caller's value
 * routed naively would replace the helper text's id — so the field has to JOIN
 * the two, helper text first, as `TextField` itself orders it.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from '../Input';

const rootOf = (input: HTMLElement) => input.closest('.MuiFormControl-root') as HTMLElement;

describe('Input: aria-describedby and aria-busy land on the <input>', () => {
  it('routes aria-describedby to the input, not the root', () => {
    render(<Input data-testid="campo" aria-describedby="dica" />);
    const input = screen.getByTestId('campo');

    expect(input).toHaveAttribute('aria-describedby', 'dica');
    expect(rootOf(input)).not.toHaveAttribute('aria-describedby');
  });

  it('routes aria-busy to the input, not the root', () => {
    render(<Input data-testid="campo" aria-busy />);
    const input = screen.getByTestId('campo');

    expect(input).toHaveAttribute('aria-busy', 'true');
    expect(rootOf(input)).not.toHaveAttribute('aria-busy');
  });

  it('keeps the helper text in aria-describedby when the caller adds its own', () => {
    render(<Input id="nome" data-testid="campo" helperText="Como no documento" aria-describedby="dica" />);
    const input = screen.getByTestId('campo');

    expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual(['nome-helper-text', 'dica']);
  });

  it('leaves the helper text alone when the caller adds nothing', () => {
    render(<Input id="nome" data-testid="campo" helperText="Como no documento" />);

    expect(screen.getByTestId('campo')).toHaveAttribute('aria-describedby', 'nome-helper-text');
  });
});
