import { ThemeProvider, createTheme } from '@mui/material/styles/index.js';
import { fireEvent, render, screen, within } from '@testing-library/react';
import React, { useState } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PT_BR_AUTOCOMPLETE_COPY } from '../../../../pt-BR';
import { Autocomplete } from '../Autocomplete';
import type { AutocompleteProps } from '../Autocomplete.types';

/**
 * A suggestion's label is TEXT, never markup.
 *
 * The default row used to build its highlight as an HTML string and hand it to
 * React's raw-HTML prop, so a label is whatever a caller's data says it is —
 * in Future Pay, a shopper's self-chosen display name shown to a store operator.
 * A label of `<img src=x onerror=…>` ran script in the admin session. These
 * cases type into a real `<Autocomplete>` and read the listbox it opens: the
 * label must come out as literal text, with the query's matches wrapped in real
 * `<mark>` elements rather than a `<mark>` string.
 */

const theme = createTheme();

const HOSTILE = '<img src=x onerror="window.__xss=(window.__xss||0)+1">Mallory';

type MatchMode = NonNullable<AutocompleteProps['matchMode']>;

interface Row {
  id: string;
  label: string;
}

// jsdom has no layout, so no `scrollIntoView`; the hook scrolls the active
// option into view once the list opens.
const hadScrollIntoView = 'scrollIntoView' in Element.prototype;
beforeAll(() => {
  if (!hadScrollIntoView) {
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: () => undefined });
  }
});
afterAll(() => {
  if (!hadScrollIntoView) Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

function Harness({ labels, matchMode }: { labels: string[]; matchMode: MatchMode }): React.JSX.Element {
  const [value, setValue] = useState('');
  return (
    <ThemeProvider theme={theme}>
      <Autocomplete<Row>
        copy={PT_BR_AUTOCOMPLETE_COPY}
        value={value}
        onChange={setValue}
        suggestions={labels.map((label, index) => ({ id: String(index), label }))}
        getKey={(row) => row.id}
        getLabel={(row) => row.label}
        matchMode={matchMode}
        inputAriaLabel="cliente"
      />
    </ThemeProvider>
  );
}

/**
 * Render the field over `labels`, type `query` (or, for an empty one, open the
 * full list with ArrowDown) and return the listbox that opens.
 */
async function openList(labels: string[], query: string, matchMode: MatchMode = 'contains'): Promise<HTMLElement> {
  render(<Harness labels={labels} matchMode={matchMode} />);
  const input = screen.getByRole('combobox', { name: 'cliente' });
  fireEvent.focusIn(input);
  if (query) fireEvent.change(input, { target: { value: query } });
  else fireEvent.keyDown(input, { key: 'ArrowDown' });
  return screen.findByRole('listbox');
}

/** Each option's label as `text` / `<mark>text</mark>` runs, in document order. */
function labelRuns(listbox: HTMLElement): string[][] {
  return within(listbox)
    .getAllByRole('option')
    .map((option) => {
      const primary = option.querySelector('.MuiListItemText-primary');
      const span = primary?.firstElementChild ?? primary;
      return Array.from(span?.childNodes ?? [], (node) =>
        node.nodeName === 'MARK' ? `<mark>${node.textContent ?? ''}</mark>` : (node.textContent ?? ''),
      );
    });
}

describe('Autocomplete default suggestion row: a label is text', () => {
  it('lists a markup label literally when the typed query matches it (contains)', async () => {
    const listbox = await openList([HOSTILE, 'Ana Souza'], 'Mal');

    expect(within(listbox).getAllByRole('option')).toHaveLength(1);
    expect(listbox.querySelectorAll('img')).toHaveLength(0);
    expect(within(listbox).getByRole('option')).toHaveTextContent(HOSTILE, { normalizeWhitespace: false });
    expect(labelRuns(listbox)).toEqual([[HOSTILE.slice(0, HOSTILE.indexOf('Mal')), '<mark>Mal</mark>', 'lory']]);
  });

  it('lists a markup label literally when the query is empty', async () => {
    const listbox = await openList([HOSTILE], '');

    expect(listbox.querySelectorAll('img')).toHaveLength(0);
    expect(listbox.querySelectorAll('mark')).toHaveLength(0);
    expect(within(listbox).getByRole('option')).toHaveTextContent(HOSTILE, { normalizeWhitespace: false });
  });

  it('lists a markup label literally in fuzzy mode', async () => {
    const listbox = await openList([HOSTILE], 'mly', 'fuzzy');

    expect(listbox.querySelectorAll('img')).toHaveLength(0);
    expect(within(listbox).getByRole('option')).toHaveTextContent(HOSTILE, { normalizeWhitespace: false });
  });

  it('does not decode an entity-like label when the query is empty', async () => {
    const listbox = await openList(['Tom &amp; Jerry'], '');

    expect(labelRuns(listbox)).toEqual([['Tom &amp; Jerry']]);
  });

  it('does not decode an entity-like label when the query matches inside the entity', async () => {
    const listbox = await openList(['Tom &amp; Jerry'], 'amp');

    expect(labelRuns(listbox)).toEqual([['Tom &', '<mark>amp</mark>', '; Jerry']]);
  });

  it('keeps a stray "<" as text instead of opening a phantom tag', async () => {
    const listbox = await openList(['a <b c'], 'c');

    expect(within(listbox).getByRole('option')).toHaveTextContent('a <b c', { normalizeWhitespace: false });
  });
});

describe('Autocomplete default suggestion row: the highlight', () => {
  it('marks the label’s own text for a case-mismatched query', async () => {
    const listbox = await openList(['Maria'], 'mar');

    expect(labelRuns(listbox)).toEqual([['<mark>Mar</mark>', 'ia']]);
  });

  it('marks a mid-label match and keeps the text in order', async () => {
    const listbox = await openList(['Ana Souza'], 'SOU');

    expect(labelRuns(listbox)).toEqual([['Ana ', '<mark>Sou</mark>', 'za']]);
  });

  it('marks every occurrence in contains mode', async () => {
    const listbox = await openList(['banana'], 'an');

    expect(labelRuns(listbox)).toEqual([['b', '<mark>an</mark>', '<mark>an</mark>', 'a']]);
  });

  it('marks every occurrence in startsWith mode, not only the prefix', async () => {
    // `Banana` does not start with "an", so startsWith filters it out.
    const listbox = await openList(['Ana Banana', 'Banana'], 'an', 'startsWith');

    expect(labelRuns(listbox)).toEqual([['<mark>An</mark>', 'a B', '<mark>an</mark>', '<mark>an</mark>', 'a']]);
  });

  it('matches regex metacharacters in the query literally', async () => {
    const listbox = await openList(['axb a.b', 'a.b'], 'a.b');

    expect(labelRuns(listbox)).toEqual([['axb ', '<mark>a.b</mark>'], ['<mark>a.b</mark>']]);
  });

  it('matches an unbalanced parenthesis literally', async () => {
    const listbox = await openList(['f(x)'], '(');

    expect(labelRuns(listbox)).toEqual([['f', '<mark>(</mark>', 'x)']]);
  });

  it('leaves the label unmarked in fuzzy mode', async () => {
    const listbox = await openList(['Ana Souza'], 'asz', 'fuzzy');

    expect(labelRuns(listbox)).toEqual([['Ana Souza']]);
  });
});
