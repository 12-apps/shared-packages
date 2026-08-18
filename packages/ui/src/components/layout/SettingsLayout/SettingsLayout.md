# SettingsLayout Component

## Overview

`SettingsLayout` is a reusable, agnostic, data-driven **two-pane settings shell**
(Facebook-style): a searchable left rail of grouped categories/subcategories and a
central panel that renders the selected configuration screen. Navigation is
described entirely by data (`groups`); the host owns routing — either by passing a
`linkComponent` (e.g. a Next.js `Link`) with per-item `href`s, or by handling
`onSelectItem` for in-place selection.

It composes MUI primitives and semantic theme tokens only (no hardcoded colors), so
it themes automatically in light/dark.

## Features

- **Search field** filtering the rail by item `label` + optional `keywords`
- **Grouped navigation** with category headers and optional descriptions
- **Central panel** (`children`) — a custom screen per configuration
- **Link or button mode** per item (`href` + `linkComponent`, or `onSelectItem`)
- **Active highlight** via `activeItemId` (`aria-current="page"`, semantic tint)
- **Responsive** — below `railBreakpoint` the rail either stacks above the panel
  (`switcher`) or hands the width to a list→detail drilldown (`drilldown`)
- **Situation markers** per item — host-resolved, with the meaning in text
- **Section chip strip** on narrow widths, scrolling itself to the open section
- **Agnostic** — no app-specific content; drive it with any `groups` data

## The two narrow-width shapes

`navVariant` decides what happens below `railBreakpoint`.

**`switcher`** (default) folds the rail into a disclosure stacked above the
panel. Right when the panel is always the point and the rail is a chooser.

**`drilldown`** gives the shape every mobile settings app has: the list first,
then the screen, with a way back.

| where | below `railBreakpoint` | at and above it |
| --- | --- | --- |
| at the index (`atIndex`) | the grouped **list is the page** | rail + panel |
| inside a section | back link, **chip strip**, panel | rail + panel |

