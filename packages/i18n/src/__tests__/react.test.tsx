import { render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE } from '../core/locale';
import type { LocalePack } from '../core/pack';
import { LocaleProvider, useFormats, useLocaleCopy } from '../react/index';

const COPY: LocalePack<{ save: string }> = {
  'pt-BR': { save: 'Salvar' },
  'en-US': { save: 'Save' },
};

function Save(): JSX.Element {
  return <span>{useLocaleCopy(COPY).save}</span>;
}

function Price(): JSX.Element {
  return <span>{useFormats({ currency: 'BRL' }).money(1990)}</span>;
}

describe('LocaleProvider', () => {
  it('renders the copy for the locale in scope', () => {
    render(
      <LocaleProvider locale="en-US">
        <Save />
      </LocaleProvider>,
    );
    expect(screen.getByText('Save')).toBeDefined();
  });

  it('keeps Portuguese when the host names the default', () => {
    render(
      <LocaleProvider locale={DEFAULT_LOCALE}>
        <Save />
      </LocaleProvider>,
    );
    expect(screen.getByText('Salvar')).toBeDefined();
  });

  it('formats in the locale in scope', () => {
    render(
      <LocaleProvider locale="en-US">
        <Price />
      </LocaleProvider>,
    );
    expect(screen.getByText(/1,?990|19\.90/)).toBeDefined();
  });

  it('THROWS outside a provider rather than assuming a language', () => {
    // The whole argument of the copy port: a language reached by saying
    // nothing is the one that ships to the wrong audience unnoticed.
    expect(() => render(<Save />)).toThrow(/LocaleProvider/);
  });
});
