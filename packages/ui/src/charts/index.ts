/**
 * `@12-apps/ui/charts` — the raw chart library entry point (FUT-129), the
 * sanctioned consumption path for the report builder and other spec-driven
 * consumers. Re-exports only the chart surface (spec types, renderer
 * registry, composables, formatters) so bundlers never drag the rest of the
 * UI kit in through this seam.
 */
export * from '../components/data-display/Chart';
