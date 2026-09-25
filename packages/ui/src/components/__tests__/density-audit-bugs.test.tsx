/**
 * Four layout bugs the density audit found (FUT-2585, child 2). Each one was a
 * UNIT mistake — a length written in the wrong unit for where it landed — so
 * each test pins the value that reaches the browser, not the prop that was
 * passed.
 */
import { createTheme, ThemeProvider } from '@mui/material/styles/index.js';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EN_US_UPLOAD_BUTTON_COPY } from '../../en-US.form';
import { variantStylesOf } from '../feedback/Dialog/Dialog.styles';
import { UploadDropzone, UploadTrigger } from '../form/UploadButton/UploadButton.parts';
import { Separator } from '../layout/Separator';
import { SettingsRailGroup } from '../layout/SettingsLayout/SettingsLayout.items';

afterEach(cleanup);

const styleText = (): string =>
  Array.from(document.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n');

describe('Dialog drawer corners', () => {
  it('writes the spacing length once, not "16pxpx"', () => {
    const styles = variantStylesOf(createTheme(), {
      variant: 'drawer',
      size: 'md',
      borderRadius: 'lg',
      glass: false,
      gradient: false,
      glow: false,
      pulse: false,
    }) as Record<string, unknown>;
    expect(styles.borderRadius).toBe('16px 0 0 16px');
  });

  it('keeps a square drawer square', () => {
    const styles = variantStylesOf(createTheme(), {
      variant: 'drawer',
      size: 'md',
      borderRadius: 'none',
      glass: false,
      gradient: false,
      glow: false,
      pulse: false,
    }) as Record<string, unknown>;
    expect(styles.borderRadius).toBe('0 0 0 0');
  });
});

describe('Separator margin', () => {
  const marginsOf = (el: HTMLElement) => {
    const cs = globalThis.getComputedStyle(el);
    return [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft];
  };

  it('gives a labelled separator the SAME block-axis margin as a plain one', () => {
    render(
      <>
        <Separator size="md" data-testid="plain" />
        <Separator size="md" data-testid="labelled">
          ou
        </Separator>
      </>,
    );
    // 16px through the type scale (FUT-2597): 1rem at the default 16px root.
    expect(marginsOf(screen.getByTestId('plain'))).toEqual(['1rem', '0px', '1rem', '0px']);
    // Was 128px on all four sides: 16 read as spacing units.
    expect(marginsOf(screen.getByTestId('labelled'))).toEqual(['1rem', '0px', '1rem', '0px']);
  });

  it('puts no second margin on the rules inside the labelled row', () => {
    render(
      <Separator size="md" data-testid="labelled">
        ou
      </Separator>,
    );
    const rules = Array.from(screen.getByTestId('labelled').children).filter(
      (el) => el.tagName === 'DIV',
    ) as HTMLElement[];
    expect(rules).toHaveLength(2);
    for (const rule of rules) expect(globalThis.getComputedStyle(rule).marginTop).toBe('0px');
  });

  it('keeps a vertical labelled separator on the inline axis', () => {
    render(
      <Separator orientation="vertical" size="sm" data-testid="v">
        ou
      </Separator>,
    );
    // 8px through the type scale: 0.5rem at the default 16px root.
    expect(marginsOf(screen.getByTestId('v'))).toEqual(['0px', '0.5rem', '0px', '0.5rem']);
  });
});

describe('SettingsLayout drill-down index', () => {
  it('spaces its two columns one spacing unit apart, not eight', () => {
    render(
      <SettingsRailGroup
        group={{ id: 'g', label: 'Loja', items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }}
        variant="drilldown"
        breakpoint="md"
        atIndex
        testIdPrefix="s"
      />,
    );
    const gaps = Array.from(screen.getByTestId('s-group-g').querySelectorAll<HTMLElement>('*'))
      .map((el) => globalThis.getComputedStyle(el).columnGap)
      .filter((gap) => gap && gap !== 'normal');
    expect(gaps).toEqual(['8px']);
  });
});

describe('UploadButton tints', () => {
  // A palette colour that is NOT a six-digit hex: a hex-alpha suffix glued on
  // (`rgb(10, 20, 30)0A`) is not a colour at all, and the tint vanished.
  const theme = createTheme({ palette: { primary: { main: 'rgb(10, 20, 30)' } } });
  const noop = (): void => undefined;
  const common = {
    copy: EN_US_UPLOAD_BUTTON_COPY,
    label: 'Upload',
    disabled: false,
    onOpen: () => undefined,
  };

  it('draws the ghost hover tint for an rgb() primary', () => {
    render(
      <ThemeProvider theme={theme}>
        <UploadTrigger {...common} variant="ghost" isUploading={false} />
      </ThemeProvider>,
    );
    const css = styleText();
    expect(css).not.toMatch(/rgb\(10, 20, 30\)0[0-9A-F]/i);
    expect(css).toMatch(/rgba\(10, 20, 30, 0\.031/);
  });

  it('draws the dropzone hover tint for an rgb() primary', () => {
    render(
      <ThemeProvider theme={theme}>
        <UploadDropzone
          {...common}
          drag={{ onDragEnter: noop, onDragLeave: noop, onDragOver: noop, onDrop: noop }}
          isDragOver={false}
        />
      </ThemeProvider>,
    );
    const css = styleText();
    expect(css).not.toMatch(/rgb\(10, 20, 30\)0[0-9A-F]/i);
    expect(css).toMatch(/rgba\(10, 20, 30, 0\.019/);
  });
});
