/**
 * The viewer's user-facing copy (12-14).
 *
 * pt-BR by default because that is the product copy this surface came with; a
 * host in another language passes overrides. ACTION and RESOURCE labels are NOT
 * here — they belong to the vocabulary, so the list of actions and the list of
 * their names cannot drift (in future-pay they were separate files and did:
 * nine actions the writer could emit had no label at all and rendered their raw
 * dotted id).
 */
export interface AuditLabels {
  title: string;
  /** The one-paragraph explanation above the list. */
  about: string;
  columnDate: string;
  columnActor: string;
  columnAction: string;
  columnResource: string;
  columnResourceId: string;
  columnChange: string;
  filterAction: string;
  filterResource: string;
  filterActor: string;
  filterFrom: string;
  filterTo: string;
  /** Placeholder for the free-text resource-id search. */
  searchPlaceholder: string;
  /** The actor cell for an entry with no actor (a webhook, a job). */
  systemActor: string;
  /**
   * "<actor> on behalf of <subject>" — the impersonation PAIR, rendered as one
   * line naming BOTH people. `{actor}` and `{subject}` are substituted.
   */
  onBehalfOf: string;
  /** The label for an id the directory could not resolve to a name. */
  unknownActor: string;
  loading: string;
  empty: string;
  errorTitle: string;
  retry: string;
  clearFilters: string;
  previousPage: string;
  nextPage: string;
  /** "Page {page} of {pageCount} · {total} entries". */
  pageStatus: string;
  actorAny: string;
}

export const DEFAULT_LABELS: AuditLabels = {
  title: 'Auditoria',
  about:
    'Toda ação registrada aqui é permanente: fica gravado quem fez, o que mudou e quando. ' +
    'Os registros não podem ser editados nem apagados.',
  columnDate: 'Data',
  columnActor: 'Ator',
  columnAction: 'Ação',
  columnResource: 'Recurso',
  columnResourceId: 'Identificador',
  columnChange: 'Alteração',
  filterAction: 'Ação',
  filterResource: 'Recurso',
  filterActor: 'Ator',
  filterFrom: 'De',
  filterTo: 'Até',
  searchPlaceholder: 'Buscar por identificador',
  systemActor: 'Sistema',
  onBehalfOf: '{actor} em nome de {subject}',
  unknownActor: 'Usuário removido',
  loading: 'Carregando…',
  empty: 'Nenhum evento registrado para os filtros escolhidos.',
  errorTitle: 'Não foi possível carregar a auditoria',
  retry: 'Tentar novamente',
  clearFilters: 'Limpar filtros',
  previousPage: 'Anterior',
  nextPage: 'Próxima',
  pageStatus: 'Página {page} de {pageCount} · {total} registros',
  actorAny: 'Todos',
};

export type AuditLabelOverrides = Partial<AuditLabels>;

export const createAuditLabels = (overrides?: AuditLabelOverrides): AuditLabels => ({
  ...DEFAULT_LABELS,
  ...overrides,
});

/** Fill `{name}` placeholders in a label. */
export function formatLabel(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}
