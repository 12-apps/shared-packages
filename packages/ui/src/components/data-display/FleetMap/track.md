# FleetMap

Where a set of tracked units is right now: a map beside the roster that reads
it. Product-free — it draws labelled dots with a freshness, and every word plus
the two formatters arrive through `copy`. Built for a delivery fleet and
deliberately not named after one.

## Props

| prop | effect |
| --- | --- |
| `units` | who is reporting; empty renders the empty state rather than an empty map |
| `copy` | every word, and the `lastSeen` / `accuracy` formatters |
| `selectedId` | controlled selection; the map centres on it |
| `onSelect` | fired by a row click, a pin click, and each arrow-key move |
| `laggingAfterSeconds` | when a unit stops reading as `live` |
| `staleAfterSeconds` | when it stops reading as `lagging` |
| `height` | the map's height |
| `loading` | roster skeletons, panel `aria-busy` |
| `googleMapsApiKey` | forwarded to `MapPreview` |
| `dataTestId` | root id; every child derives from it |

## Lint

Clean, including the flakiness config.

## Type Errors

None.

## Testing Scenarios

Freshness at both thresholds and at their collapse; the centroid fallback and
the Atlantic-null for an empty fleet; roster order and its tie-break; selection
wrapping at both ends and a selection that has left the fleet; the empty state
against the loading state, which are opposite messages.

## Storybook Tests List

`BasicInteraction`, `FreshnessTest`, `ThresholdsAreProps`, `SelectionTest`,
`KeyboardNavigationTest`, `ScreenReaderTest`, `EmptyStateTest`,
`LoadingStateTest`, `EdgeCaseTest`.

## Current

Shipped. The consumer is Future Pay's Rastreamento panel, which composes it with
its own transport and pt-BR words.
