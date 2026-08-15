/* eslint-disable test-flakiness/no-test-isolation --
   the harness's `control` object is created fresh inside each render call; the
   heuristic reads the shared NAME as shared state. */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AuditLogFilters } from '../../core/types';
import { defineAuditVocabulary } from '../../core/vocabulary';
import { resolveDayFormat } from '../day-bound';
import { AuditFilterBar } from '../filter-bar';
import { createAuditLabels, type AuditLabels } from '../labels';

/**
 * The day bounds, typed the way a person types.
 *
 * These cases drive the FILTER BAR rather than the field, because the defect is
 * not in either half alone — it is in the ROUND TRIP: the host mirrors the
 * filters into its router and hands them back as props, one or more commits
 * later. A field bound directly to that returning value is overwritten
 * mid-edit, and a native date input makes it silent, because it reports a WHOLE
 * date as soon as the year has one digit (`0002-07-01`) and that is a date the
 * filter happily applies.
 *
 * So every case here types ONE CHARACTER AT A TIME. A `fill()` that jumps
 * straight to the finished value never visits the intermediate states, which is
 * the only place the failure exists.
 */

const VOCABULARY = defineAuditVocabulary({
  actions: { 'lamp.extinguish': { label: 'Lamp extinguished' } },
  resources: { lamp: { label: 'Lamp', fields: ['state'] } },
});

/** pt-BR words, so the placeholder reads the way its market writes a date. */
const LABELS = createAuditLabels({
  filterFrom: 'De',
  filterTo: 'Até',
  dayPlaceholderYear: 'aaaa',
  clearBound: 'Limpar {field}',
});

/** What the harness records, and the lever the latency cases pull. */
interface Control {
  /** Every filter set the surface asked the host to apply, in order. */
  commits: AuditLogFilters[];
  /** Hand ONE of them back as the host's state — the async commit landing. */
  deliver: (filters: AuditLogFilters) => void;
}

/**
 * The host the package documents: filter state LIFTED, mirrored into a URL and
 * handed back as `filters`.
 *
 * `latent` is the whole point of this file. With it, a commit does NOT come back
 * on its own — the case delivers it, at the moment of its choosing, which is how
 * a navigation + render landing between two keystrokes is expressed without a
 * timer.
 */
function Host({
  control,
  labels,
  locale,
  initial,
  latent,
}: {
  control: Control;
  labels: AuditLabels;
  locale: string;
  initial: AuditLogFilters;
  latent: boolean;
}): JSX.Element {
  const [filters, setFilters] = useState<AuditLogFilters>(initial);
  control.deliver = setFilters;
  return (
    <AuditFilterBar
      filters={filters}
      labels={labels}
      vocabulary={VOCABULARY}
      actors={[]}
      dayFormat={resolveDayFormat(locale)}
      onChange={(next) => {
        control.commits.push(next);
        if (!latent) setFilters(next);
      }}
    />
  );
}

function renderBar(
  options: {
    locale?: string;
    initial?: AuditLogFilters;
    latent?: boolean;
    labels?: AuditLabels;
  } = {},
): Control {
  const control: Control = { commits: [], deliver: () => undefined };
  render(
    <Host
      control={control}
      labels={options.labels ?? LABELS}
      locale={options.locale ?? 'pt-BR'}
      initial={options.initial ?? {}}
      latent={options.latent ?? false}
    />,
  );
  return control;
}

afterEach(cleanup);

const from = (): HTMLInputElement => screen.getByTestId('audit-log-from') as HTMLInputElement;
const to = (): HTMLInputElement => screen.getByTestId('audit-log-to') as HTMLInputElement;

/** The `from` bound of the last filter set the surface asked to apply. */
const appliedFrom = (control: Control): string | undefined =>
  control.commits[control.commits.length - 1]?.from;

/** Every non-empty `from` the surface ever asked to apply. */
const boundsApplied = (control: Control): string[] =>
  control.commits.map((filters) => filters.from).filter((bound): bound is string => Boolean(bound));

