# DayRuler

One day as an **hour ruler per row** — who is on the escala when (blocks), who is really on
shift (a thin bar under them), "agora" (a line across every track) and how many people are on
each hour (a row of counts above the axis) (FUT-3825, Turnos prototype D). The ruler reports
gestures; hours, limits and refusals are the host's.

```
Na escala, por hora   [  ][  ][5][5][5] … [1][1][1][  ][  ]
                      06:00     10:00     …     22:00     02:00
ENTREGAS
Luiz entrega          |··········[↻ 20:39–00:00]···|     [Iniciar agora]
atrasado · era 20:39                        ┃ agora
Anderson Paiva        |  sem escala · desde 08:26  |     [Encerrar turno]
                      |  ━━━━━━━━━━━━━━━━━━━━━━━━━┃|
```

Times are **hours from the day's midnight**, fractions included: `20.75` is 20:45 and a value past
24 is the next morning (`26` is 02:00).

## Gestures

| gesture | pointer (mouse, pen) | keyboard | reports |
|---|---|---|---|
| create | drag on an empty stretch of a row's track; **a click alone is `createHours`** (4h) | Enter on the focused track: `createHours` from `createStart(rowId)` (default: `now` snapped up, else `from`) | `onCreate(rowId, start, end)` |
| move | drag a block's middle — its length is kept, it stays on the ruler | Alt+← / Alt+→ | `onMove(blockId, start, end)` |
| change the end / start | drag the block's right / left handle — never shorter than 30 min | Shift+← / Shift+→ (end), Shift+Alt+← / Shift+Alt+→ (start) | `onResize(blockId, start, end)` |
| open | click or tap a block | Enter | `onBlockClick(blockId)` |

- Every hour snaps to `snapMinutes` (15) and is kept within `from…to`.
- While a drag runs the block is redrawn live with its hours.
- **Touch never drags and a tap on the track creates nothing** (the phone schedules with the host's
  "+ Agendar ⟨dia⟩"); a tap on a block opens it.
- Keyboard moves, resizes and refusals are read by a polite live region.

## Props

| Prop | Type | Description |
|---|---|---|
| `rows` | `DayRulerRow[]` | `id`, `label`, `meta?`, `metaTone?`, `chips?` (node), `actions?` (node — "Encerrar turno", "Iniciar agora"), `blocks` (`id`, `start`, `end`, `label`, `shortLabel?`, `tone`, `movable?`, `resizable?`, `selected?`, `title?`), `actual?` (`start`, `end`), `actualLabel?`, `group?` (a new value starts a new heading), `onLabelClick?`, `labelAccessible?`. |
| `from` / `to` | `number` (default 6 / 26) | The ruler's span. |
| `now` | `number?` | The "agora" line, when on the ruler. |
| `coverage` | `number[]?` | People per hour, index 0 = `from…from+1`. |
| `coverageLabel` | `string?` | Beside the counts ("Na escala, por hora"). |
| `tickHours` | `number` (default 4) | An axis label every this many hours (HH:MM). |
| `snapMinutes` | `number` (default 15) | |
| `createHours` | `number` (default 4) | What a click alone creates. |
| `createStart` | `(rowId) => number` | Where Enter creates. |
| `readOnly` | `boolean?` | Nothing creates, moves or resizes; blocks still open. |
| `onCreate` / `onMove` / `onResize` / `onBlockClick` | see Gestures | Each is offered only when its handler is given. |
| `loading` / `error` / `empty` | `boolean` / node / node | Skeleton rows with `aria-busy`; the host's error; the host's empty sentence. |
| `aria-label` | `string?` | The region's name. |
| `labels` | `Partial<DayRulerLabels>` | `createTrack(row)`, `moved(block, range)`, `resized(block, range)`, `refused`, `loading`. Default: the English pack; pt-BR: `UI_LABELS['pt-BR'].dayRuler`. |
| `dataTestId` | `string?` (default `day-ruler`) | Parts: `-coverage`, `-axis`, `-row-${rowId}`, `-track-${rowId}`, `-block-${blockId}`, `-handle-l/-r-${blockId}`, `-actual-${rowId}`, `-now`, `-preview`, `-live`, `-loading`. |

Tones are `ScheduleGrid`'s; on the ruler a `plan` block is a dashed outline over a faint ground.

## Layout

- **Computer:** name 220px · track (`minmax(0, 1fr)`) · actions 220px, 16px gap; a hairline
  between rows. Track 40px tall with a line every hour; blocks 24px at +4px; the actual bar 6px
  at +31px; the now line the track's full height.
- **Narrow container (< 600px, a phone)** — a container query, not a media query: name, meta,
  chips and the actions on top, the track under them at full width, 30px tall with a line every
  `tickHours`; no coverage row and no axis. A block shorter than 30% of the ruler says only its
  `shortLabel` (its start), never a cut "20:39–00:".

## Accessibility

Rows are a `list` per group. Blocks are native buttons with `aria-keyshortcuts`. An interactive
track is a focusable `group` named `labels.createTrack(row)`; Enter or Space creates.

## Related

`ScheduleGrid` (the week), `SequenceResolver` (the problems a late block opens).
