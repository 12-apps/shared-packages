/**
 * The audit VOCABULARY (12-14) — what a host may audit, and what a row may say.
 *
 * In future-pay this was three separate things that had to agree by hand: the
 * `AUDIT_ACTIONS` union, the `AUDIT_RESOURCE_TYPES` union, the per-resource
 * `FIELD_ALLOWLIST` — plus a FOURTH copy of the first two as pt-BR label maps
 * inside the admin SPA. They drifted: the viewer's `ACTION_LABEL` was missing
 * nine of the actions the writer could emit (every `impersonation.*`, both of
 * the over/refund payment events…), so those rows rendered their raw dotted id.
 *
 * Here they are ONE value. The server validates against it, the React viewer
 * labels from it, so an action that exists is an action the viewer can name.
 */

/** One audited action, dot-namespaced `<resource>.<event>`. */
export interface AuditActionDef {
  /** The stored value — the id the writer persists and the filter selects on. */
  id: string;
  /** What a human reads in the viewer (product copy: the host's language). */
  label: string;
}

/** One kind of thing an entry may point at, with its field allowlist. */
export interface AuditResourceDef {
  id: string;
  label: string;
  /**
   * The ONLY fields a `before`/`after` diff may carry for this resource. The
   * redaction is DENY-BY-DEFAULT: a field not listed here is dropped silently,
   * so secrets/PII can never reach a row even when a caller passes a whole
   * database row. Which also means an omission is INVISIBLE at the write site
   * and shows up as a hollow entry in the viewer — list every field both
   * writers of a shared resource type emit.
   */
  fields: readonly string[];
}

export interface AuditVocabulary {
  actions: readonly AuditActionDef[];
  resources: readonly AuditResourceDef[];
}

/** JSON-safe scalar an audit diff may carry. */
export type AuditScalar = string | number | boolean | null;

/** Thrown when a write names an action or resource the vocabulary lacks. */
export class AuditVocabularyError extends Error {
  constructor(kind: 'action' | 'resourceType', value: string) {
    super(
      `Unknown audit ${kind} "${value}". Add it to the vocabulary passed to ` +
        'createApiAudit — an unknown value cannot be redacted, filtered or labelled.',
    );
    this.name = 'AuditVocabularyError';
    Object.setPrototypeOf(this, AuditVocabularyError.prototype);
  }
}

/** The indexed vocabulary — built once, shared by the writer and the wire. */
export interface AuditVocabularyIndex {
  readonly vocabulary: AuditVocabulary;
  /** Every action id, in declaration order (the wire's allowed values). */
  readonly actionIds: readonly string[];
  /** Every resource id, in declaration order. */
  readonly resourceIds: readonly string[];
  hasAction(id: string): boolean;
  hasResource(id: string): boolean;
  /** The allowlist for a resource, or `undefined` when it is not declared. */
  allowlistFor(resourceType: string): ReadonlySet<string> | undefined;
  actionLabel(id: string): string;
  resourceLabel(id: string): string;
}

/**
 * Index a vocabulary, refusing a duplicate id.
 *
 * A duplicate is worth a throw rather than a last-one-wins Map: two entries for
 * one action mean two labels, and the one a reader sees would depend on
 * declaration order.
 */
export function indexVocabulary(vocabulary: AuditVocabulary): AuditVocabularyIndex {
  const actions = new Map<string, AuditActionDef>();
  for (const action of vocabulary.actions) {
    if (actions.has(action.id)) throw new Error(`Duplicate audit action "${action.id}".`);
    actions.set(action.id, action);
  }
  const resources = new Map<string, { def: AuditResourceDef; fields: ReadonlySet<string> }>();
  for (const resource of vocabulary.resources) {
    if (resources.has(resource.id)) throw new Error(`Duplicate audit resource "${resource.id}".`);
    resources.set(resource.id, { def: resource, fields: new Set(resource.fields) });
  }
  return {
    vocabulary,
    actionIds: [...actions.keys()],
    resourceIds: [...resources.keys()],
    hasAction: (id) => actions.has(id),
    hasResource: (id) => resources.has(id),
    allowlistFor: (resourceType) => resources.get(resourceType)?.fields,
    actionLabel: (id) => actions.get(id)?.label ?? id,
    resourceLabel: (id) => resources.get(id)?.def.label ?? id,
  };
}

/**
 * Keep only allowlisted fields, and only JSON-safe scalar values (Dates become
 * ISO strings; objects/arrays/`undefined` are dropped — a diff is flat by
 * design, so a nested value is a caller mistake, not data to persist).
 *
 * An UNKNOWN resource type throws instead of returning `{}`: silently writing a
 * hollow row to an append-only table is not recoverable, and the caller is one
 * vocabulary entry away from being right.
 */
export function redactDiff(
  index: AuditVocabularyIndex,
  resourceType: string,
  data: Record<string, unknown> | undefined,
): Record<string, AuditScalar> {
  const allowed = index.allowlistFor(resourceType);
  if (!allowed) throw new AuditVocabularyError('resourceType', resourceType);
  const redacted: Record<string, AuditScalar> = {};
  if (!data) return redacted;
  for (const [key, value] of Object.entries(data)) {
    if (!allowed.has(key)) continue;
    if (value instanceof Date) {
      redacted[key] = value.toISOString();
    } else if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      redacted[key] = value;
    }
  }
  return redacted;
}
