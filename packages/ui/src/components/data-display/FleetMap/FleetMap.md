# FleetMap

Where a set of tracked units is **right now**: a map beside the roster that
reads it.

Product-free by construction. It draws labelled dots with a freshness state, and
every word — the heading, the three freshness names, how a duration and a
distance are written — arrives through `copy`. Couriers on motorbikes, service
vans and field engineers are all the same picture.

## Use cases

- A dispatcher watching a delivery fleet during a shift.
- A field-service board showing which engineers are moving and which have gone
  quiet.
- Any "where is everybody" panel where the answer is a small set of named people
  with a last-known position and a staleness.

## Three decisions that shape the API

### The roster is the accessible representation, not a sidebar

A map is a picture, and a screen reader cannot read one. So the list carries the
information: everything a sighted user takes from a pin — who, how recently,
what they are carrying — is on the row, and the row's freshness is spelled out
in words rather than carried by the dot's colour.

The map is a **named landmark** (`role="region"` with a label) rather than an
`aria-hidden` one. Its controls are focusable, and `aria-hidden` over a
focusable subtree is the `aria-hidden-focus` violation: a keyboard user tabs
into a region a screen reader insists is not there. The landmark role is what
puts it in the rotor, so a reader can skip past it in one gesture.

When there is no centre to point at — a fleet that is still loading and has
reported nothing — the map renders **nothing** rather than falling back to
`0, 0`, which is a real place in the Gulf of Guinea.

### Nothing here formats

`copy.lastSeen` and `copy.accuracy` are **functions**, not strings. A duration
and a distance are locale rules, and the same line `StatCard` holds for its
`value` applies: a component that wrote `"2 min ago"` would have made English
the only language it could ever render, and a `lastSeenTemplate` string would
have fixed the shape as well as the words.

### An empty fleet is an empty STATE, never an empty map

A map with no pins is indistinguishable from a map that failed to load, and
telling those two apart is the entire question a dispatcher is asking.

## Props

| prop | type | default | what it does |
|---|---|---|---|
| `units` | `readonly FleetUnit[]` | — | everyone currently reporting; empty renders the empty state |
| `copy` | `FleetMapCopy` | — | every word, plus the two formatters |
| `selectedId` | `string \| null` | — | pass it to CONTROL the selection; omit it and the component keeps its own |
| `onSelect` | `(id: string) => void` | — | a click on a row or a pin, and each arrow-key move |
| `laggingAfterSeconds` | `number` | `90` | when a unit stops reading as `live` |
| `staleAfterSeconds` | `number` | `300` | when it stops reading as `lagging` |
| `height` | `string` | `'420px'` | the map's height, any CSS length |
| `loading` | `boolean` | `false` | skeletons only before the first units land; `aria-busy` either way |
| `className` | `string` | — | on the panel root |
| `dataTestId` | `string` | `'fleet-map'` | every child TEST id derives from it; DOM ids are generated |

### `FleetUnit`

```ts
{
  id: string;
  label: string;            // the name on the pin and the row
  latitude: number;
  longitude: number;
  accuracyM?: number | null; // metres; a row with none renders none
  staleSeconds: number;      // since the fix was ACCEPTED, on the SERVER's clock
  badge?: string;            // pre-formatted, e.g. "2 deliveries"
}
```

`staleSeconds` is measured against the **server's** clock, and the caller
computes it. The distinction is not pedantry: a device whose own clock is an
hour slow would otherwise report itself as an hour absent while reporting
perfectly.

## Why the thresholds have no domain default

They are props because the answer belongs entirely to the fleet's own ping
cadence. A phone reporting every twenty seconds is late at ninety; a tracker
reporting every five minutes is not. The defaults are sized for the first case
and are a starting point, not a rule — a component that picked one would be
picking it for every consumer.

## Usage

