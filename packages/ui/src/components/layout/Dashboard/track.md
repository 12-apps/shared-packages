# Dashboard

Composable page-shell component: a context provider (`<Dashboard>`) plus opt-in
dot-notation parts. Pages compose only the chrome they need; recognised parts
render in a fixed slot order (Breadcrumb → Header → Filters → Body) irrespective
of authoring order. Framework-agnostic (pure MUI) so it is reusable across
projects.

## Props (root)

- `defaultFiltersVisible` — initial expanded state of the filter region.
- `activeFilterCount` — number badged onto `Dashboard.FilterToggle`.
- `testIdPrefix` — prefix for `data-testid` across all parts.

## Parts

- `Dashboard.Breadcrumb` — breadcrumb trail; `renderLink` for router links.
- `Dashboard.Header` — title row hosting action parts.
- `Dashboard.Info` — `[i]` page-summary popover.
- `Dashboard.FilterToggle` — funnel; toggles filters, badges active count.
- `Dashboard.Settings` — gear; opens a dialog.
- `Dashboard.Export` — export dropdown; `onExport(id)`.
- `Dashboard.Spacer` — right-aligns following controls.
- `Dashboard.Action` — button slot.
- `Dashboard.Filters` — collapsible search/filter region.
- `Dashboard.MoreFilters` — advanced expandable panel (min/max ranges, dates).
- `Dashboard.Body` — main content.

## Lint

- Pending first `pnpm dev:check`.

## Type Errors

- Pending first `pnpm dev:check`.

## Testing Scenarios

- Filter toggle, info popover, settings dialog, export menu, more-filters expand,
  order-independent slot rendering.

## Storybook Tests List

- Layout/Dashboard/Tests → 6 interaction stories.

## Current

- v1 authored. Wired into the admin Products page as the first consumer.
- TODO: roll out to Inventory and Suppliers; add range-filter helpers if the
  admin needs a shared min/max control.
