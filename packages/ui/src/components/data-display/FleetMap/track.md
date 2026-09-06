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
| `onSelect` | fired by a row click, each arrow-key move, and a pin click (mouse only — the pin is not focusable) |
| `laggingAfterSeconds` | when a unit stops reading as `live` |
| `staleAfterSeconds` | when it stops reading as `lagging` |
| `height` | the map's height |
| `loading` | first-load skeletons, map and roster `aria-busy` |
| `className` | on the panel root |
| `dataTestId` | root TEST id; DOM ids are generated separately |

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
`KeyboardNavigationTest`, `ControlledWithoutHandlerTest`, `ScreenReaderTest`,
`ActiveDescendantTest`, `StaleSelectionTest`, `EmptyStateTest`,
`LoadingStateTest`, `IdleAnnouncementRegionTest`, `LoadingAnnouncementTest`,
`LoadingKeepsThePopulatedRosterTest`, `UncontrolledSelectionTest`,
`EdgeCaseTest`.

## Current

Shipped. Its first consumer is an adopter's courier-tracking panel, which
composes it with its own transport and its own words.