```tsx
<FleetMap
  units={couriers}
  copy={{
    title: 'Motoboys na rua',
    emptyTitle: 'Ninguém reportando',
    emptyDescription: 'Um motoboy aparece aqui quando o celular envia a primeira posição.',
    rosterLabel: 'Motoboys, mais recentes primeiro',
    mapLabel: 'Mapa de onde os motoboys estão',
    freshness: { live: 'Ao vivo', lagging: 'Atrasado', stale: 'Sem sinal' },
    lastSeen: (s) => (s < 60 ? `há ${s}s` : `há ${Math.floor(s / 60)} min`),
    accuracy: (m) => `±${Math.round(m)} m`,
    map: PT_BR_MAP_PREVIEW_COPY,
  }}
  selectedId={selected}
  onSelect={setSelected}
/>
```

## Accessibility

- The panel is a `region` labelled by its heading.
- The roster is a `listbox` with `option` rows, **one tab stop**, arrow keys
  moving the selection and wrapping at both ends, and
  `aria-activedescendant` naming the selected row.
- Freshness is stated in words on every row; the coloured dot is `aria-hidden`
  so the state is not read twice, and colour is never the only carrier.
- The map region is a named landmark rather than hidden — see above.
- The active option is scrolled into view (`block: 'nearest'`) as the selection
  moves, so a keyboard user is not walking it below the fold unseen.
- `aria-activedescendant` is emitted only when the selected id names a row that
  is actually rendered: a controlled selection can outlive the unit it names.
- The active option's scroll effect also watches its POSITION, because the
  roster re-sorts on every poll and a still-selected row can move under it.
- While `loading`, the panel is `aria-busy` and the heading stays, so the layout
  does not reflow when the data lands. `aria-busy` is a state and utters
  nothing, so set `copy.loading` if the reload should be ANNOUNCED — that string
  goes into a visually hidden `role="status"`. Left unset, the reload is silent.
- Skeletons replace the roster only while there are no units yet. A poll that
  refreshes a populated list keeps the listbox mounted, because unmounting it
  throws away the focus inside it.
- The map is a named landmark, so a reader can jump past it — but it is not
  silent. `MapPreview` carries its own `aria-live="polite"` and announces its
  centre coordinates, in English, on every re-centre. That string is the one
  piece of user-facing text here that does not come through `copy`; fixing it
  means changing `MapPreview`, which every consumer shares.

## Best practices

- Sort nothing before passing `units`. The component orders freshest first and
  breaks ties on the label, so a poll does not reshuffle the list.
- Keep `selectedId` in the consumer's state when something ELSE needs to know
  the selection — a detail panel beside the board, a URL, a second map. That is
  what controlling it buys; a click on the map and a click on the row are the
  same event either way.
- Otherwise pass neither `selectedId` nor `onSelect` and let the component hold
  it. Passing `selectedId` alone with no `onSelect` is a selection nothing can
  move, and the arrow keys then belong to the page rather than the roster.
- Pre-format `badge`. It is rendered, never parsed.

## Known limits

- **Not ported to React Native.** `@12-apps/ui` ships a native build for seven
  subpaths; this is not one, and neither is the `MapPreview` it wraps. That is
  the ordinary state (26 of 141 at the time of writing) and it fails LOUDLY under Metro — an unported
  subpath resolves to the web file and errors on `@mui/material` at import
  rather than rendering a blank view. It is also the right call for this
  component: a fleet board is a dispatcher's screen, and the tracked unit's own
  device reports a position rather than drawing the fleet.
- **The map's own `aria-label` is English**, and comes from `MapPreview` rather
  than from `copy`. Everything `FleetMap` itself renders is injected; that one
  sentence is not, and a pt-BR consumer's screen reader will read it in English
  until `MapPreview` takes a copy port.
- **Pin separation does not scale with zoom.** `MapPreview` places markers at a
  fixed pixels-per-degree, so units a few hundred metres apart draw within a
  pixel or two of each other. The roster distinguishes them; the map does not.
