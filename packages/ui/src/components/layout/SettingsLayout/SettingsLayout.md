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
- **Responsive** — below `md` the rail stacks full-width above the panel
- **Agnostic** — no app-specific content; drive it with any `groups` data

## Usage

### Route-based (recommended for app settings)

```tsx
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { SettingsLayout, type SettingsNavGroup } from '@repo/ui/layout/SettingsLayout';

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
| linkComponent     | ElementType                                            | -                   | Element used to render items that have an `href` (e.g. Next `Link`)|
| children          | ReactNode                                              | -                   | Central panel content (the selected screen)                        |
| testIdPrefix      | string                                                 | `'settings'`        | Prefix for `data-testid` attributes                                |

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

## Accessibility

- The rail is a `<nav>` labelled by the `title`.
- The active item exposes `aria-current="page"`.
- Items with `href` render as a single interactive anchor (via `linkComponent`),
  avoiding nested interactive elements.
- The search field carries an accessible label matching its placeholder.

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
| Central panel  | `{testIdPrefix}-panel`             |

`testIdPrefix` defaults to `settings`.
