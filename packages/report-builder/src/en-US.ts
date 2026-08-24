import type { ReportEngineCopy } from './copy';

/**
 * The en-US pack for the engine half — a NAMED constant a host passes by hand
 * (`copy: EN_US_REPORT_ENGINE_COPY`), never a default.
 *
 * `spec.locale` is part of the pack rather than derived, and it is what
 * `format.ts` formats values with: the sentence under a chart and the numbers
 * in it have to be written for the same reader.
 *
 * `connectives` is the one entry that is DERIVED from the others rather than
 * chosen, and getting it wrong is silent: it lists every phrase the members
 * below join with, longest first, so the surface can take a rendered sentence
 * apart again. The English list is the English joins — `, split by `,
 * `, where `, `, top `, ` by `, ` in ` from {@link sentence}, ` per ` from
 * {@link ratio}, and ` and ` / `, ` from {@link list}. A phrase changed above
 * and not here reads as part of a field name.
 */
export const EN_US_REPORT_ENGINE_COPY: ReportEngineCopy = {
  spec: {
    locale: 'en-US',
    aggregations: {
      sum: 'sum',
      avg: 'average',
      count: 'count',
      count_distinct: 'distinct count',
      min: 'minimum',
      max: 'maximum',
      p50: 'median',
      // The percentile names are notation, not words: p90 is p90 in any
      // language, and an operator comparing two reports needs them identical.
      p90: 'p90',
      p95: 'p95',
      ratio: 'ratio',
    },
    grains: {
      day: 'day',
      week: 'week',
      month: 'month',
    },
    // Read as `<field> <operator> <value>`, so each phrase completes a sentence
    // about the field: "status is Paid", "total is at least 100".
    operators: {
      eq: 'is',
      neq: 'is not',
      in: 'is one of',
      gte: 'is at least',
      lte: 'is at most',
      between: 'is between',
    },
    measure: (aggregation, field) => `${aggregation} of ${field}`,
    ratio: (measure, denominator) => `${measure} per ${denominator}`,
    dimension: (field, grain) => `${field} (${grain})`,
    filter: (field, operator, operand) => `${field} ${operator} ${operand}`,
    between: (from, to) => `${from} and ${to}`,
    list: (parts) => {
      if (parts.length <= 1) return parts[0] ?? '';
      return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    },
    sentence: ({ measures, entity, groupBy, splitBy, filters, limit }) => {
      let sentence = `${measures} in ${entity}`;
      if (groupBy) {
        sentence += ` by ${groupBy}`;
        // The clause borrows the control's own words ("Split into series"), so
        // the sentence under a chart and the field that produced it agree.
        if (splitBy) sentence += `, split by ${splitBy}`;
      }
      if (filters) sentence += `, where ${filters}`;
      // A limit without a sort is still a top N — the compiler applies the
      // spec's default ordering — so it is worth saying either way.
      if (limit !== undefined) sentence += `, top ${limit}`;
      return sentence;
    },
    connectives: [
      ', split by ',
      ', where ',
      ', top ',
      ' and ',
      ' per ',
      ' by ',
      ' in ',
      ', ',
    ],
  },
  labels: {
    grains: {
      day: 'day',
      week: 'week',
      month: 'month',
    },
    qualifiers: {
      count: 'count',
      avg: 'average',
      ratio: 'ratio',
    },
    qualified: (base, qualifier) => `${base} (${qualifier})`,
    othersBucket: 'Other',
    emptySplit: '(no value)',
    emptyTable: 'No data for this period.',
  },
  // Each of these says what is WRONG and what to do about it — either change
  // the field or pick a different presentation. A translation that kept only
  // the diagnosis would leave an operator stuck on a disabled control with no
  // idea which of two things to change.
  presentation: {
    needsGrouping:
      'A chart needs a grouping. Choose a “group by”, or use Number.',
    kpiTakesNoGrouping:
      'A single number takes no grouping. Remove the “group by” to choose it.',
    tableTakesAGrouping:
      'With no grouping the table would have one row. Choose a “group by”, or use Number.',
    stackTakesTwoSeries:
      'Stacking needs more than one series. Choose a “split into series”, or add another measure.',
    roundTakesNoSplit:
      'Pie and doughnut show the make-up of one series. Remove the “split into series” to choose them.',
    roundTakesOneMeasure:
      'Pie and doughnut show one measure. Leave a single measure to choose them.',
    splitTakesOneMeasure:
      'Splitting into series already uses one series per value. Leave a single measure, or remove the “split into series”.',
    lineNeedsOrderedAxis:
      'Line and area join one point to the next, so the “group by” has to have an order — a date, an hour or a weekday. Change the grouping, or use Bars.',
  },
  values: {
    booleanTrue: 'Yes',
    booleanFalse: 'No',
  },
};
