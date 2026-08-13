/**
 * pt-BR vocabulary of the lifecycle screens (12-17). The entity-type labels
 * default to future-pay's catalog — the same posture as rbac's default
 * templates: future-pay adopts with zero config, any other host merges its
 * own map in. An unknown type renders as its raw key, never crashes.
 */

export type EntityTypeLabels = Record<string, string>;

/** future-pay's known collections (recycle-bin + approvals pages, verbatim). */
export const DEFAULT_ENTITY_TYPE_LABELS: EntityTypeLabels = {
  product: 'Produto',
  category: 'Categoria',
  supplier: 'Fornecedor',
  ingredient: 'Insumo',
  table: 'Mesa',
  role: 'Papel',
  sector: 'Setor',
  'kitchen-station': 'Estação',
  'stock-location': 'Local de estoque',
  'loss-reason': 'Motivo de perda',
};

export function entityTypeLabel(labels: EntityTypeLabels, entityType: string): string {
  return labels[entityType] ?? entityType;
}

/** Deletion/request stamp, pt-BR (date + time). */
export const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});
