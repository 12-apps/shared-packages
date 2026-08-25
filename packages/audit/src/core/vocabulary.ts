/**
 * The audit VOCABULARY — what a host may audit, and what a row may say.
 *
 * The SHAPE is generic and is what this package owns: an audited action is a
 * closed, labelled id; a resource type is a closed, labelled id carrying a
 * DENY-BY-DEFAULT field allowlist; and the set a write is validated against is
 * the set a read is narrowed with.
 *
 * The VALUES are not generic and are not here. Which actions exist, what they
 * are called, which resources a trail points at and which of their fields a
 * diff may carry are facts about the adopting application — its product, its
 * regulator, its language. They arrive through {@link defineAuditVocabulary}.
 *
 * That last shape property is the reason this is an object rather than two
 * loose arrays. {@link AuditVocabulary.actionIds} is what the listing
 * endpoint's filter enum is built from; {@link AuditVocabulary.hasAction} is
 * what the writer validates against. Restating membership on either side is how
 * the two come to disagree — a value the writer emits that the filter refuses,
 * or the reverse — so `hasAction` is derived FROM `actionIds`, both from one
 * frozen copy, and there is no second statement of the set to fall behind.
 */
import { type AuditCopyContext, type AuditCopySource, readLabel, requireLabel } from './copy';
import { AuditConfigError, AuditVocabularyError, describe } from './errors';

/** JSON-safe scalar an audit diff may carry. */
export type AuditScalar = string | number | boolean | null;

/** What a host declares about ONE audited action. */
export interface AuditActionSpec {
  /**
   * What a human reads in the viewer. USER-FACING product copy, so it is the
   * host's language and never this package's.
   *
   * Required, and refused when blank. A declared action with no label is the
   * exact drift this one value exists to close: the extraction origin kept its
   * action list and its label map in two files in two apps, nine actions the
   * writer could emit had no label at all, and those rows rendered a raw dotted
   * id to an operator. The read path still falls back to the id for an entry
   * written before a rename — that is defensive, and a different thing from
   * declaring an action nobody named.
   *
   * May be a RESOLVER, and that is the only part of a vocabulary that may be:
   * an audit log is opened by whichever operator is looking, so the words
   * follow the REQUEST rather than the deployment. See {@link AuditVocabulary}
   * for why the ids around this field deliberately cannot.
   */
  readonly label: AuditCopySource<string>;
}

/** What a host declares about ONE kind of thing an entry may point at. */
export interface AuditResourceSpec {
  /** What a human reads. Host copy, and a resolver where it follows a reader. */
  readonly label: AuditCopySource<string>;
  /**
   * The ONLY fields a `before`/`after` diff may carry for this resource.
   *
   * DENY-BY-DEFAULT: a field not listed is dropped silently, so secrets and PII
   * cannot reach a row even when a caller passes a whole database row. Which
   * also means an omission is INVISIBLE at the write site and shows up as a
   * hollow entry — list every field EVERY writer of a shared resource type
   * emits.
   *
   * May not be empty: see {@link defineAuditVocabulary}.
   */
  readonly fields: readonly string[];
}

/** What a host declares to build a vocabulary. */
export interface AuditVocabularySpec<
  Action extends string = string,
  Resource extends string = string,
> {
  /** Audited actions, keyed by the id the writer persists and a filter selects on. */
  readonly actions: Readonly<Record<Action, AuditActionSpec>>;
  /** Resource kinds, keyed by the id an entry stores in `resource_type`. */
  readonly resources: Readonly<Record<Resource, AuditResourceSpec>>;
}

/**
 * The brand every entry point checks for.
 *
 * Registered globally (`Symbol.for`) rather than module-locally on purpose:
 * this package publishes SOURCE, so a consumer tree can legitimately evaluate
 * two copies of this module — and a module-local symbol would make a vocabulary
 * built by one copy fail the check in the other, which is a refusal with no
 * defect behind it.
 */
const VOCABULARY_BRAND = Symbol.for('@12-apps/audit.vocabulary');

