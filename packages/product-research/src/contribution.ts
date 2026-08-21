/**
 * THIS PACKAGE'S OWN PERMISSION CONTRIBUTION (the report-builder shape,
 * declared structurally — this package depends on no RBAC; a host may run
 * any, or none, and `composePermissions` accepts the twin unchanged).
 *
 * Two ids, and deliberately only two. Read is "see runs and ranked offers";
 * write starts researches and configures sources — it spends outbound calls
 * and, where a paid connector is configured, paid-API budget, which is why
 * it is a distinct grant rather than a wider read. No `research:approve`:
 * a run produces information, not a commitment. The origin host declared
 * exactly these ids in its own catalog; the contribution moves their
 * ownership to the package whose routes check them (`./http` marks every
 * descriptor with one of the two), so a host adopting the http capability
 * composes the ids from the same place the routes come from.
 *
 * The declaration carries NO label words: segment labels are host copy, so
 * the pt-BR vocabulary ships as `PT_BR_RESEARCH_PERMISSION_LABELS` in the
 * `./pt-BR` named pack, for a host to compose beside this contribution by
 * hand — a line in its diff, never a silent default.
 */

/** Twin of the wiring contract's `WirePermissionSpec` (kind required). */
interface ResearchPermissionSpec {
  readonly kind: 'class' | 'instance';
  readonly label?: string;
}

/** Twin of the wiring contract's `WirePermissionsContribution`. */
export interface ResearchPermissionsContribution {
  readonly source: string;
  readonly ids: readonly string[];
  readonly permissions: Readonly<Record<string, ResearchPermissionSpec>>;
  readonly labels?: {
    readonly domains?: Readonly<Record<string, string>>;
    readonly actions?: Readonly<Record<string, string>>;
  };
}

export const PRODUCT_RESEARCH_PERMISSIONS: ResearchPermissionsContribution = {
  source: '@12-apps/product-research',
  ids: ['research:read', 'research:write'],
  permissions: {
    /** See requests, runs, ranked offers, the source roster and price lists. */
    'research:read': { kind: 'class' },
    /** Start researches; configure sources, keys and integrations. */
    'research:write': { kind: 'class' },
  },
};
