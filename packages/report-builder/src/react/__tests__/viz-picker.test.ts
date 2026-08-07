import { describe, expect, it } from 'vitest';

import { blockedReasons } from '../viz-picker';

/**
 * FUT-391's acceptance for the viz picker: "every disabled option has a
 * visible reason, not just a grey state."
 *
 * Grey says "no" without saying why, so an author whose pie chart is
 * unavailable has to guess which of their choices caused it — while
 * `presentationCompatibility` already knows and returns the sentence.
 */
const OPTION = (
  value: 'table' | 'kpi' | 'line' | 'bar' | 'pie',
  label: string,
  disabledReason: string | null,
) => ({ value, label, disabledReason });

describe('blockedReasons', () => {
  it('returns one labelled reason per blocked option', () => {
    const reasons = blockedReasons([
      OPTION('bar', 'Barras', null),
      OPTION('kpi', 'KPI (número único)', 'Um número único não usa agrupamento.'),
      OPTION('pie', 'Pizza', 'Fatias demais para ler.'),
    ]);

    expect(reasons).toEqual([
      { value: 'kpi', text: 'KPI (número único): Um número único não usa agrupamento.' },
      { value: 'pie', text: 'Pizza: Fatias demais para ler.' },
    ]);
  });

  it('says nothing when every option is available', () => {
    expect(
      blockedReasons([OPTION('bar', 'Barras', null), OPTION('line', 'Linha', null)]),
    ).toEqual([]);
  });

  it('labels each reason with its option, so a list of them is readable', () => {
    // Several blocked options render as a stack of sentences; without the
    // option name they read as unattributed complaints about the spec.
    const reasons = blockedReasons([
      OPTION('kpi', 'KPI', 'motivo A'),
      OPTION('pie', 'Pizza', 'motivo B'),
    ]);
    expect(reasons.map((entry) => entry.text)).toEqual(['KPI: motivo A', 'Pizza: motivo B']);
  });

  it('explains the SELECTED option too, not only the others', () => {
    // The old Select showed the selected option's reason and nothing else;
    // this shows every one, which must still include the current selection
    // when an edit has just invalidated it.
    const reasons = blockedReasons([OPTION('pie', 'Pizza', 'Fatias demais para ler.')]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.value).toBe('pie');
  });
});