Pass `atIndex` from the router, `indexHref` for the back link, and
`sectionChips` with the sibling sections the strip should carry (usually the
open item's own group).

### Why the width decision is CSS, never a JS media query

Both navigation forms — the rail and the chip strip — are mounted at every
width, and only `display` moves between them.

A layout that RENDERS one navigation and not the other can offer the narrow
width less than the wide one, and nothing catches it: the missing control is not
in the tree to be asserted about, so no test fails and no review notices. With
one tree, "the phone reaches everything the desktop reaches" holds by
construction. `DrilldownBothNavigations` in the test stories is the assertion
that keeps it that way.

The one media query that IS read in JavaScript is `prefers-reduced-motion`, in
the chip strip — a motion preference has no CSS equivalent at the point where
`scrollTo` picks its behaviour.

## Situation markers

An item may carry a host-resolved `status`, shown as a marker beside its label:

| `status` | drawn as | means |
| --- | --- | --- |
| `ok` | green dot | set up and working |
| `off` | grey dot | exists, switched off |
| `new` | red dot | never opened |
| `locked` | padlock | the plan does not include it |

`locked` is a padlock rather than a fourth colour on purpose: a locked section
has no configuration state at all, and a grey dot would claim it is merely off.

**`statusLabel` is not optional in practice.** It is rendered as visually-hidden
text inside the row, so the row's accessible name reads "Endereço, desligado".
Colour alone never carries the meaning, and a marker without a label is
decoration.

The layout never derives `status` — it cannot know what "configured" means for a
screen it does not own, and a rail that guesses disagrees with the screen the
moment the rule moves.

## Inert items

`inert: true` renders an entry as listed text rather than a control — for a
section that exists but is not reachable from here. It is deliberately not a
disabled button: disabled says "you may not", and the honest statement is "not
from this screen".

## Usage

### Route-based (recommended for app settings)

```tsx
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { SettingsLayout, type SettingsNavGroup } from '@12-apps/ui/layout/SettingsLayout';

const groups: SettingsNavGroup[] = [
  {
    id: 'operations',
    label: 'Operação',
    items: [
      { id: 'inventory', label: 'Estoque & custo', href: '/admin/acme/config/inventory' },
      { id: 'orders', label: 'Pedidos', href: '/admin/acme/config/orders' },
    ],
  },
];

function ConfigShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const active = groups.flatMap((g) => g.items).find((i) => pathname.startsWith(i.href!))?.id;
  return (
    <SettingsLayout
      title="Configuração"
      searchPlaceholder="Pesquisar configurações"
      groups={groups}
      activeItemId={active}
      linkComponent={NextLink}
    >
      {children}
    </SettingsLayout>
  );
}
```

### Selection-based (no routing)

```tsx
const [active, setActive] = useState('profile');

<SettingsLayout groups={groups} activeItemId={active} onSelectItem={setActive}>
  <ProfilePanel />
</SettingsLayout>;
```

## Props

### SettingsLayoutProps

| Prop              | Type                                                   | Default             | Description                                                        |
| ----------------- | ------------------------------------------------------ | ------------------- | ------------------------------------------------------------------ |
| title             | ReactNode                                              | -                   | Heading shown above the search field                               |
| groups            | SettingsNavGroup[]                                     | -                   | Grouped navigation for the left rail                               |
| activeItemId      | string                                                 | -                   | Id of the currently-open item (highlighted)                        |
| onSelectItem      | (id: string) => void                                   | -                   | Fired when a non-link item is chosen                               |
| searchPlaceholder | string                                                 | `'Search settings'` | Placeholder for the search field                                   |
| emptySearchLabel  | ReactNode                                              | generic string      | Shown when the search matches no items                             |
| emptySearchAction | `{ label: ReactNode; onClear?: () => void }`            | -                   | The way out, rendered inside the empty-search state                |
| linkComponent     | ElementType                                            | -                   | Element used to render items that have an `href` (e.g. Next `Link`)|
| children          | ReactNode                                              | -                   | Central panel content (the selected screen)                        |
| testIdPrefix      | string                                                 | `'settings'`        | Prefix for `data-testid` attributes                                |
| railBreakpoint    | `'sm' \| 'md' \| 'lg' \| 'xl'`                          | `'md'`              | Width at which the rail takes its own column                       |
| navVariant        | `'switcher' \| 'drilldown'`                            | `'switcher'`        | Narrow-width navigation shape                                      |
| atIndex           | boolean                                                | `false`             | `drilldown`: the router is at the area's index, not in a section    |
| indexHref         | string                                                 | -                   | `drilldown`: where the back link goes                              |
| backLabel         | string                                                 | `'Back'`            | Label on the back control                                          |
| sectionChips      | SettingsNavItem[]                                      | -                   | Sections carried by the narrow-width chip strip                    |

### SettingsNavGroup

| Prop        | Type              | Description                              |
| ----------- | ----------------- | ---------------------------------------- |
| id          | string            | Stable id (drives the group `data-testid`)|
| label       | string            | Category header (uppercased in the rail) |
| description | string            | Optional one-line description            |
| items       | SettingsNavItem[] | The items in this group                  |

### SettingsNavItem

| Prop     | Type      | Description                                            |
| -------- | --------- | ----------------------------------------------------- |
| id       | string    | Stable id (drives active highlight + `data-testid`)   |
| label    | string    | Visible label; matched by the search field            |
| icon     | ReactNode | Optional leading icon                                  |
| href     | string    | Optional link target (rendered via `linkComponent`)   |
| keywords | string[]  | Extra search terms beyond the label                   |
| status   | `'ok' \| 'off' \| 'new' \| 'locked'` | Host-resolved situation marker    |
| statusLabel | string | What the marker means — read aloud with the row        |
| inert    | boolean   | Listed, but not a control (not the same as disabled)  |

## Accessibility

- The rail is a `<nav>` labelled by the `title`.
- The active item exposes `aria-current="page"`.
- Items with `href` render as a single interactive anchor (via `linkComponent`),
  avoiding nested interactive elements.
- The search field carries an accessible label matching its placeholder.
- A situation marker puts its meaning in visually-hidden text inside the row, so
  the situation is part of the row's accessible name rather than a colour.
- The chip strip is its own labelled `<nav>`, and the open chip carries
  `aria-current="page"`.
- Every control in the `drilldown` shape holds a 44px minimum target below the
  breakpoint, including the back link and the chips.
- The chip strip honours `prefers-reduced-motion`: with it set, the scroll to
  the open section is a jump rather than an animation.

## Best Practices

1. **Keep it agnostic** — pass content through `groups`/`children`; don't hardcode
   app specifics into the component.
2. **Deep-linkable** — prefer route-based navigation (`linkComponent` + `href`) so
   each section has its own URL.
3. **Searchability** — add `keywords` to items whose label alone won't be typed.
4. **Grouping** — use a small number of balanced groups; single-item groups are fine.

## Testing

### Test IDs

| Element        | Test ID                            |
| -------------- | ---------------------------------- |
| Root           | `{testIdPrefix}`                   |
| Left rail      | `{testIdPrefix}-rail`              |
| Title          | `{testIdPrefix}-title`             |
| Search field   | `{testIdPrefix}-search`            |
| Group          | `{testIdPrefix}-group-{groupId}`   |
| Item           | `{testIdPrefix}-item-{itemId}`     |
| Empty state    | `{testIdPrefix}-empty`             |
| Empty-state exit | `{testIdPrefix}-empty-action`    |
| Situation marker | `{testIdPrefix}-status-{itemId}` |
| Central panel  | `{testIdPrefix}-panel`             |
| Back link      | `{testIdPrefix}-back`              |
| Chip strip     | `{testIdPrefix}-chips`             |
| Chip           | `{testIdPrefix}-chip-{itemId}`     |
| Chip marker    | `{testIdPrefix}-chip-status-{itemId}` |

`testIdPrefix` defaults to `settings`.
