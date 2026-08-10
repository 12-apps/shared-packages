// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { blockHeightCss } from '../../layout';
import { ReportBlockFrame, ReportGrid, ReportGridItem } from '../report-grid';

/**
 * `Altura` at the DOM, where the promise is actually kept or broken (FUT-755).
 *
 * The pure geometry is asserted in `block-cell.test.ts`; these cases prove the
 * cell REACHES the DOM — that a height an author picked becomes a real
 * `min-height` on the placed block, and, more importantly, that a block with no
 * stored height carries none. That second one is the compatibility requirement
 * and the assertion most likely to be skipped, because it asserts an ABSENCE.
 *
 * They read `getComputedStyle`, which resolves emotion's injected rules in
 * jsdom for plain properties like these — no cascade subtlety is involved,
 * every rule here comes from one class on one element.
 */
afterEach(cleanup);

function cellStyle(testId: string): CSSStyleDeclaration {
  return window.getComputedStyle(screen.getByTestId(testId));
}

describe('ReportGridItem — a block with no stored height', () => {
  it('sets no min-height at all, so it measures exactly what it renders', () => {
    render(
      <ReportGrid dataTestId="canvas">
        <ReportGridItem span={6} dataTestId="cell">
          <div>conteúdo</div>
        </ReportGridItem>
      </ReportGrid>,
    );
    expect(cellStyle('cell').minHeight).toBe('');
  });

  it('is not turned into a flex column either — nothing about it changes', () => {
    render(
      <ReportGrid dataTestId="canvas">
        <ReportGridItem span={6} dataTestId="cell">
          <div>conteúdo</div>
        </ReportGridItem>
      </ReportGrid>,
    );
    // `display` resolves to the UA's own `block` for a div — what matters is
    // that the cell was not turned into a flex column to distribute a height.
    const style = cellStyle('cell');
    expect(style.display).not.toBe('flex');
    expect(style.flexDirection).toBe('');
  });

  it('renders identically whether `height` is omitted or passed as undefined', () => {
    render(
      <ReportGrid dataTestId="canvas">
        <ReportGridItem span={6} dataTestId="omitted">
          <div>a</div>
        </ReportGridItem>
        <ReportGridItem span={6} height={undefined} dataTestId="explicit">
          <div>b</div>
        </ReportGridItem>
      </ReportGrid>,
    );
    expect(screen.getByTestId('omitted').className).toBe(
      screen.getByTestId('explicit').className,
    );
  });
});

describe('ReportGridItem — a block with a stored height', () => {
  it('reserves the tier’s own clamp', () => {
    render(
      <ReportGrid dataTestId="canvas">
        <ReportGridItem span={6} height={2} dataTestId="cell">
          <div>conteúdo</div>
        </ReportGridItem>
      </ReportGrid>,
    );
    expect(cellStyle('cell').minHeight).toBe(blockHeightCss(2));
  });

  it('reserves it as a MINIMUM, never a ceiling — a long table outgrows it', () => {
    render(
      <ReportGrid dataTestId="canvas">
        <ReportGridItem span={6} height={2} dataTestId="cell">
          <div>conteúdo</div>
        </ReportGridItem>
      </ReportGrid>,
    );
    const style = cellStyle('cell');
    expect(style.height).toBe('');
    expect(style.maxHeight).toBe('');
    expect(style.overflow).toBe('');
  });
});

describe('ReportBlockFrame — filling the height rather than floating in it', () => {
  const frame = (fill: boolean) => (
    <ReportBlockFrame title="Receita" dataTestId="block" fill={fill}>
      <div data-testid="rendering">gráfico</div>
    </ReportBlockFrame>
  );

  it('leaves the rendering exactly where it was when the block has no height', () => {
    render(frame(false));
    const rendering = screen.getByTestId('rendering');
    // No wrapper is inserted: the rendering's parent is the card's own stack,
    // which is what it has always been.
    expect(rendering.parentElement?.className).toContain('MuiStack-root');
  });

  it('wraps the rendering in a growing slot when the block declares a height', () => {
    render(frame(true));
    const slot = screen.getByTestId('rendering').parentElement;
    expect(slot?.className).not.toContain('MuiStack-root');
    expect(slot === null ? '' : window.getComputedStyle(slot).flexGrow).toBe('1');
  });
});
