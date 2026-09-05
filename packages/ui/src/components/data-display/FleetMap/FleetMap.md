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

The map is a **named region** rather than an `aria-hidden` one. Its controls are
focusable, and `aria-hidden` over a focusable subtree is the `aria-hidden-focus`
violation: a keyboard user tabs into a region a screen reader insists is not
there. Naming it lets a reader skip past it in one gesture instead.

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
| `selectedId` | `string \| null` | `null` | controlled; the map centres on it and the roster marks it |
| `onSelect` | `(id: string) => void` | — | a click on a row or a pin, and each arrow-key move |
| `laggingAfterSeconds` | `number` | `90` | when a unit stops reading as `live` |
| `staleAfterSeconds` | `number` | `300` | when it stops reading as `lagging` |
| `height` | `string` | `'420px'` | the map's height, any CSS length |
| `loading` | `boolean` | `false` | roster skeletons; the panel announces busy |
| `googleMapsApiKey` | `string` | — | passed to `MapPreview`; without one it draws its tile fallback |
| `dataTestId` | `string` | `'fleet-map'` | every child id derives from it |

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
- The map region is named rather than hidden — see above.
- While `loading`, the panel is `aria-busy` and the heading stays, so the layout
  does not reflow when the data lands.

## Best practices

- Sort nothing before passing `units`. The component orders freshest first and
  breaks ties on the label, so a poll does not reshuffle the list.
- Keep `selectedId` in the consumer's state. Selection is controlled precisely
  so that a click on the map and a click on the row are the same event.
- Pre-format `badge`. It is rendered, never parsed.
