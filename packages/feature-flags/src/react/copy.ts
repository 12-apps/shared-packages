/**
 * Every string the management surface renders, overridable per host. The
 * DEFAULTS are pt-BR — the origin host's audience — so a pt-BR host writes
 * zero copy; any other host overrides the whole object.
 */

export interface FeatureFlagsCopy {
  readonly title: string;
  readonly subtitle: string;
  readonly flagsEmpty: string;
  readonly selectPrompt: string;
  readonly grantsEmpty: string;
  readonly loadError: string;
  readonly addEmailLabel: string;
  readonly addNoteLabel: string;
  readonly addSubmit: string;
  readonly adding: string;
  readonly enable: string;
  readonly disable: string;
  readonly revoke: string;
  readonly statusOn: string;
  readonly statusOff: string;
  readonly thUser: string;
  readonly thNote: string;
  readonly thStatus: string;
  readonly thActions: string;
  readonly grantedByPrefix: string;
  readonly prev: string;
  readonly next: string;
  /** Placeholders: `{page}`, `{pages}`, `{total}`. */
  readonly pageOf: string;
  readonly orphansTitle: string;
  readonly orphansHint: string;
  /** Placeholders: `{enabled}`, `{total}`. */
  readonly tally: string;
}

export const DEFAULT_FEATURE_FLAGS_COPY: FeatureFlagsCopy = {
  title: "Recursos beta",
  subtitle: "Conceda recursos em teste a usuários específicos.",
  flagsEmpty: "Nenhum recurso beta no catálogo.",
  selectPrompt: "Selecione um recurso para gerenciar os testadores.",
  grantsEmpty: "Nenhum usuário neste recurso.",
  loadError: "Não foi possível carregar.",
  addEmailLabel: "E-mail do usuário",
  addNoteLabel: "Observação (opcional)",
  addSubmit: "Conceder acesso",
  adding: "Concedendo...",
  enable: "Ativar",
  disable: "Desativar",
  revoke: "Revogar",
  statusOn: "Ativo",
  statusOff: "Desativado",
  thUser: "Usuário",
  thNote: "Observação",
  thStatus: "Situação",
  thActions: "Ações",
  grantedByPrefix: "concedido por",
  prev: "Anterior",
  next: "Próxima",
  pageOf: "Página {page} de {pages} — {total} concessões",
  orphansTitle: "Concessões órfãs",
  orphansHint: "Concessões de recursos que saíram do catálogo. Revogue-as ao aposentar um recurso.",
  tally: "{enabled} de {total} ativos",
};

export function formatCopy(template: string, values: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}
