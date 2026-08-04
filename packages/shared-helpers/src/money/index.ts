/**
 * Client-safe money entry point.
 *
 * Re-exports the pure BRL helpers from `utils/lib/money` (only `Intl.NumberFormat`
 * and arithmetic — zero Node dependencies) so client components can format
 * currency without pulling the `@12-apps/shared-helpers/utils` barrel, which
 * `export *`s Node-only modules (jwt, logger, getGeoLocation, …). This is the
 * single client-safe formatter; per-feature copies should import from here
 * instead of re-implementing `Intl.NumberFormat("pt-BR", { currency: "BRL" })`.
 */
export { formatBRL, fromCents, parseBRL, toCents } from "../utils/lib/money";
