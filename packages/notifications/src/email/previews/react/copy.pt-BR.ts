import type { EmailPreviewScreenCopy } from './copy';

/** Brazilian Portuguese, as a NAMED pack — never a default. */
export const PT_BR_EMAIL_PREVIEW_COPY: EmailPreviewScreenCopy = {
  title: 'Prévia de e-mails',
  description: 'Todos os e-mails que este sistema envia, agrupados por pacote. Nada é enviado a partir daqui.',
  searchLabel: 'Filtrar',
  searchPlaceholder: 'assunto, evento ou pacote',
  noMatches: 'Nenhuma mensagem corresponde ao filtro.',
  pickOne: 'Escolha uma mensagem na lista para ver a prévia.',
  tabHtml: 'HTML',
  tabText: 'Texto',
  tabSource: 'Código',
  widthDesktop: 'Computador',
  widthMobile: 'Celular',
  subjectLabel: 'Assunto',
  frameTitle: 'Prévia do e-mail',
  coverageTitle: 'Cobertura incompleta',
  missingSamples: (keys) => `Sem dados de exemplo, então não há prévia: ${keys}.`,
  orphanSamples: (keys) => `Há exemplo, mas nada mais produz esta mensagem: ${keys}.`,
  loading: 'Carregando...',
  loadError: 'Não foi possível carregar as prévias.',
  retry: 'Tentar novamente',
};
