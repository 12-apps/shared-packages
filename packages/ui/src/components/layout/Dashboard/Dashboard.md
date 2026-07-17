# Dashboard

A **composable page shell** for list/detail admin pages. `<Dashboard>` is a
context provider and layout; every sub-component is **opt-in**. Compose only the
parts a page needs — omit `<Dashboard.Filters>` and there is no filter UI at all.
Authoring order does not matter: recognised parts always render in the slot order
**Breadcrumb → Header → Filters → Body**.

## Why

Every data page (products, inventory, suppliers, …) shares the same chrome: a
breadcrumb, a title with contextual controls (info, filter toggle, settings,
export), a collapsible filter region, and a body. `Dashboard` captures that shape
once so pages stay consistent and new pages are a composition, not a rebuild.
It is framework-agnostic (pure MUI, no app coupling) so other projects can reuse it.

## Composition

```tsx
import { Dashboard } from '@repo/ui/layout/Dashboard';

<Dashboard activeFilterCount={activeCount}>
  <Dashboard.Breadcrumb items={[{ label: 'Admin', href: '/admin' }, { label: 'Products' }]} />
  <Dashboard.Header title="Products">
    <Dashboard.Info title="About Products">What this page does…</Dashboard.Info>
    <Dashboard.FilterToggle />
    <Dashboard.Settings title="Product settings">In development</Dashboard.Settings>
    <Dashboard.Spacer />
    <Dashboard.Export onExport={(id) => exportAs(id)} />
    <Dashboard.Action><Button variant="contained">New product</Button></Dashboard.Action>
  </Dashboard.Header>
  <Dashboard.Filters>
    <SearchInput />
    <Dashboard.MoreFilters>
      <MinMaxRange field="price" />
    </Dashboard.MoreFilters>
  </Dashboard.Filters>
  <Dashboard.Body>{table}</Dashboard.Body>
</Dashboard>
```

## Parts

| Part | Slot | Purpose |
| --- | --- | --- |
| `Dashboard` | — | Provider + layout. Owns `filtersVisible` / `moreFiltersOpen` via context. |
| `Dashboard.Breadcrumb` | breadcrumb | Breadcrumb trail. `renderLink` lets you inject a router link. |
| `Dashboard.Header` | header | Title row hosting the action parts below. |
| `Dashboard.Info` | (in header) | `[i]` popover summarising the page. |
| `Dashboard.FilterToggle` | (in header) | Funnel icon; toggles the filter region, badges `activeFilterCount`. |
| `Dashboard.Settings` | (in header) | Gear icon. Default: opens a dialog with `children`. With `href` (+ optional `linkComponent`): renders as a link to a settings route (e.g. the page's Configuração section) — no dialog. |
| `Dashboard.Export` | (in header) | Export dropdown (CSV/Excel/JSON by default); calls `onExport(id)`. |
| `Dashboard.Spacer` | (in header) | Pushes following controls to the right edge. |
| `Dashboard.Action` | (in header) | Slot for a primary/secondary button. |
| `Dashboard.Filters` | filters | Collapsible search/filter region; visibility driven by `FilterToggle`. |
| `Dashboard.MoreFilters` | (in filters) | Expandable advanced panel for ranges/dates. |
| `Dashboard.Body` | body | Main content area (the table/grid). |

## State

`Dashboard` owns only **UI** state (which regions are open) through
`DashboardContext`. Search text and filter values stay owned by the page and are
passed to whatever controls you compose inside `Dashboard.Filters`. Read the
context directly with `useDashboardContext()` when building custom parts.

## Accessibility

- Icon triggers have tooltips + `aria-label`; `FilterToggle` exposes `aria-pressed`.
- `Info`/`Settings` triggers declare `aria-haspopup`; the settings dialog and info
  popover are focus-trapped by MUI and closable via the close button / `Esc`.
- Breadcrumb marks the current page with `aria-current="page"`.
