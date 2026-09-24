/**
 * EVERY FIELD STANDS AT THE THEME'S ONE FIELD HEIGHT, AND RESTS ON ONE BORDER.
 *
 * A filter row stood at three heights — a 40px search box, 34px pills, 38px
 * triggers — with three resting borders: the MUI default, `divider`, and
 * `fieldEdge` (FUT-2555). The theme now carries one `fieldHeight`, in
 * multiples of the default font size, and each field reads it itself; each
 * rests on `fieldEdge` at 1px.
 *
 * Rendered under a PLAIN `createTheme({ fieldHeight: 3 })` — none of the MUI
 * overrides `createAppTheme` adds — so a field that only followed the height
 * through those would fail here. 3, not the default 2.5, so a field still
 * drawing a literal 40px cannot pass by coincidence.
 *
 * Reads the CSS each render emits, for the reason `./field-radius.test.tsx`
 * gives.
 */
import { cleanup, render } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import type React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { fieldEdge } from '../../../tokens/field-edge';
import { fieldHeightOverrides, fieldTextFieldStyles } from '../../../tokens/field-height';
import { MultiSelectDropdown } from '../../layout/ContentToolbar';
import { Button } from '../Button';
import { InputOTP } from '../InputOTP';
import { Input } from '../Input';
import { RadioGroup } from '../RadioGroup';
import { Select } from '../Select';
import { Toggle } from '../Toggle';
import { ToggleGroup } from '../ToggleGroup';
import { Fields, FormContainer, SubmitButton } from '../total-form';

afterEach(cleanup);

const theme = createTheme({ fieldHeight: 3 });

function emittedCss(): string {
  return Array.from(document.querySelectorAll('style'))
    .map((style) => style.textContent ?? '')
    .join('\n');
}

/** The CSS a render ADDED — emotion keeps every earlier test's rules too. */
function cssOf(ui: React.ReactElement): string {
  const before = emittedCss();
  render(<ThemeProvider theme={theme}>{ui}</ThemeProvider>);
  return emittedCss().slice(before.length);
}

/** Emotion minifies `calc( a - b )` but keeps the operator spacing CSS needs. */
const inset = (rem: number): string => `calc((${rem}rem - 1.4375em) / 2)`;
const options = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
];
const noop = (): void => undefined;

describe('the field height', () => {
  it.each<[string, React.ReactElement]>([
    ['Input', <Input key="i" label="Nome" />],
    ['Select', <Select key="s" label="Tipo" options={options} value="" onChange={noop} />],
  ])('%s centres its line in the field height', (_name, ui) => {
    expect(cssOf(ui)).toContain(inset(3));
  });

  it('draws the Input steps from the same height: xs compact, xl roomy', () => {
    expect(cssOf(<Input size="xs" label="Nome" />)).toContain(inset(2.4));
    expect(cssOf(<Input size="xl" label="Nome" />)).toContain(inset(4.2));
  });

  it.each<[string, React.ReactElement]>([
    ['Button', <Button key="b">Salvar</Button>],
    ['Toggle', <Toggle key="t" value="bold">Negrito</Toggle>],
    ['ToggleGroup', <ToggleGroup key="g" options={options} value="a" />],
    ['RadioGroup buttons', <RadioGroup key="r" variant="buttons" options={options} value="a" />],
  ])('%s stands at least the field height', (_name, ui) => {
    expect(cssOf(ui)).toMatch(/min-height:3rem/u);
  });

  it('makes an icon-only button a field-height square', () => {
    expect(cssOf(<Button icon={<span>x</span>} aria-label="Fechar" />)).toMatch(/min-width:3rem/u);
  });

  it('stands the filter pill at the field height, on the field border', () => {
    const css = cssOf(
      <MultiSelectDropdown
        extraOptionsHeading="Opções"
        clearText="Limpar"
        clearLabel="Limpar Tipo"
        label="Tipo"
        options={options}
        selected={new Set<string>()}
        onToggle={noop}
        onClear={noop}
        layout="pill"
      />,
    );
    expect(css).toMatch(/height:3rem/u);
    expect(css).toContain(`border-color:${fieldEdge(theme)}`);
  });

  it('rests a composite on MUI TextField on the field border, at the field height', () => {
    const styles = fieldTextFieldStyles(theme);
    expect(styles['& .MuiOutlinedInput-notchedOutline']).toEqual({ borderColor: fieldEdge(theme) });
    expect(JSON.stringify(styles)).toContain(inset(3));
  });

  it('stands a Select at the height Input draws for the same size', () => {
    expect(cssOf(<Select size="lg" label="Tipo" options={options} value="" onChange={noop} />)).toContain(inset(3.6));
  });

  it('squares an OTP slot to the field height and rests it on the field border', () => {
    const css = cssOf(<InputOTP length={4} />);
    expect(css).toMatch(/height:3rem/u);
    expect(css).toContain(`border-color:${fieldEdge(theme)}`);
  });

  it("lines a form's toggle, fields and submit up at the field height", () => {
    // The toggle used to pin 56px ("match the input field height") and the
    // submit button a hand-copied 56 — the two copies FUT-2555 retired.
    const css = cssOf(
      <FormContainer<{ kind: string; name: string }>
        initialValues={{ kind: 'a', name: '' }}
        schema={{}}
        onSubmit={noop}
      >
        <Fields.ToggleField name="kind" options={options} />
        <Fields.TextField name="name" label="Nome" />
        <SubmitButton>Salvar</SubmitButton>
      </FormContainer>,
    );
    // The TextField's own inset is the Input case above (emotion reuses its
    // class here); what is this form's own is the toggle and the submit.
    expect(css).not.toMatch(/height:56px/u);
    expect(css).toMatch(/min-height:3rem/u);
    expect(css).toMatch(/[^-]height:3rem/u);
  });

  it("rests a host's bare MUI field on the field border, at the field height", () => {
    const overrides = fieldHeightOverrides(3).MuiOutlinedInput?.styleOverrides;
    const notched = overrides?.notchedOutline as (props: { theme: typeof theme }) => unknown;
    expect(notched({ theme })).toEqual({ borderColor: fieldEdge(theme) });
    expect(JSON.stringify(overrides?.input)).toContain(inset(3));
  });
});
