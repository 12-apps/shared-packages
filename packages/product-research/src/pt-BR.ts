import type { ResearchHttpMessages } from './http';
import type { ResearchDiagnosticsCopy } from './connectors/diagnostics-copy';
import type { ResearchBudgetCopy } from './notifications';

/**
 * The pt-BR packs — the origin host's words, shipped as a NAMED PACK (the
 * copy-portability doctrine): a host imports a pack and passes it BY HAND,
 * so choosing Portuguese is a line in the host's diff rather than a silent
 * default. Nothing in this package reads these itself.
 */

/** Every sentence the HTTP surface can answer with — pass to `messages`. */
export const PT_BR_RESEARCH_MESSAGES: ResearchHttpMessages = {
  credentialRefused: (reason) => `Credencial recusada pelo provedor: ${reason}`,
  sourceUrlRejected: (violation) => `URL da fonte rejeitada: ${violation}`,
  keylessSource: 'Esta fonte de preços não usa chave de aplicação.',
  incompleteCredentialFields: (fields) => `Informe todos os campos da chave: ${fields.join(', ')}.`,
  invalidQuote: 'Cotação inválida.',
};

/** The budget alert's phrasing and CTA — pass to `createResearchBudgetBlueprint`. */
export const PT_BR_RESEARCH_BUDGET_COPY: ResearchBudgetCopy = {
  title: (payload) =>
    payload.scope === 'TENANT_DAY'
      ? 'Cota diária de busca paga esgotada'
      : 'Orçamento mensal de busca paga esgotado',
  body: (payload) => {
    const tail =
      'As pesquisas continuam funcionando com as fontes gratuitas; ' +
      'a busca paga volta automaticamente no próximo período.';
    return payload.scope === 'TENANT_DAY'
      ? `A loja atingiu a cota diária de ${payload.capUnits} busca(s) paga(s) ` +
          `(${payload.sourceType}) em ${payload.period}. ${tail}`
      : `A plataforma atingiu o orçamento mensal de ${payload.capUnits} busca(s) paga(s) ` +
          `(${payload.sourceType}) em ${payload.period}. ${tail}`;
  },
  link: (payload) => `/admin/${payload.tenantSlug}/research`,
};

/**
 * The label segments this package's permission ids read in, for a pt-BR
 * host's role editor — compose beside `PRODUCT_RESEARCH_PERMISSIONS`, whose
 * own declaration deliberately carries no words.
 */
export const PT_BR_RESEARCH_PERMISSION_LABELS = {
  domains: { research: 'Pesquisa de preços' },
  actions: { read: 'Ver', write: 'Editar' },
} as const;

/**
 * Every sentence the CONNECTORS put in front of a store owner when a price
 * source fails — pass to `ConnectorContext.diagnostics`.
 *
 * Verbatim what the connector modules used to compile in, so a host adopting
 * this pack sees no change on the run screen or the sources list.
 */
