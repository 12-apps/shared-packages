/**
 * THE VIRTUALISER POSITIONS WITH THE PITCH THE CSS DRAWS (FUT-2598).
 *
 * `itemHeight`, `height`, `rowHeight`, `columnWidth` and `gap` are design px,
 * scaled with the theme's type scale. A virtualiser that kept computing with the
 * raw number while the box it draws followed the theme would leave a gap (or an
 * overlap) under every row, and would compute its visible range for a viewport
 * that is not the one on screen.
 *
 * jsdom does not lay out, so these compare the numbers the component COMPUTES:
 * the style it writes and the offsets it hands to `renderItem`. The theme is a
 * NON-default one (`fontSize: 12`), where `pxToRem(n)` is `n × 12/14 / 16` rem —
 * at MUI's default every design px is one CSS px and nothing here could fail.
 */
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { CSSProperties } from 'react';
import { describe, expect, it } from 'vitest';

import { remPx } from '../../../../tokens/relative';
import { VirtualGrid, VirtualList } from '../VirtualList';
import type { VirtualListItem } from '../VirtualList.types';

const theme = createTheme({ typography: { fontSize: 12 } });
/** What one `rem` renders at here — the ratio `remPx` itself uses. */
const ROOT_PX = remPx(theme, 16) / Number.parseFloat(theme.typography.pxToRem(16));

/** A CSS length the component wrote (`12.5rem`, `40px` or a bare number) in px. */
function cssPx(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  const text = String(value ?? '');
  const n = Number.parseFloat(text);
  return text.endsWith('rem') ? n * ROOT_PX : n;
}

const items = (count: number): VirtualListItem[] => Array.from({ length: count }, (_, id) => ({ id }));

/** Every item's style, by index, as `renderItem` received it. */
function renderList(extra: Partial<React.ComponentProps<typeof VirtualList>> = {}) {
  const byIndex = new Map<number, CSSProperties>();
  render(
    <ThemeProvider theme={theme}>
      <VirtualList
        data-testid="list"
        items={items(200)}
        height={400}
        itemHeight={40}
        overscan={0}
        renderItem={({ index, style }) => {
          byIndex.set(index, style);
          return <div key={index} data-testid={`item-${index}`} style={style} />;
        }}
        {...extra}
      />
    </ThemeProvider>,
  );
  return byIndex;
}

/** The indices currently mounted, in order. */
const mounted = (): number[] =>
  screen
    .queryAllByTestId(/^item-\d+$/)
    .map((node) => Number(node.dataset.testid?.slice('item-'.length)))
    .sort((a, b) => a - b);

describe('VirtualList under a non-default type scale', () => {
  it('draws a row at the pitch it positions rows with — both the scaled design px', () => {
    const styles = renderList();
    const pitch = cssPx(styles.get(0)?.height);
    const offset = cssPx(styles.get(7)?.top) / 7;

    expect(pitch).toBeCloseTo(remPx(theme, 40), 6);
    expect(offset).toBeCloseTo(pitch, 6);
  });

  it('computes the visible range for the viewport height it renders', () => {
    renderList();
    const viewport = screen.getByTestId('list');
    const viewportPx = cssPx(globalThis.getComputedStyle(viewport).height);
    expect(viewportPx).toBeCloseTo(remPx(theme, 400), 6);

    const pitch = remPx(theme, 40);
    const scrollTop = 10 * pitch + 3;
    act(() => {
      fireEvent.scroll(viewport, { target: { scrollTop } });
    });
    // overscan 0: exactly the rows that intersect [scrollTop, scrollTop + viewport].
    const first = Math.floor(scrollTop / pitch);
    const last = Math.ceil((scrollTop + viewportPx) / pitch);
    const shown = mounted();
    expect(shown[0]).toBe(first);
    expect(shown[shown.length - 1]).toBe(last);
  });

  it('scales a variable item\'s own design height the same way', () => {
    const variable = Array.from({ length: 50 }, (_, id) => ({ id, height: 60 }));
    const styles = renderList({ variant: 'variable', items: variable });
    expect(cssPx(styles.get(0)?.height)).toBeCloseTo(remPx(theme, 60), 6);
    expect(cssPx(styles.get(3)?.top) / 3).toBeCloseTo(remPx(theme, 60), 6);
  });

  it('sizes the scroll content to every row at the scaled pitch', () => {
    renderList();
    const content = screen.getByTestId('list').firstElementChild as HTMLElement;
    expect(cssPx(globalThis.getComputedStyle(content).height)).toBeCloseTo(remPx(theme, 200 * 40), 4);
  });
});

describe('VirtualGrid under a non-default type scale', () => {
  it('places cells at the pitch it draws them — row height plus gap, scaled', () => {
    const styles = new Map<number, CSSProperties>();
    render(
      <ThemeProvider theme={theme}>
        <VirtualGrid
          items={items(60)}
          height={300}
          columnCount={3}
          rowHeight={100}
          columnWidth={120}
          gap={8}
          overscan={0}
          renderItem={({ index, style }) => {
            styles.set(index, style);
            return <div key={index} style={style} />;
          }}
        />
      </ThemeProvider>,
    );

    expect(cssPx(styles.get(0)?.height)).toBeCloseTo(remPx(theme, 100), 6);
    expect(cssPx(styles.get(0)?.width)).toBeCloseTo(remPx(theme, 120), 6);
    // Row 2 starts two pitches down, column 1 one column-plus-gap across.
    expect(cssPx(styles.get(6)?.top) / 2).toBeCloseTo(remPx(theme, 108), 6);
    expect(cssPx(styles.get(1)?.left)).toBeCloseTo(remPx(theme, 128), 6);
  });
});
