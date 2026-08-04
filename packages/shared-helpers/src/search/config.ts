import { z } from "zod";

/**
 * Global (per-deployment) search limits. Kept separate from the per-entity
 * config so page-size ceilings and the max search-term length are tuned once
 * via env and shared by every list.
 */
export const searchConfigSchema = z.object({
  defaultPageSize: z.coerce.number().int().positive().default(20),
  maxPageSize: z.coerce.number().int().positive().default(500),
  maxSearchTermLength: z.coerce.number().int().positive().default(200),
});

export type SearchConfig = z.infer<typeof searchConfigSchema>;

/** Parse the global search config from an env record (defaults when unset). */
export function parseSearchConfig(
  envRecord: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): SearchConfig {
  return searchConfigSchema.parse({
    defaultPageSize: envRecord.SEARCH_DEFAULT_PAGE_SIZE,
    maxPageSize: envRecord.SEARCH_MAX_PAGE_SIZE,
    maxSearchTermLength: envRecord.SEARCH_MAX_TERM_LENGTH,
  });
}
