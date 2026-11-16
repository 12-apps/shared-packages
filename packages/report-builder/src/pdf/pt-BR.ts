import type { ReportPdfCopy } from './copy';

export const PT_BR_REPORT_PDF_COPY: ReportPdfCopy = {
  period: 'Período',
  store: 'Loja',
  generated: 'Gerado em',
  page: (current, total) => `Página ${current} de ${total}`,
  empty: 'Sem dados neste período.',
  blockError: 'Este bloco não pôde ser exibido.',
  defaultAppName: 'aplicativo',
  moreRows: (count, appName) => `e mais ${count} ${count === 1 ? 'linha' : 'linhas'} — veja no ${appName}`,
  chartTruncated: (shown, total) => `Mostrando os primeiros ${shown} de ${total} pontos.`,
  otherSlices: 'Outros',
};
