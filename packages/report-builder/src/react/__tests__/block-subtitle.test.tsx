// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ReportBlockFrame } from '../report-grid';

/**
 * A block's subtitle is TWO different things, and only one of them truncates
 * (FUT-755, gap A).
 *
 * `ReportBlockFrame` used to take one `description` and set it in a tinted,
 * padded, rounded box that wrapped onto a second line. Two unrelated strings
 * were arriving in that slot:
 *
 *  - the AUTHORED canvas sends the block's machine-generated spec sentence
 *    ("soma de receita em pedidos, onde status…"). `prototype.html` renders it
 *    as `.block-spec`: mono, muted, `white-space:nowrap`, `overflow:hidden`,
 *    `text-overflow:ellipsis` — one discreet line under the title.
 *  - a BUILT-IN report sends the preset's own statement of what its figures
 *    exclude and when they are withheld (FUT-454). Truncating THAT to one line
 *    cuts a disclosure off mid-sentence, on the very screen where the numbers
 *    it qualifies are being read.
 *
 * So the prop is split, and these cases are the difference: one asserts the
 * truncation, the other asserts its absence. A single shared `description`
 * would fail one of them whichever way it was styled.
 *
 * The styles are read off the ELEMENT's inline style rather than
 * `getComputedStyle`, because they are set inline precisely so they beat the
 * design system's own `variant="code"` chip — and inline is the one layer
 * jsdom reports faithfully.
 */

const SENTENCE =
  'soma de receita em pedidos por forma de pagamento, onde status é PAID e canal é MESA';

const PROSE =
  'Exclui pedidos anteriores ao FUT-364, que ficam fora das taxas. Uma linha com menos de 5 amostras tem o número retido.';

afterEach(cleanup);

function renderFrame(props: { specSentence?: string; description?: string }): HTMLElement {
  render(
    <ReportBlockFrame title="Receita" dataTestId="bloco" {...props}>
      <div data-testid="bloco-body" />
    </ReportBlockFrame>,
  );
  return screen.getByTestId('bloco-description');
}

describe('the generated spec sentence — one discreet line', () => {
  it('is one line, truncated with an ellipsis', () => {
    const { style } = renderFrame({ specSentence: SENTENCE });

    expect(style.whiteSpace).toBe('nowrap');
    expect(style.overflow).toBe('hidden');
    expect(style.textOverflow).toBe('ellipsis');
    // Without a width to measure against, a `nowrap` flex child sizes itself
    // to its content and the ellipsis never appears.
    expect(style.maxWidth).toBe('100%');
  });

  it('is not a panel: no padding, no radius, no tint, no border', () => {
    const { style } = renderFrame({ specSentence: SENTENCE });

    // The reported defect, item by item. `Text variant="code"` brings all four
    // on its own, so "unset" here means explicitly switched off.
    expect(style.padding).toBe('0px');
    expect(style.borderRadius).toBe('0px');
    expect(style.backgroundColor).toBe('transparent');
    expect(style.borderWidth).toBe('0px');
    expect(style.margin).toBe('0px');
  });

  it('keeps the mono face — the one thing that survives the box', () => {
    const sentence = renderFrame({ specSentence: SENTENCE });

    // `variant="code"` is how the design system says "monospace"; the class it
    // emits carries the family. Asserting the emitted rule rather than the
    // prop keeps this honest if the component's variants are ever renamed.
    const css = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n');
    const mono = Array.from(sentence.classList)
      .filter((name) => name.startsWith('css-'))
      .some((name) => {
        const at = css.indexOf(`.${name}{`);
        return at !== -1 && css.slice(at, css.indexOf('}', at)).includes('monospace');
      });
    expect(mono).toBe(true);
  });

  it('keeps the whole sentence recoverable from the element that hid it', () => {
    const sentence = renderFrame({ specSentence: SENTENCE });

    // Truncation HIDES text. A `title` is the minimum way back to it — and the
    // text content is still the full string, so a screen reader and a copy of
    // the page both keep everything.
    expect(sentence.getAttribute('title')).toBe(SENTENCE);
    expect(sentence.textContent).toBe(SENTENCE);
  });
});

describe('an authored description — a disclosure, whole', () => {
  it('never truncates: it wraps in full', () => {
    const { style } = renderFrame({ description: PROSE });

    // The regression this split exists to prevent. Every one of these would be
    // set if the two concepts had stayed one prop.
    expect(style.whiteSpace).not.toBe('nowrap');
    expect(style.textOverflow).not.toBe('ellipsis');
    expect(style.overflow).not.toBe('hidden');
  });

  it('is not set in the mono face — it is not machine-written', () => {
    const prose = renderFrame({ description: PROSE });
    const css = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .join('\n');
    const mono = Array.from(prose.classList)
      .filter((name) => name.startsWith('css-'))
      .some((name) => {
        const at = css.indexOf(`.${name}{`);
        return at !== -1 && css.slice(at, css.indexOf('}', at)).includes('monospace');
      });
    // The mono face is what tells a reader "a machine wrote this". Prose in it
    // was the conflation, not a style choice.
    expect(mono).toBe(false);
  });

  it('says the whole thing, to the last word', () => {
    expect(renderFrame({ description: PROSE }).textContent).toBe(PROSE);
  });

  it('keeps the test id future-pay drives for a built-in\'s caveats', () => {
    // `apps/admin`'s reports-cozinha-disclosures test reads exactly this id on
    // `system-dashboard-block-<key>`; the split must not move it.
    render(
      <ReportBlockFrame title="Tempo de preparo" dataTestId="sys-bloco" description={PROSE}>
        <div />
      </ReportBlockFrame>,
    );

    expect(screen.getByTestId('sys-bloco-description').textContent).toBe(PROSE);
  });
});

describe('the two are one slot, and the disclosure owns it', () => {
  it('renders nothing when a block has neither', () => {
    render(
      <ReportBlockFrame title="Receita" dataTestId="bloco">
        <div />
      </ReportBlockFrame>,
    );

    expect(screen.queryAllByTestId('bloco-description')).toEqual([]);
  });

  it('shows the disclosure, not the sentence, if a block ever carried both', () => {
    const subtitle = renderFrame({ specSentence: SENTENCE, description: PROSE });

    // No caller does this today. If one ever does, the half that must not be
    // hidden is the one a reader cannot reconstruct from the block's settings.
    expect(subtitle.textContent).toBe(PROSE);
    expect(screen.queryAllByTestId('bloco-description')).toHaveLength(1);
  });
});
