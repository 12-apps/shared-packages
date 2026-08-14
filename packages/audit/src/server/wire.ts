/**
 * The listing endpoint's query contract.
 *
 * Authored ONCE, as a zod schema built per-vocabulary, because the advertised
 * filter values and the writable values must not be able to drift: the enum a
 * caller may filter on IS the action list the writer validates against. A host
 * that advertises this endpoint as a tool (an MCP registry, an OpenAPI doc) uses
 * this same schema rather than restating it.
 *
 * What the schema deliberately does NOT accept: anything naming a tenant. No
 * `clientId`, no `tenantId`, no `where`. The tenant comes from the resolved actor
 * and nowhere else, and zod's default strip means a request that adds one gets it
 * dropped instead of honoured.
 */
import { z } from 'zod';

import type { AuditVocabulary } from '../core/vocabulary';

import {
  AuditApiError,
  DEFAULT_PAGINATION,
  type AuditMessages,
  type AuditPagingPolicy,
} from './config';

/**
 * A calendar date (`YYYY-MM-DD`), interpreted at UTC midnight by the API.
 *
 * These two strings never reach a user: `parseAuditLogQuery` folds any failure
 * into the host's own `messages.invalidQuery` plus the field path. They are
 * developer-facing, and therefore English, like every other identifier and
 * comment in this package — the host's copy is the thing that gets translated.
 */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected the format YYYY-MM-DD.')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Not a valid date.');

/**
 * Comma-separated pill values, validated against a closed vocabulary.
 *
 * An empty result becomes `undefined` — NO FILTER — rather than `[]`. `?action_in=`
 * (and `?action_in=,,`) would otherwise reach `buildAuditWhere` as a truthy empty
 * array and emit `action: { in: [] }`, which matches nothing: a hand-built URL, or
 * a second client that serializes a cleared multi-select as an empty value, gets a
 * blank page that reads as "this tenant has no such entries" instead of "no filter
 * applied". The packaged viewer never sends it (`react/api.ts` drops falsy
 * values), which is exactly why it would have gone unnoticed.
 */
const commaList = (allowed: readonly string[]): z.ZodType<string[] | undefined> =>
  z
    .string()
    .optional()
    .transform((raw) => {
      if (raw === undefined) return undefined;
      const values = [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))];
      return values.length > 0 ? values : undefined;
    })
    .refine(
      (values) => values === undefined || values.every((value) => allowed.includes(value)),
      'Unknown filter value.',
    ) as unknown as z.ZodType<string[] | undefined>;

const positiveInt = (fallback: number, max?: number): z.ZodType<number> =>
  z
    .string()
    .optional()
    .transform((raw) => {
      const value = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
      if (!Number.isFinite(value) || value < 1) return fallback;
      return max !== undefined && value > max ? max : value;
    }) as unknown as z.ZodType<number>;

/** The parsed query — what the store consumes. */
export interface AuditLogQuery {
  q?: string;
  actionIn?: string[];
  resourceTypeIn?: string[];
  actorUserId?: string;
  resourceId?: string;
  /** Inclusive day bounds, already resolved to UTC instants. */
  from?: Date;
  toExclusive?: Date;
  page: number;
  pageSize: number;
}

/**
 * Build the zod schema for one vocabulary and one paging policy.
 *
 * The paging numbers are the HOST's (`pagination` on the server config, see
 * `policy.ts` for the refusals) and default to this package's; they are passed
 * in rather than read from module constants so the schema a host advertises as
 * a tool and the clamps the endpoint applies are the same three values.
 */
export function auditLogQuerySchema(
  vocabulary: AuditVocabulary,
  paging: AuditPagingPolicy = DEFAULT_PAGINATION,
) {
  return z.object({
    q: z.string().min(1).optional(),
    action_in: commaList(vocabulary.actionIds),
    resourceType_in: commaList(vocabulary.resourceIds),
    actorUserId: z.string().min(1).optional(),
    resourceId: z.string().min(1).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
    page: positiveInt(1, paging.maxPage),
    pageSize: positiveInt(paging.defaultPageSize, paging.maxPageSize),
  });
}

/** A `YYYY-MM-DD` calendar date at UTC midnight. */
const atUtcMidnight = (date: string): Date => new Date(`${date}T00:00:00Z`);

/**
 * Start of the day AFTER `date` — the exclusive upper bound for an INCLUSIVE
 * `to`, so a same-day entry written at any hour is still returned. Getting this
 * wrong silently hides the newest day of the trail, which is the day someone
 * filtering by date is usually asking about.
 */
const nextUtcMidnight = (date: string): Date =>
  new Date(atUtcMidnight(date).getTime() + 24 * 60 * 60 * 1000);

/** The validated wire shape, before the day bounds become instants. */
type ParsedQuery = z.output<ReturnType<typeof auditLogQuerySchema>>;

/**
 * The wire names on the left, the store's names on the right. A table rather
 * than a run of spreads: each line is one filter crossing the boundary, and an
 * omitted line is a filter the endpoint accepts and then ignores.
 */
function narrowFilters(value: ParsedQuery): Omit<AuditLogQuery, 'page' | 'pageSize'> {
  return {
    ...(value.q ? { q: value.q } : {}),
    ...(value.action_in ? { actionIn: value.action_in } : {}),
    ...(value.resourceType_in ? { resourceTypeIn: value.resourceType_in } : {}),
    ...(value.actorUserId ? { actorUserId: value.actorUserId } : {}),
    ...(value.resourceId ? { resourceId: value.resourceId } : {}),
    ...(value.from ? { from: atUtcMidnight(value.from) } : {}),
    ...(value.to ? { toExclusive: nextUtcMidnight(value.to) } : {}),
  };
}

/** Parse a request query, or throw the 400 the wire promises. */
export function parseAuditLogQuery(
  vocabulary: AuditVocabulary,
  query: Record<string, string | undefined>,
  messages: Pick<AuditMessages, 'invalidQuery'>,
  paging: AuditPagingPolicy = DEFAULT_PAGINATION,
): AuditLogQuery {
  const parsed = auditLogQuerySchema(vocabulary, paging).safeParse(query);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? '';
    throw new AuditApiError(400, `${messages.invalidQuery}${path ? ` (${path})` : ''}.`);
  }
  return {
    ...narrowFilters(parsed.data),
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
  };
}
