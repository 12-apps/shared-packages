/// <reference types="vite/client" />
import TextField from '@mui/material/TextField/index.js';
import { ThemeProvider, createTheme } from '@mui/material/styles/index.js';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { posix } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PT_BR_CONFIRM_ACTION_COPY } from '../../../../pt-BR';
import { ConfirmAction } from '../index';

/**
 * The type-to-confirm box is the outlined slim field, not MUI's `TextField`
 * (FUT-3429). `TextField` imports `Select` unconditionally, and with it `Menu`,
 * `MenuList`, `NativeSelect` and `List`, so every screen that could open this
 * popup shipped a dropdown for a box that only ever takes a word.
 *
 * Two things are pinned: the swap changed nothing an operator sees (the field's
 * DOM is `TextField`'s, given the same props), and the popup's module graph no
 * longer reaches `TextField` or `Select` at all.
 */
afterEach(cleanup);

const theme = createTheme();
const LABEL = 'Digite Bebidas para confirmar';

/** The generated ids differ between two renders; nothing else may. */
function normalized(element: Element): string {
  return element.outerHTML.replace(/_r_[0-9a-z]+_|:r[0-9a-z]+:/g, 'ID');
}

function openTypeToConfirm(): Element {
  render(
    <ThemeProvider theme={theme}>
      <ConfirmAction
        title="Excluir a categoria?"
        confirmText="Excluir"
        errorText="Não foi possível excluir."
        copy={PT_BR_CONFIRM_ACTION_COPY}
        typeToConfirm="Bebidas"
        typeToConfirmLabel={LABEL}
        onConfirm={vi.fn()}
      >
        {(request) => (
          <button type="button" onClick={request}>
            Abrir
          </button>
        )}
      </ConfirmAction>
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Abrir' }));
  const input = screen.getByTestId('confirm-action-type-to-confirm');
  const root = input.closest('.MuiFormControl-root');
  if (!root) throw new Error('the type-to-confirm field has no FormControl root');
  return root;
}

/** What `TextField` renders for the props the popup passes it. */
function textFieldReference(): Element {
  const { container } = render(
    <ThemeProvider theme={theme}>
      <TextField
        size="small"
        value=""
        disabled={false}
        onChange={() => undefined}
        inputProps={{ 'aria-label': LABEL, 'data-testid': 'confirm-action-type-to-confirm' }}
      />
    </ThemeProvider>,
  );
  const root = container.querySelector('.MuiFormControl-root');
  if (!root) throw new Error('TextField rendered no FormControl root');
  return root;
}

describe('the type-to-confirm field', () => {
  it("renders exactly what MUI's TextField rendered", () => {
    const field = normalized(openTypeToConfirm());
    cleanup();
    expect(field).toBe(normalized(textFieldReference()));
  });
});

/** Every non-test, non-story source of the package, keyed from its root. */
const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/__tests__/**', '!/src/**/*.stories.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
});
const SPECIFIER = /^[ \t]*(?:(?:import|export)\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"])/gm;

function runtimeImports(file: string): string[] {
  const out: string[] = [];
  for (const match of (SOURCES[file] ?? '').matchAll(SPECIFIER)) {
    if (/^\s*(?:import|export)\s+type\s/.test(match[0])) continue;
    const specifier = match[1] ?? match[2];
    if (specifier) out.push(specifier);
  }
  return out;
}

function resolveRelative(from: string, specifier: string): string {
  const base = posix.join(posix.dirname(from), specifier);
  const found = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((p) => p in SOURCES);
  if (!found) throw new Error(`cannot resolve ${specifier} from ${from}`);
  return found;
}

function reachablePackages(entry: string): Set<string> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of runtimeImports(file)) {
      if (specifier.startsWith('.')) stack.push(resolveRelative(file, specifier));
      else packages.add(specifier);
    }
  }
  return packages;
}

describe('the ConfirmAction module graph', () => {
  const packages = reachablePackages('/src/components/feedback/ConfirmAction/index.ts');

  it('still reaches OutlinedInput (the walk is not vacuous)', () => {
    expect(packages).toContain('@mui/material/OutlinedInput/index.js');
  });

  it.each(['TextField', 'Select', 'NativeSelect', 'FilledInput', 'Input'])('never reaches @mui/material/%s', (name) => {
    const pattern = new RegExp(`^@mui/material/${name}(?:/|$)`);
    expect([...packages].filter((specifier) => pattern.test(specifier))).toEqual([]);
  });
});