export const PT_BR_RESEARCH_DIAGNOSTICS: ResearchDiagnosticsCopy = {
  manualImport: {
    unreadablePrice: (raw) => `preço não reconhecido: "${raw}"`,
    invalidEan: (raw) => `EAN inválido ignorado: "${raw}" (linha importada sem código de barras)`,
    invalidValidUntil: (raw) => `validade inválida ignorada: "${raw}" (usada a validade padrão)`,
    emptyFile: 'arquivo sem linhas de dados',
    missingRequiredColumns:
      'colunas obrigatórias não encontradas (produto e preço) — informe o mapeamento de colunas',
    unimportableRow: (path, message) =>
      `linha não importável: ${path === '' ? 'linha' : path} — ${message === '' ? 'inválida' : message}`,
  },
  fetch: {
    invalidUrl: '(endereço inválido)',
    refused: (status) => `a loja recusou nosso acesso (HTTP ${status} — bloqueio de bot ou de IP)`,
    notFound: 'o endereço não existe na loja (HTTP 404) — confira a URL',
    rateLimited: () => 'a loja limitou nossa taxa de consultas (HTTP 429 — consultas demais)',
    serverError: (status) =>
      `a loja está com erro interno (HTTP ${status}) — pode ser instabilidade momentânea`,
    rejected: (status) => `a loja recusou a consulta (HTTP ${status})`,
    dnsUnresolved: 'o domínio da loja não foi encontrado (DNS) — confira o endereço da fonte',
    dnsTransient:
      'a consulta de DNS do domínio da loja falhou — pode ser instabilidade momentânea',
    credentialsStripped:
      'a loja redireciona para outro endereço e a chave de aplicação não pode viajar junto — ' +
      'configure na fonte o endereço final da loja (normalmente o "www")',
    transport: 'falha de conexão com a loja (rede, DNS ou TLS)',
    transportCoded: (code) => `falha de conexão com a loja (rede, DNS ou TLS: ${code})`,
    notJson: (status) =>
      `a loja respondeu (HTTP ${status}) mas não em JSON — provável página de erro ou de bloqueio`,
    timeout: 'a loja não respondeu dentro do tempo limite',
    deadline: 'a busca nesta fonte atingiu o tempo total permitido antes desta consulta',
  },
  sourceConfig: {
    invalid: (sourceLabel) =>
      `Configuração da fonte ${sourceLabel} inválida — revise os campos da fonte`,
    invalidFields: (sourceLabel, fields) =>
      `Configuração da fonte ${sourceLabel} inválida — revise: ${fields.join(', ')}`,
  },
  searchApi: {
    timedOut: (budget) => `sem resposta no tempo limite de ${budget}`,
    keyRefused: (status) =>
      `chave recusada pelo provedor (HTTP ${status}) — verifique a chave da integração`,
    rateLimited: 'limite de consultas do provedor atingido (HTTP 429)',
    endpointNotFound: 'endpoint do provedor não encontrado (HTTP 404)',
    providerError: (status) =>
      `provedor com erro interno (HTTP ${status}) — instabilidade momentânea`,
    rejected: (status) => `provedor recusou a consulta (HTTP ${status})`,
    notJson: (status) =>
      `resposta HTTP ${status} não era JSON — provável página de erro do provedor`,
    creditMaybeSpent: '(o crédito pago pode ter sido consumido)',
    creditNotSpent: '(nenhum crédito pago foi consumido)',
    timedOutMaybeSpent: (budget) =>
      `sem resposta no tempo limite de ${budget} (o crédito pago pode ter sido consumido)`,
    deadlineNotSpent:
      'a busca nesta fonte atingiu o tempo total permitido antes desta consulta ' +
      '(nenhum crédito pago foi consumido)',
    transport: 'falha de conexão com o provedor (rede, DNS ou TLS)',
    transportCoded: (code) => `falha de conexão com o provedor (rede, DNS ou TLS: ${code})`,
    prefixed: (engine, reason) => `SearchApi ${engine}: ${reason}`,
    keyMissing: (engine) =>
      `SearchApi ${engine}: chave de API não configurada — conecte a integração ` +
      'de busca de preços com a chave da sua conta SearchApi.io',
    payloadShape: (engine) =>
      `SearchApi ${engine}: o provedor respondeu em um formato inesperado — ` +
      'nenhuma oferta pôde ser lida',
    vendorRefusedSilently: (engine) =>
      `SearchApi ${engine}: o provedor recusou a consulta sem informar o motivo`,
    vendorError: (engine, vendorError) =>
      `SearchApi ${engine}: o provedor recusou a consulta — resposta do provedor: "${vendorError}"`,
  },
  vtex: {
    tiers: {
      catalog: 'Busca no catálogo VTEX',
      regions: 'Consulta de regiões VTEX',
      'intelligent-search': 'Busca inteligente VTEX',
      simulation: 'Simulação de entrega VTEX',
    },
    tierFailed: (tier, reason) => `${tier} falhou: ${reason}.`,
    keyDoubt:
      ' A chave de aplicação da fonte também pode não ser mais válida — ' +
      'confira a chave em Fontes de preços.',
    endpoint: (url) => `Endereço: ${url}`,
  },
  vtexValidate: {
    urlMissing:
      'URL da loja inválida ou não informada. Informe o endereço completo, ' +
      'como https://www.loja.com.br.',
    urlHasCredentials:
      'A URL da loja não pode conter usuário e senha (o trecho antes do "@"). ' +
      'Informe apenas o endereço público da loja.',
    retryHint: 'Tente novamente em alguns minutos.',
    apexHint: (hostname) => ` Se a loja usa "www", tente https://www.${hostname}.`,
    unreachable: (reason, apexHint) =>
      'A loja não respondeu (fora do ar, bloqueando nosso acesso, ou endereço errado): ' +
      `${reason}. Confira a URL e tente novamente.${apexHint}`,
    timedOut: (retryHint, apexHint) =>
      `A loja não respondeu dentro do tempo limite. ${retryHint}${apexHint}`,
    unverifiable: (reason, retryHint) =>
      `Não foi possível validar a loja agora: ${reason}. ${retryHint}`,
    notVtex: (status, apexHint) =>
      `O endereço respondeu${status === undefined ? '' : ` (HTTP ${status})`}, mas não parece ser ` +
      `uma loja VTEX (resposta inesperada na API de catálogo). Confira a URL da loja.${apexHint}`,
    keyRejected:
      'A loja recusou a chave de aplicação informada — a mesma consulta sem chave foi aceita. ' +
      'Confira a chave e o token gerados no admin da própria loja e as permissões do papel ' +
      'no License Manager.',
    redirectsAway: (apexHint) =>
      'A loja redireciona para outro endereço e a chave de aplicação não pode viajar junto. ' +
      `Configure aqui o endereço final da loja.${apexHint}`,
  },
  budget: {
    ceilingReached:
      'A consulta a esta fonte atingiu o tempo total permitido e foi interrompida antes de ' +
      'terminar. Nenhuma oferta chegou a tempo. Tente novamente; se repetir, a loja está ' +
      'respondendo devagar demais para esta pesquisa.',
  },
};
