import type { BlankBlockTemplateCopy } from './block-templates';
import type { ReportServerMessages } from './messages';

/**
 * The pt-BR pack for the API half — a NAMED constant a host passes by hand
 * (`messages: PT_BR_REPORT_SERVER_MESSAGES`), never a default.
 *
 * The filename is what exempts this file from the copy-portability gate:
 * Portuguese may ship, it may not be silent. Every sentence is VERBATIM what
 * the routes used to answer with, so a host adopting it sees no change on the
 * wire.
 */
export const PT_BR_REPORT_SERVER_MESSAGES: ReportServerMessages = {
  unauthenticated: 'Não autenticado.',
  forbidden: 'Acesso negado.',
  notFound: 'Relatório não encontrado.',
  invalidBody: 'Corpo inválido.',
  forbiddenCreate: 'Sem permissão para criar relatórios.',
  forbiddenEdit: 'Sem permissão para editar relatórios.',
  forbiddenDelete: 'Sem permissão para remover relatórios.',
  duplicateName: 'Já existe um relatório com esse nome.',
  nameRequired: 'name: Dê um nome ao relatório.',
  publishedOnlyKeepsDraft:
    'Só um relatório publicado guarda alterações não publicadas. Salve o rascunho normalmente.',
  noWorkingCopy: 'Este relatório não tem alterações não publicadas.',
  range: {
    datesRequired: 'Informe as datas inicial e final do período.',
    invalidDate: 'Data inválida.',
    endBeforeStart: 'A data final deve ser igual ou posterior à inicial.',
    tooLong: (maxDays) => `O período não pode exceder ${maxDays} dias.`,
    isoFormat: 'Use o formato AAAA-MM-DD.',
    customNeedsBothDates: 'Informe `from` e `to` para o período personalizado.',
  },
};

/** The pt-BR words for the blank block template and the group it sits in. */
export const PT_BR_BLANK_BLOCK_TEMPLATE_COPY: BlankBlockTemplateCopy = {
  title: 'Bloco em branco',
  description: 'Escolha os dados e as medidas você mesmo',
  groupTitle: 'Do zero',
};
