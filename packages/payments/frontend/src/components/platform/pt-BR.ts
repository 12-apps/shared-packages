import type { PlatformHomologacaoCopy } from './copy';

/**
 * The pt-BR pack for the platform's homologação screens.
 *
 * A NAMED pack, which is how this repo ships a language: a host imports it and
 * passes it by hand, so choosing Portuguese is a line in that host's diff
 * rather than a silence in this package.
 *
 * The English these screens rendered as literals is deliberately NOT what this
 * pack says. Those sentences were written for a developer reading the code;
 * these are written for the operator filling PagBank's form, which is the
 * register the surface is actually in.
 */
export const PT_BR_PLATFORM_HOMOLOGACAO_COPY: PlatformHomologacaoCopy = {
  outcome: {
    heading: 'Situação da homologação',
    statusLabel: 'Situação',
    notSubmitted: 'Não enviada',
    protocolLabel: 'Protocolo',
    protocolPlaceholder: 'Protocolo (card do Pipefy / chamado)',
    notesLabel: 'Observações',
    notesPlaceholder: 'Observações (resposta do PagBank, contexto…)',
    save: 'Registrar',
    saved: 'Registro atualizado.',
    statuses: { SUBMITTED: 'Enviada', APPROVED: 'Aprovada', REJECTED: 'Recusada' },
    submittedAt: (when) => `Enviada em ${when}. `,
    decidedAt: (when) => `Decidida em ${when}. `,
    recordedBy: (who) => `Registrado por ${who}.`,
  },
  guide: {
    heading: 'Formulário de homologação — respostas prontas para colar',
    ledeBeforeForm: 'Abra o ',
    formLink: 'formulário oficial de homologação',
    ledeBeforeSupport: ' e preencha com os valores abaixo. Em paralelo, abra um chamado no ',
    supportLink: 'SIP — suporte de integração PagBank',
    ledeBeforeDocs:
      ' citando o 403 ACCESS_DENIED: o que responder primeiro define se o formulário cobre o Connect. Documentação: ',
    docsLink: 'solicitar homologação',
    ledeAfterDocs: '.',
  },
  anexo: {
    heading: 'Anexo de evidências',
    body:
      'O formulário pede as requisições e as respostas das chamadas enviadas às APIs do PagBank. O arquivo é gerado a partir das chamadas reais desta plataforma, com o token redigido.',
    generate: 'Gerar anexo',
    generateFailed: 'Não foi possível gerar o anexo.',
  },
  connect: {
    expectedRedirectHeading: 'Callback que este deploy usa (o valor que precisa estar registrado)',
    consultAgain: 'Consultar de novo',
    noApplication: 'Nenhuma aplicação configurada neste ambiente.',
    redirectMatches: 'O redirect_uri registrado confere com o callback que este deploy usa.',
    redirectDiffers:
      'O redirect_uri registrado no PagBank é diferente do callback que este deploy usa.',
    redirectUnreported:
      'A resposta do PagBank não trouxe redirect_uri, então não foi possível comparar com o callback.',
    fields: {
      name: 'Nome (exibido ao lojista)',
      site: 'Site',
      description: 'Descrição',
      logo: 'Logo',
      redirectUri: 'redirect_uri registrado',
    },
    fieldEmpty: '—',
    redirectNotReported: 'não informado',
    resolvedFrom:
      'A aplicação deste ambiente é resolvida estritamente a partir destas variáveis, sem fallback entre ambientes:',
    showConfig: 'Mostrar variáveis de ambiente',
    hideConfig: 'Ocultar variáveis de ambiente',
    extraKeys: 'Outros campos retornados',
  },
};
