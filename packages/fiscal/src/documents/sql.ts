/**
 * The number draw, as one SQL statement over the package's migration
 * (`fiscal_number_counters`). A host's `FiscalStore.createDocument` runs it
 * and the document INSERT in ONE transaction: the row lock this UPDATE takes
 * serialises concurrent draws on a series, and a failed insert rolls the
 * counter back with it, so a series has no gap a failed write made. The only
 * gaps left are numbers SEFAZ never used (a rejection, a replaced document),
 * which the sweep inutilizes.
 *
 * Parameters: `$1` owner id, `$2` environment, `$3` model, `$4` series,
 * `$5` issuing point id. No row comes back when the series is not that
 * point's; an exhausted series fails the counter's CHECK (at most
 * 1 000 000 000, the next number after 999 999 999), and the transaction with it.
 */
export const FISCAL_NEXT_NUMBER_SQL = `UPDATE "fiscal_number_counters"
SET "next_number" = "next_number" + 1, "updated_at" = CURRENT_TIMESTAMP
WHERE "owner_id" = $1 AND "environment" = $2 AND "model" = $3 AND "series" = $4 AND "issuing_point_id" = $5
RETURNING "next_number" - 1 AS "number"`;