/**
 * A vocabulary, assembled and guarded. The value both halves of the package
 * take, and the one a host passes to BOTH of them.
 */
export interface AuditVocabulary<
  Action extends string = string,
  Resource extends string = string,
> {
  /** Proof this came from {@link defineAuditVocabulary}. */
  readonly [VOCABULARY_BRAND]: true;
  /**
   * Every action id, in declaration order — the wire's allowed filter values.
   *
   * A non-empty tuple because that is what schema libraries ask for (`z.enum`
   * and its equivalents refuse an unbounded `string[]`), and because the
   * emptiness assembly refuses should also be a thing an adopter's compiler
   * knows. Order is preserved: it is the order the viewer renders its pills in.
   */
  readonly actionIds: readonly [Action, ...Action[]];
  /** Every resource id, in declaration order. */
  readonly resourceIds: readonly [Resource, ...Resource[]];
  /** THE action predicate. Takes `unknown`: the value is usually off a wire. */
  hasAction(id: unknown): id is Action;
  /** THE resource predicate. */
  hasResource(id: unknown): id is Resource;
  /** The allowlist for a resource, or `undefined` when it is not declared. */
  allowlistFor(resourceType: string): ReadonlySet<string> | undefined;
  /**
   * The label for an action, for ONE reader; falls back to the raw id for an
   * unknown one.
   *
   * **The only locale-aware member of this interface, on purpose.** Everything
   * above it — the ids, the two predicates, the field allowlist — is wire
   * vocabulary: values a writer persists, a filter enum advertises and a parser
   * matches on. If those followed a reader, the same row would validate for one
   * operator and be refused for the next, and a diff column would vanish for
   * whoever read it in the other language. So the copy axis stops at the label,
   * and the shape is what stops it: a resolver can only ever be reached through
   * the two accessors, and there is nowhere to hang one on an id.
   *
   * Pass the reader's tag at the moment the label is rendered. Omitting the
   * context is legal and means "nobody said" — see {@link AuditCopyContext}.
   */
  actionLabel(id: string, context?: AuditCopyContext): string;
  /** The label for a resource, for ONE reader. See {@link AuditVocabulary.actionLabel}. */
  resourceLabel(id: string, context?: AuditCopyContext): string;
}

/** The action union a vocabulary carries — what a host names its own type. */
export type AuditActionOf<V> = V extends AuditVocabulary<infer Action, string> ? Action : never;
/** The resource union a vocabulary carries. */
export type AuditResourceOf<V> =
  V extends AuditVocabulary<string, infer Resource> ? Resource : never;

/**
 * Build a vocabulary, refusing at ASSEMBLY anything that would make it unsafe
 * later. Every refusal below is a fail-OPEN this package would otherwise ship.
 *
 * - **No actions, or no resources.** The tempting reading is "declare nothing
 *   and nothing is audited", which sounds like a closed door. It is not what
 *   happens: the writer throws for every action and {@link redactDiff} throws
 *   for every resource type, INSIDE each caller's transaction — so a vocabulary
 *   a host assembled from a settings table that came back empty rolls back
 *   every audited mutation in the application, at runtime, with the process
 *   having started green.
 * - **An empty `fields`.** The resource is then declared, so nothing throws,
 *   and every field of every diff for it is dropped: the trail records that
 *   something changed without recording what to, permanently, on an
 *   append-only table. Declaring a resource and declaring nothing it may say is
 *   a wiring bug, not a way to switch a resource off.
 * - **A blank label.** The viewer renders an empty cell where an operator
 *   expects the name of what happened.
 * - **A value with surrounding whitespace.** What a comma-separated setting or
 *   an environment variable produces, and the malformation whose consequences
 *   are all silent: a padded FIELD never matches the key the caller emits, so
 *   that column disappears from every diff for that resource; a padded ACTION
 *   id is advertised padded in the filter enum while the writer refuses the
 *   unpadded id every mutation actually sends.
 * - **A blank id.** Admitted by every "is it filled in" check a host has, so an
 *   unset value validates as a deliberate declaration.
 * - **An integer-like id** (`"0"`, `"12"`). Declaration order is part of this
 *   surface — the filter enum and the viewer's pills read it — and a JavaScript
 *   object lists integer-like keys FIRST whatever order they were written in.
 *   The reordering is silent and moves a published schema.
 *
 * Ids are map KEYS, so a duplicate cannot be expressed: `{'a.b': x, 'a.b': y}`
 * is one entry. That is deliberate — the old array form made two labels for one
 * action possible, and which one a reader saw depended on declaration order. A
 * host building the map programmatically should note that the same collapse
 * applies there, silently.
 *
 * The declared values are COPIED and frozen, so a host that keeps a reference
 * to the object it passed in cannot later widen the set a filter enum was
 * already built from while the write predicate follows along.
 */
