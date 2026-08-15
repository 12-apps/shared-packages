/**
 * WHAT A CONTRIBUTION MUST PROVE BEFORE IT CAN BE COMPOSED — and the error it
 * fails with.
 *
 * These checks live beside each other rather than inside `./compose` because
 * they answer one question ("is this contribution well formed?") that has
 * nothing to do with assembling the union, and because every one of them was
 * added for the SAME reason: the thing being validated is DATA, and a
 * contribution is type-checked exactly once — where it is written. Assembly now
 * happens in the HOST, where a catalog is far likelier to be generated, read
 * from config or parsed from JSON behind a single `as` than typed as a literal.
 * Past that boundary the compiler has nothing left to say, so composition says
 * it instead.
 */
import type { PermissionContribution, PermissionSpec } from './contribution';

/** Why a catalog refused to assemble. Stable codes, for tests and hosts. */
export type RbacCatalogErrorCode =
  | 'PERMISSION_COLLISION'
  | 'UNKNOWN_PERMISSION'
  | 'INVALID_PERMISSION_SPEC'
  | 'UNKNOWN_ROLE';

/** A composition failure. Thrown at assembly, never during a decision. */
export class RbacCatalogError extends Error {
  readonly code: RbacCatalogErrorCode;
  constructor(code: RbacCatalogErrorCode, message: string) {
    super(message);
    this.name = 'RbacCatalogError';
    this.code = code;
    Object.setPrototypeOf(this, RbacCatalogError.prototype);
  }
}

/**
 * The OTHER direction of the id/spec agreement: a spec present in
 * `permissions` but absent from `ids`.
 *
 * `definePermissionContribution` derives `ids` from the map's keys, so this is
 * unreachable through it — but {@link PermissionContribution} is a PUBLIC
 * interface, and a factory that builds its own `ids` (an approval-permission
 * helper generating them per entity) can drift. Dropping such a spec is silent
 * and fails OPEN twice over: its `ownerMarker` never reaches
 * `ownerPermissions` (so `checkOwnerProtected` stops refusing it inside an
 * inline custom role) and its `separateFrom` never becomes a pair (so
 * `checkSoD` never fires). Both guards only ever REMOVE power, so losing one
 * shows up as nothing at all.
 */
export function assertIdsCoverSpecs(
  contribution: PermissionContribution<string>,
): void {
  const listed = new Set<string>(contribution.ids);
  const orphan = Object.keys(contribution.permissions).find((id) => !listed.has(id));
  if (orphan !== undefined) {
    throw new RbacCatalogError(
      'UNKNOWN_PERMISSION',
      `"${contribution.source}" declares a spec for "${orphan}" but leaves it out of its ids — the two must name the same set, or that spec's ownerMarker and separateFrom are dropped silently`,
    );
  }
}

const KINDS: readonly string[] = ['class', 'instance'];

const isIdList = (value: unknown): boolean =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/**
 * A spec must actually declare what its type says it declares.
 *
 * All three fields are checked for one reason: unset or malformed, each REMOVES
 * a check rather than a feature, and nothing later reports the loss.
 *
 * - `kind` was the live one. Unset, it resolved to `'class'` — RBAC alone
 *   decides and the entity gate is SKIPPED — so an instance-scoped id
 *   (`orders:read:own`, `tables:read:assigned`) granted class-wide access
 *   instead of narrowing to owned/assigned rows, and `SCOPE_CEILING` stopped
 *   refusing it at an org/parent scope. Nothing else in composition looked at
 *   the field, so a spec could be present and still register an id without it.
 * - `ownerMarker` is collected with `=== true`, so `"true"` — what a JSON or
 *   env-shaped catalog writes — is not one: the id silently becomes composable
 *   into an inline custom role and injectable into a template override.
 * - `separateFrom` is read as `?? []`, so `null` — what JSON writes for an
 *   absent list — derives no pair, and `checkSoD` never fires for a spec that
 *   says on its face that it must.
 *
 * An ABSENT optional field is a different thing and stays legal: no
 * `ownerMarker` means an ordinary permission and no `separateFrom` means no
 * duty pair, both of which a source states by omission every day. `kind` has no
 * such default — which is why it is required, and why its absence is the one
 * that fails open.
 */
export function assertSpecDeclaresItself(
  id: string,
  spec: PermissionSpec,
  source: string,
): void {
  // Read every field back as `unknown`: the declared type is precisely what is
  // not evidence here.
  const declared: {
    kind?: unknown;
    ownerMarker?: unknown;
    separateFrom?: unknown;
  } = spec;
  const at = `"${id}" (from "${source}")`;
  if (typeof declared.kind !== 'string' || !KINDS.includes(declared.kind)) {
    throw new RbacCatalogError(
      'INVALID_PERMISSION_SPEC',
      `${at} declares kind ${JSON.stringify(declared.kind) ?? 'undefined'}, which must be exactly "class" or "instance" — an unset kind resolves to "class", which skips the entity gate and grants an instance permission over every row it was meant to narrow`,
    );
  }
  if (
    declared.ownerMarker !== undefined &&
    typeof declared.ownerMarker !== 'boolean'
  ) {
    throw new RbacCatalogError(
      'INVALID_PERMISSION_SPEC',
      `${at} declares ownerMarker ${JSON.stringify(declared.ownerMarker)}, which must be a boolean — only \`true\` marks an owner permission, so any other value leaves it composable into an inline custom role`,
    );
  }
  if (declared.separateFrom !== undefined && !isIdList(declared.separateFrom)) {
    throw new RbacCatalogError(
      'INVALID_PERMISSION_SPEC',
      `${at} declares separateFrom ${JSON.stringify(declared.separateFrom)}, which must be an array of permission ids — anything else derives no pair, so the separation of duties it names is never enforced`,
    );
  }
}
