/**
 * Vocabulary of the lifecycle screens (12-17).
 *
 * WHAT USED TO BE HERE. A `DEFAULT_ENTITY_TYPE_LABELS` map of one host's
 * collections — `table: 'Mesa'`, `ingredient: 'Insumo'`,
 * `'kitchen-station': 'Estação'`, `'loss-reason': 'Motivo de perda'` — under a
 * header that called it "the same posture as rbac's default templates". That
 * posture is exactly what `@12-apps/rbac` removed: a host catalog does not
 * become generic by being the fallback.
 *
 * It was also the SUBTLE shape of the mistake rather than the loud one. The
 * factory merged it as the BASE layer (`{ ...DEFAULT, ...config }`), so a host
 * passing its own map got its entries laid on top and silently kept the other
 * host's word for every key it did not restate. A host with a `table` entity
 * that means a database table, or a pricing table, rendered "Mesa" — and had
 * supplied a labels map, so nothing about the API suggested it had not been
 * heard.
 *
 * The labels are the host's, whole. An entity type with no label renders as its
 * RAW KEY, which is honest, never crashes, and is the zero-config behaviour: a
 * host that passes nothing sees `kitchen-station`, not somebody else's noun.
 */

export type EntityTypeLabels = Record<string, string>;

export function entityTypeLabel(labels: EntityTypeLabels, entityType: string): string {
  return labels[entityType] ?? entityType;
}

/** Deletion/request stamp, pt-BR (date + time). */
export const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
});