export function defineAuditVocabulary<
  const Action extends string,
  const Resource extends string,
>(spec: AuditVocabularySpec<Action, Resource>): AuditVocabulary<Action, Resource> {
  const actions = requireMap<AuditActionSpec>('actions', spec?.actions);
  const resources = requireMap<AuditResourceSpec>('resources', spec?.resources);
  const actionIds = freezeIds('actions', Object.keys(actions) as Action[]);
  const resourceIds = freezeIds('resources', Object.keys(resources) as Resource[]);

  const actionLabels = new Map<string, AuditCopySource<string>>(
    actionIds.map((id) => [id, requireLabel(`actions["${id}"].label`, actions[id]?.label)]),
  );
  const resourceLabels = new Map<string, AuditCopySource<string>>(
    resourceIds.map((id) => [id, requireLabel(`resources["${id}"].label`, resources[id]?.label)]),
  );
  const allowlists = new Map<string, ReadonlySet<string>>(
    resourceIds.map((id) => [id, freezeFields(id, resources[id]?.fields)]),
  );

  // The membership tests, stated ONCE and derived from the frozen ids. The
  // writer, the redaction and the listing endpoint's filter enum all route
  // through these, so the write side and the read side have nothing to drift
  // apart from.
  const actionSet = new Set<string>(actionIds);
  const resourceSet = new Set<string>(resourceIds);

  return Object.freeze({
    [VOCABULARY_BRAND]: true,
    actionIds,
    resourceIds,
    hasAction: (id: unknown): id is Action => typeof id === 'string' && actionSet.has(id),
    hasResource: (id: unknown): id is Resource => typeof id === 'string' && resourceSet.has(id),
    allowlistFor: (resourceType: string) => allowlists.get(resourceType),
    actionLabel: (id: string, context: AuditCopyContext = {}) =>
      readLabel(actionLabels.get(id), id, context),
    resourceLabel: (id: string, context: AuditCopyContext = {}) =>
      readLabel(resourceLabels.get(id), id, context),
  }) as AuditVocabulary<Action, Resource>;
}

/**
 * A vocabulary that came from {@link defineAuditVocabulary}, or a config error.
 *
 * Called by EVERY entry point that takes one, because a guard reachable only
 * from the newest factory is a guard the adopter never meets. `AuditVocabulary`
 * is a published interface and its fields are erased at runtime, so a host
 * assembling the object by hand — or restoring one through `JSON.parse` of a
 * cached config — would otherwise reach the writer with a value none of the
 * refusals above ever saw.
 */
export function assertAuditVocabulary(
  value: unknown,
  path = 'vocabulary',
): AuditVocabulary<string, string> {
  const candidate = value as AuditVocabulary<string, string> | null | undefined;
  if (!candidate || candidate[VOCABULARY_BRAND] !== true) {
    throw new AuditConfigError(
      path,
      'must be the value defineAuditVocabulary() returned. A hand-built object ' +
        'skips every assembly refusal, so an empty allowlist or an unlabelled ' +
        'action would reach the writer unchecked.',
    );
  }
  return candidate;
}