/**
 * Press one character at a time, the way a controlled input actually sees it:
 * each keystroke fires a change whose value is the CURRENT display plus the new
 * character. Named for the keys rather than for `type`, so neither a reader nor
 * the flakiness rule mistakes it for `userEvent.type`.
 */
function pressKeys(field: () => HTMLInputElement, chars: string): void {
  for (const char of chars) {
    fireEvent.change(field(), { target: { value: field().value + char } });
  }
}

describe('a day bound being typed', () => {
  it('keeps every digit, and applies the filter only when the date is whole', () => {
    const control = renderBar();

    // Day and month: on screen, masked, and NOT applied yet.
    pressKeys(from, '0107');
    expect(from().value).toBe('01/07');
    expect(control.commits).toHaveLength(0);

    // The year, digit by digit. `2` is what used to complete the date as year
    // 0002 and blow the field away; nothing is applied until all four.
    pressKeys(from, '2');
    expect(from().value).toBe('01/07/2');
    pressKeys(from, '0');
    expect(from().value).toBe('01/07/20');
    expect(control.commits).toHaveLength(0);

    pressKeys(from, '26');
    expect(from().value).toBe('01/07/2026');
    // Only now — and in the WIRE's format, not the screen's.
    expect(appliedFrom(control)).toBe('2026-07-01');
  });

  it('cannot be corrupted by a commit that lands mid-edit', () => {
    // THE regression, as a property: **the committed value cannot be corrupted
    // by commit latency**.
    //
    // The host's write-back is asynchronous — a navigation and a React commit —
    // so a filter set built from keystroke N arrives back as `filters` while the
    // field is already at N+1. A field whose displayed value IS that returning
    // prop is rewritten underneath the typist, and the rest of the date is then
    // typed onto whatever landed. Measured in Chromium against the native input:
    // typing 2026 at a 150 ms commit lag applied the year 0006 — a valid date,
    // so it looked like it had worked.
    //
    // `latent: true` withholds every commit, so this case decides when each one
    // lands. Both halves of the property are checked: nothing PARTIAL is ever
    // committed (there is no `0002-…` to come back), and a commit landing late
    // does not disturb what is on screen.
    const control = renderBar({ latent: true });

    pressKeys(from, '0107');
    // The year, one digit at a time — the exact window the defect lived in.
    pressKeys(from, '2');
    expect(boundsApplied(control)).toEqual([]);

    // A commit lands between two keystrokes (here, the clear the first keystroke
    // produced when the field was momentarily empty is the only one there is).
    act(() => control.deliver({}));
    expect(from().value).toBe('01/07/2');

    pressKeys(from, '0');
    act(() => control.deliver({}));
    expect(from().value).toBe('01/07/20');
    expect(boundsApplied(control)).toEqual([]);

    pressKeys(from, '26');
    expect(from().value).toBe('01/07/2026');
    // The whole date, once, and nothing else: no year 0002, no year 0006.
    expect(boundsApplied(control)).toEqual(['2026-07-01']);

    // And the echo of that commit, arriving after the fact, leaves it alone.
    act(() => control.deliver({ from: '2026-07-01' }));
    expect(from().value).toBe('01/07/2026');
  });

  it('is not disturbed by the host echoing a bound back while it is re-typed', () => {
    // The same latency, at the moment it bites hardest: the field has already
    // committed a date, the operator is editing it down to type another, and the
    // EARLIER commit lands. Adopting it here would restore the date that was
    // just deleted, mid-keystroke.
    const control = renderBar({ latent: true });

    pressKeys(from, '01072026');
    expect(boundsApplied(control)).toEqual(['2026-07-01']);

    // Backspacing the year out, then the late echo of the first commit.
    fireEvent.change(from(), { target: { value: '01/07/2' } });
    act(() => control.deliver({ from: '2026-07-01' }));
    expect(from().value).toBe('01/07/2');

    pressKeys(from, '027');
    expect(from().value).toBe('01/07/2027');
    expect(boundsApplied(control)).toEqual(['2026-07-01', '2027-07-01']);
  });

  it('adopts a bound the host applied from somewhere else', () => {
    // The other side of the same rule: an UNFOCUSED field shows what is applied,
    // so a Back button, a "clear filters" press or a restored link is reflected
    // rather than ignored.
    const control = renderBar({ latent: true });

    act(() => control.deliver({ from: '2026-07-01' }));

    expect(from().value).toBe('01/07/2026');
    expect(control.commits).toHaveLength(0);
  });

  it('refuses a day that does not exist instead of rolling it over', () => {
    // 31/02 parses as three fine numbers. `Date` would roll it into March and
    // apply a window the merchant never asked for.
    const control = renderBar();

    pressKeys(from, '31022026');

    expect(from().value).toBe('31/02/2026');
    expect(boundsApplied(control)).toEqual([]);
  });

  it('ignores everything that is not a digit', () => {
    const control = renderBar();

    pressKeys(from, 'a1b/c7-2026');

    expect(from().value).toBe('17/20/26');
    expect(boundsApplied(control)).toEqual([]);
  });

  it('snaps back to what is applied when left half-typed', () => {
    // Blurring on a partial date would otherwise show a window the list is not
    // using — the field would claim a filter that was never applied.
    const control = renderBar({ initial: { from: '2026-07-01' } });

    fireEvent.change(from(), { target: { value: '' } });
    pressKeys(from, '1508');
    expect(from().value).toBe('15/08');

    fireEvent.blur(from());
    // The clear DID apply (an empty field is a dropped filter); the half-typed
    // date did not, so the field returns to what the list is actually using.
    expect(appliedFrom(control)).toBeUndefined();
    expect(from().value).toBe('');
  });
});

