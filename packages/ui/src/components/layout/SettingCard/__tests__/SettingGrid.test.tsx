/**
 * `SettingGrid` — columns from container queries, equal-height rows, and the
 * open card's full-row span (FUT-2823).
 *
 * jsdom cannot lay out a grid or answer a container query, so these assert the
 * CSS the grid emits; `SettingGrid.test.stories.tsx` measures the real layout
 * in a browser.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ThemeProvider, createTheme } from '../../../../mui/styles';
import { SETTING_GRID_CONTAINER, SettingGrid, settingGridStyles } from '../SettingGrid';
import { emittedCss } from './emitted-css';

afterEach(cleanup);

const theme = createTheme();

describe('settingGridStyles', () => {
  it('starts at one column and adds columns through container queries only', () => {
    const styles = settingGridStyles(theme, { minColumnPx: 320, maxColumns: 3, gapUnits: 2 });
    const queries = Object.keys(styles).filter((key) => key.startsWith('@'));

    expect(styles.gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))');
    expect(queries).toHaveLength(2);
    expect(queries.every((key) => key.startsWith(`@container ${SETTING_GRID_CONTAINER} `))).toBe(true);
    expect(queries[0]).toMatch(/\(min-width: calc\(2 \* 20rem \+ 1 \* 16px\)\)$/);
    expect(queries[1]).toMatch(/\(min-width: calc\(3 \* 20rem \+ 2 \* 16px\)\)$/);
    expect(queries.some((key) => key.startsWith('@media'))).toBe(false);
    expect(styles[queries[1] as string]).toEqual({ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' });
  });

  it('stops at maxColumns', () => {
    const one = settingGridStyles(theme, { minColumnPx: 320, maxColumns: 1, gapUnits: 2 });
    const two = settingGridStyles(theme, { minColumnPx: 320, maxColumns: 2, gapUnits: 2 });

    expect(Object.keys(one).filter((key) => key.startsWith('@'))).toEqual([]);
    expect(Object.keys(two).filter((key) => key.startsWith('@'))).toHaveLength(1);
  });

  it('sizes rows by their tallest card and stretches every card to it', () => {
    const styles = settingGridStyles(theme, { minColumnPx: 320, maxColumns: 3, gapUnits: 2 });

    // Not `1fr`: that would make every row as tall as the tallest one.
    expect(styles.gridAutoRows).toBe('auto');
    expect(styles.alignItems).toBe('stretch');
  });

  it('gives an open card, or a wrapper holding one, the whole row', () => {
    const styles = settingGridStyles(theme, { minColumnPx: 320, maxColumns: 3, gapUnits: 2 });

    expect(styles['& > [data-setting-card-open], & > :has([data-setting-card-open])']).toEqual({
      gridColumn: '1 / -1',
    });
  });

  it('scales the column threshold with the type scale', () => {
    const dense = createTheme({ typography: { fontSize: 12 } });
    const styles = settingGridStyles(dense, { minColumnPx: 320, maxColumns: 2, gapUnits: 2 });

    expect(Object.keys(styles)).toContain(
      `@container ${SETTING_GRID_CONTAINER} (min-width: calc(2 * ${dense.typography.pxToRem(320)} + 1 * 16px))`,
    );
  });
});

describe('SettingGrid', () => {
  it('makes the outer element the inline-size container the inner grid queries', () => {
    render(
      <ThemeProvider theme={theme}>
        <SettingGrid dataTestId="grid" aria-label="Security">
          <div>a</div>
          <div>b</div>
        </SettingGrid>
      </ThemeProvider>,
    );
    const outer = screen.getByTestId('grid');

    expect(outer).toHaveAttribute('role', 'region');
    expect(outer).toHaveAccessibleName('Security');
    expect(emittedCss(outer)).toContain('container-type:inline-size');
    expect(emittedCss(outer)).toContain(`container-name:${SETTING_GRID_CONTAINER}`);
    expect(screen.getByTestId('grid-grid').children).toHaveLength(2);
    expect(screen.getByTestId('grid-grid')).toHaveAttribute('data-max-columns', '3');
  });

  it('renders no region without a name', () => {
    render(
      <SettingGrid dataTestId="grid">
        <div>a</div>
      </SettingGrid>,
    );

    expect(screen.getByTestId('grid')).not.toHaveAttribute('role');
  });
});
