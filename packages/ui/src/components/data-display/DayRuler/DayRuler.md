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
- A release anywhere commits the drag. **Escape**, the window losing focus, or a move with no
  button down abandons it: nothing is reported, the block goes back to its hours (a create's
  preview goes), and only the click that release leaves behind is ignored.
- Keyboard moves, resizes and refusals (past the ruler; `labels.notMovable` on a block that is
  not `movable` / `resizable`) are read by a polite live region that stays mounted; the same sentence twice is
  read twice.

## Props

| Prop | Type | Description |
|---|---|---|
| `rows` | `DayRulerRow[]` | `id`, `label`, `meta?`, `metaTone?`, `nameAdornment?` (node beside the name — a "Freela" tag; it moves under the name when there is no room for both), `chips?` (node — one line, a chip that does not fit shrinks and cuts its label), `actions?` (node — "Encerrar turno", "Iniciar agora"), `blocks` (`id`, `start`, `end`, `label`, `shortLabel?`, `tone`, `movable?`, `resizable?`, `selected?`, `title?`, `breakSpan?` — `{ start, end }` in ruler hours, a meal break drawn as a hatched gap inside the block: it travels with a moved block and is cut to its ends while one is dragged; a span that falls outside the block, is empty or is reversed (`end <= start`) draws nothing; its words are the host's, in `label` / `title`), `actual?` (`start`, `end`), `actualLabel?`, `group?` (a new value starts a new heading), `onLabelClick?`, `labelAccessible?`. |
| `from` / `to` | `number` (default 6 / 26) | The ruler's span. |
| `now` | `number?` | The "agora" line, when on the ruler. |
| `coverage` | `number[]?` | People per hour, index 0 = `from…from+1`. |
| `coverageLabel` | `string?` | Beside the counts ("Na escala, por hora"). |
| `groupFooter` | `(group) => DayRulerFooterRow[]?` | Lines under a group's rows, on the tracks' columns (FUT-3882), for the group titled `group` (`undefined` for rows with no group). A row is `{ id, label, cells }` — one `{ text, marked?, title? }` per hour from `from`, a `marked` hour drawn in the warning ink inside a warning outline ("O movimento pede", an hour short of people; say it in `title` too, colour is never the only signal) — or `{ id, label, trend }`, one value (or `null`) per hour drawn as a line in the primary colour, the highest near the top ("Média de pedidos/hora", `role="img"` named by `label`). A row `{ id, label, note }` says a sentence across the track instead ("Pouco histórico: menos de 4 semanas com pedidos na cozinha."). Not drawn in a phone-sized pane, like the coverage row. |
| `tickHours` | `number` (default 4) | An axis label every this many hours (HH:MM). |
| `snapMinutes` | `number` (default 15) | |
| `createHours` | `number` (default 4) | What a click alone creates. |
| `createStart` | `(rowId) => number` | Where Enter creates. |
| `readOnly` | `boolean?` | Nothing creates, moves or resizes; blocks still open. |
| `onCreate` / `onMove` / `onResize` / `onBlockClick` | see Gestures | Each is offered only when its handler is given. |
| `loading` / `error` / `empty` | `boolean` / node / node | Skeleton rows with `aria-busy`; the host's error; the host's empty sentence. |
| `aria-label` | `string?` | The region's name. |
| `labels` | `Partial<DayRulerLabels>` | `createTrack(row)`, `moved(block, range)`, `resized(block, range)`, `refused`, `loading`. Default: the English pack; pt-BR: `DAY_RULER_LABELS['pt-BR']` from `@12-apps/ui/data-display/DayRuler`. |
| `dataTestId` | `string?` (default `day-ruler`) | Parts: `-coverage`, `-axis`, `-footer-${footerRowId}`, `-row-${rowId}`, `-track-${rowId}`, `-block-${blockId}`, `-handle-l/-r-${blockId}`, `-break-${blockId}`, `-actual-${rowId}`, `-now`, `-preview`, `-live`, `-loading`. |

Tones are `ScheduleGrid`'s; on the ruler a `plan` block is a dashed outline over a faint ground.

## Layout

- **Computer:** name 220px · track (`minmax(0, 1fr)`) · actions 220px (none when no row has
  `actions`), 16px gap; a hairline between rows. Track 40px tall with a line every hour; blocks 24px at +4px; the actual bar 6px
  at +31px; the now line the track's full height.
- **Stacked (a container under 800px: a phone, a tablet in portrait)** — a container query, not a
  media query: name, meta, chips and the actions on top, the track under them at full width, 30px
  tall with a line every `tickHours`; the coverage row (its label above the counts) and the hour
  axis span the same full width. **Under 600px** (a phone-sized pane) there is no coverage row and
  no axis. Every bound is "from that width up". A block whose range does not fit it, by pixels,
  says only its `shortLabel` (its start), never a cut "20:39–00:". The 20px blocks and the 24px name buttons
  answer a 40px finger (an invisible hit area), the look unchanged.

## Accessibility

Rows are a `list` per group. Blocks are native buttons with `aria-keyshortcuts`; the `selected`
block is `aria-current="true"`. An interactive
track is a focusable `group` named `labels.createTrack(row)`; Enter or Space creates.

## Related

`ScheduleGrid` (the week), `SequenceResolver` (the problems a late block opens).