/**
 * Keep only allowlisted fields, and only JSON-safe scalar values (Dates become
 * ISO strings; objects, arrays and `undefined` are dropped — a diff is flat by
 * design, so a nested value is a caller mistake rather than data to persist).
 *
 * An UNKNOWN resource type throws instead of returning `{}`: silently writing a
 * hollow row to an append-only table is not recoverable, and the caller is one
 * vocabulary entry away from being right.
 */
export function redactDiff(
  vocabulary: AuditVocabulary<string, string>,
  resourceType: string,
  data: Record<string, unknown> | undefined,
): Record<string, AuditScalar> {
  const allowed = vocabulary.allowlistFor(resourceType);
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

/** One axis's declaration map, or a config error that names the axis. */
function requireMap<T>(path: 'actions' | 'resources', map: unknown): Record<string, T> {
  if (typeof map !== 'object' || map === null || Array.isArray(map)) {
    throw new AuditConfigError(path, 'must be an object keyed by id.');
  }
  return map as Record<string, T>;
}

/** The declared ids as a frozen, non-empty tuple — or a config error. */
function freezeIds<Id extends string>(
  path: 'actions' | 'resources',
  declared: Id[],
): readonly [Id, ...Id[]] {
  const [first, ...rest] = declared;
  if (first === undefined) {
    throw new AuditConfigError(
      path,
      'must declare at least one entry — with none, every audited write throws ' +
        "inside its caller's transaction, so the host's mutations roll back at " +
        'runtime while assembly stays green.',
    );
  }
  for (const id of [first, ...rest]) requireId(path, id);
  return Object.freeze([first, ...rest]) as readonly [Id, ...Id[]];
}

/** A usable id: non-blank, unpadded, and not one a JS object would re-sort. */
function requireId(path: string, id: string): void {
  if (id.trim() === '') {
    throw new AuditConfigError(path, 'an id may not be blank.');
  }
  if (id !== id.trim()) {
    throw new AuditConfigError(
      path,
      `${describe(id)} has surrounding whitespace — declare it as "${id.trim()}". ` +
        'A value split out of a comma-separated setting is the usual cause, and ' +
        'every consequence of keeping the space is silent.',
    );
  }
  if (String(Number.parseInt(id, 10)) === id) {
    throw new AuditConfigError(
      path,
      `${describe(id)} is an integer-like id. Declaration order is part of this ` +
        'surface (the filter enum and the viewer pills read it), and a JavaScript ' +
        'object lists integer-like keys first whatever order they were written in.',
    );
  }
}


/** One resource's allowlist as a frozen set — or a config error. */
function freezeFields(resource: string, fields: unknown): ReadonlySet<string> {
  const path = `resources["${resource}"].fields`;
  if (!Array.isArray(fields)) {
    throw new AuditConfigError(path, 'must be an array of field names.');
  }
  if (fields.length === 0) {
    throw new AuditConfigError(
      path,
      'must name at least one field — deny-by-default means an empty allowlist ' +
        'drops every field of every diff for this resource, silently, onto an ' +
        'append-only table that then records that something changed without ' +
        'recording what to.',
    );
  }
  const allowed = new Set<string>();
  for (const field of fields as unknown[]) requireField(path, field, allowed);
  return allowed;
}

/** One allowlist entry, added to the set it will be read back out of. */
function requireField(path: string, field: unknown, allowed: Set<string>): void {
  if (typeof field !== 'string' || field.trim() === '') {
    throw new AuditConfigError(path, 'every field must be a non-blank string.');
  }
  if (field !== field.trim()) {
    throw new AuditConfigError(
      path,
      `${describe(field)} has surrounding whitespace — declare it as ` +
        `"${field.trim()}". A padded field never matches the key a caller emits, ` +
        'so that column silently disappears from every diff for this resource.',
    );
  }
  if (allowed.has(field)) {
    throw new AuditConfigError(path, `${describe(field)} is declared more than once.`);
  }
  allowed.add(field);
}
