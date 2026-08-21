import type { ReportEngineCopy } from './copy';

/**
 * The pt-BR pack for the engine half — a NAMED constant a host passes by hand
 * (`copy: PT_BR_REPORT_ENGINE_COPY`), never a default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence here is VERBATIM
 * what the package used to compile in, so a host adopting it sees no change on
 * screen — what changes is that the words are now chosen in a diff.
 */
export const PT_BR_REPORT_ENGINE_COPY: ReportEngineCopy = {
  spec: {
    locale: 'pt-BR',
    aggregations: {
      sum: 'soma',
      avg: 'média',
      count: 'contagem',
      count_distinct: 'contagem distinta',
      min: 'mínimo',
      max: 'máximo',
      p50: 'mediana',
      p90: 'p90',
      p95: 'p95',
      ratio: 'proporção',
    },
    grains: {
      day: 'dia',
      week: 'semana',
      month: 'mês',
    },
    // Read as `<campo> <operador> <valor>`, so each phrase completes a sentence
    // about the field: "status é Pago", "total é maior ou igual a 100".
    operators: {
      eq: 'é',
      neq: 'não é',
      in: 'é um de',
      gte: 'é maior ou igual a',
      lte: 'é menor ou igual a',
      between: 'está entre',
    },
    measure: (aggregation, field) => `${aggregation} de ${field}`,
    ratio: (measure, denominator) => `${measure} por ${denominator}`,
    dimension: (field, grain) => `${field} (${grain})`,
    filter: (field, operator, operand) => `${field} ${operator} ${operand}`,
    between: (from, to) => `${from} e ${to}`,
    list: (parts) => {
      if (parts.length <= 1) return parts[0] ?? '';
      return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
    },
    sentence: ({ measures, entity, groupBy, splitBy, filters, limit }) => {
      let sentence = `${measures} em ${entity}`;
      if (groupBy) {
        sentence += ` por ${groupBy}`;
        // The clause borrows the control's own words ("Separar em séries"), so
        // the sentence under a chart and the field that produced it agree.
        if (splitBy) sentence += `, separado por ${splitBy}`;
      }
      if (filters) sentence += `, onde ${filters}`;
      // A limit without a sort is still a top N — the compiler applies the
      // spec's default ordering — so it is worth saying either way.
      if (limit !== undefined) sentence += `, top ${limit}`;
      return sentence;
    },
  },
  labels: {
    grains: {
      day: 'dia',
      week: 'semana',
      month: 'mês',
    },
    qualifiers: {
      count: 'contagem',
      avg: 'média',
      ratio: 'proporção',
    },
    qualified: (base, qualifier) => `${base} (${qualifier})`,
  },
  presentation: {
    needsGrouping:
      'Um gráfico precisa de um agrupamento. Escolha um “agrupar por” ou use Número.',
    kpiTakesNoGrouping:
      'Um número único não usa agrupamento. Tire o “agrupar por” para escolher.',
    tableTakesAGrouping:
      'Sem agrupamento a tabela teria uma linha só. Escolha um “agrupar por” ou use Número.',
    stackTakesTwoSeries:
      'Empilhar precisa de mais de uma série. Escolha um “separar em séries” ou adicione outra medida.',
    roundTakesNoSplit:
      'Pizza e rosca mostram a composição de uma série só. Tire o “separar em séries” para escolher.',
    roundTakesOneMeasure:
      'Pizza e rosca mostram uma medida só. Deixe apenas uma medida para escolher.',
    splitTakesOneMeasure:
      'Separar em séries já usa uma série por valor. Deixe apenas uma medida, ou tire o “separar em séries”.',
    lineNeedsOrderedAxis:
      'Linha e área ligam um ponto ao outro, então o “agrupar por” precisa ter ordem — data, hora ou dia da semana. Troque o agrupamento ou use Barras.',
  },
  values: {
    booleanTrue: 'Sim',
    booleanFalse: 'Não',
  },
};
