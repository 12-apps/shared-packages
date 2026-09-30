/**
 * EVERY FIELD IS DRAWN WITH THE THEME'S ONE FIELD RADIUS.
 *
 * A filter row used to mix a 4px text field, 999px pill triggers, a 10px
 * category trigger and an 8px button (FUT-2552). The theme now carries one
 * `fieldRadius`, and each field reads it itself — so these render under a PLAIN
 * `createTheme({ fieldRadius })`, with none of the MUI component overrides
 * `createAppTheme` adds: a field that only followed the radius through those
 * overrides would pass under the app's theme and fail here.
 *
 * 13, not 8: the default is also what `Button` and `theme.spacing(1)` happen to
 * draw, so a field still hard-coding either would pass an 8px assertion by
 * coincidence.
 *
 * Reads the CSS each render EMITS rather than `getComputedStyle`, for the reason
 * `./field-contrast.test.tsx` gives: most of these corners are declared by a
 * descendant rule (`& .MuiOutlinedInput-root`) that jsdom does not resolve
 * reliably.
 */
import { cleanup, render } from '@testing-library/react';
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import type React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { fieldRootStyles } from '../../../tokens/field-radius';
import { MultiSelectDropdown } from '../../layout/ContentToolbar';
import { Button } from '../Button';
import { Input } from '../Input';
import { RadioGroup } from '../RadioGroup';
import { Select } from '../Select';
import { Textarea } from '../Textarea';
import { ToggleGroup } from '../ToggleGroup';

afterEach(cleanup);

const RADIUS = 13;
const theme = createTheme({ fieldRadius: RADIUS });

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

const radius = (px: number): RegExp => new RegExp(`border-radius:${px}px`, 'u');
const options = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
];
const noop = (): void => undefined;

describe('the field radius', () => {
  it.each<[string, React.ReactElement]>([
    ['Input', <Input key="i" label="Nome" />],
    ['Select', <Select key="s" label="Tipo" options={options} value="" onChange={noop} />],
    ['Textarea', <Textarea key="t" label="Observações" />],
    ['Button', <Button key="b">Salvar</Button>],
    ['ToggleGroup', <ToggleGroup key="g" options={options} value="a" />],
    ['RadioGroup buttons', <RadioGroup key="r" variant="buttons" options={options} value="a" />],
    [
      'the filter pill',
      <MultiSelectDropdown
        key="m"
        extraOptionsHeading="Opções"
        clearText="Limpar"
        clearLabel="Limpar Tipo"
        label="Tipo"
        options={options}
        selected={new Set<string>()}
        onToggle={noop}
        onClear={noop}
      />,
    ],
  ])('%s is drawn with the theme field radius', (_name, ui) => {
    expect(cssOf(ui)).toMatch(radius(RADIUS));
  });

  it('rounds a ToggleGroup button to it, and a glass frame concentric around it', () => {
    // The button IS the field; without glass the group itself draws no edge.
    // The whole document, not the delta: the `it.each` above already rendered
    // this exact ToggleGroup, so emotion reuses its class and emits nothing new.
    // Only ToggleGroup writes this `!important` rule, so the match stays specific.
    render(
      <ThemeProvider theme={theme}>
        <ToggleGroup options={options} value="a" />
      </ThemeProvider>,
    );
    expect(emittedCss()).toMatch(new RegExp(`border-radius:${RADIUS}px ?!important`, 'u'));
    // Glass: padding 4 + the buttons' 4px margin + a 1px border.
    expect(cssOf(<ToggleGroup options={options} value="a" glass />)).toMatch(radius(RADIUS + 9));
  });

  it('rounds each segment to it, and the segment track concentric around them', () => {
    const css = cssOf(<RadioGroup variant="segments" options={options} value="a" />);
    expect(css).toMatch(radius(RADIUS));
    // The track's 4px padding and 1px border.
    expect(css).toMatch(radius(RADIUS + 5));
  });

  it('gives a composite on MUI TextField the radius on its input root', () => {
    // PhoneInput, Autocomplete, CreatableSelect, AddressAutocomplete, TableFilter
    // and the DataViews day/number inputs render MUI's own TextField through this.
    expect(fieldRootStyles(theme)).toEqual({
      '& .MuiOutlinedInput-root': { borderRadius: `${RADIUS}px` },
      '& .MuiFilledInput-root': { borderTopLeftRadius: `${RADIUS}px`, borderTopRightRadius: `${RADIUS}px` },
    });
  });
});