describe('a day bound already applied', () => {
  it('reads an ISO bound back in the merchant’s own order', () => {
    // The bookmark round trip: the param is the contract, the field is the view.
    renderBar({ initial: { from: '2026-07-01', to: '2026-12-31' } });

    expect(from().value).toBe('01/07/2026');
    expect(to().value).toBe('31/12/2026');
  });

  it('drops the bound when the field is emptied', () => {
    const control = renderBar({ initial: { from: '2026-07-01' } });

    fireEvent.change(from(), { target: { value: '' } });

    expect(from().value).toBe('');
    expect(appliedFrom(control)).toBeUndefined();
  });

  it('clears ONE bound from its own ✕, leaving the others alone', () => {
    // Without a per-bound clear, dropping "De" means pressing "Limpar filtros"
    // and losing every pill, the search and "Até" with it.
    const control = renderBar({
      initial: { from: '2026-07-01', to: '2026-12-31', actionIn: ['lamp.extinguish'] },
    });

    fireEvent.click(screen.getByTestId('audit-log-from-clear'));

    expect(from().value).toBe('');
    expect(to().value).toBe('31/12/2026');
    const last = control.commits[control.commits.length - 1];
    expect(last?.from).toBeUndefined();
    expect(last?.to).toBe('2026-12-31');
    expect(last?.actionIn).toEqual(['lamp.extinguish']);
  });

  it('offers no clear button while the bound is empty', () => {
    renderBar();
    expect(screen.queryAllByTestId('audit-log-from-clear')).toHaveLength(0);
  });
});

describe('the segment order', () => {
  it('is the locale’s, in the host’s words, day-first for pt-BR', () => {
    // The mask's SECOND reason. A native date input renders in the BROWSER's
    // locale, which the page cannot choose — the same field read dd/mm/aaaa for
    // one merchant and mm/dd/yyyy for the next, and the eight digits a Brazilian
    // types mean a different day under each. Here the ORDER is the declared
    // locale's and the LETTERS are the host's labels, so a pt-BR host promises
    // Portuguese instead of hoping for it.
    const control = renderBar();

    expect(from().getAttribute('placeholder')).toBe('dd/mm/aaaa');
    pressKeys(from, '01072026');
    expect(appliedFrom(control)).toBe('2026-07-01');
  });

  it('follows a different locale, and the same digits mean a different day', () => {
    const control = renderBar({ locale: 'en-US', labels: createAuditLabels() });

    expect(from().getAttribute('placeholder')).toBe('mm/dd/yyyy');
    pressKeys(from, '01072026');
    expect(appliedFrom(control)).toBe('2026-01-07');
  });
});
