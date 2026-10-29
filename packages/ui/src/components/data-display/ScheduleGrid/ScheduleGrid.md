# ScheduleGrid

People (or any resource) as **rows**, days as **columns**, and **blocks** with a start and an
end in the cells — the week grid of a staff schedule (FUT-3825, Turnos prototype D). The grid
reports gestures; the hours, weekly limits, refusals and toasts are the host's.

```
            Hoje · Seg 19/10   Ter 20/10      Qua 21/10              horas
            1 turno            1 turno        1 turno
ENTREGAS
Luiz        [20:39–00:00   ]   [   +   ]      [   +   ]               3h15
            [Atrasado      ]
Kelly       [Em turno      ]   [   +   ]      [|11:00–15:00   |]      4h
            [desde 08:26   ]                  [|↻ toda semana |]
```

**When to use it.** A week (or any short run of days) of people × days where a person places,
copies and moves blocks by hand. **Not** `Calendar` (it picks dates) and **not** `Timeline` (it
lists events on one axis). For one day by the hour, or for a phone, use `DayRuler`.

## Gestures

| gesture | pointer (mouse, pen) | keyboard | reports |
|---|---|---|---|
| create one day | click an empty cell | Enter on its "+" | `onCreate(rowId, [day])` |
| create several | drag across cells of ONE row | — | `onCreate(rowId, days)` — the crossed days that are empty, not blocked and not closed |
| copy | drag a block's left or right edge grip along its row | Shift+← / Shift+→ | `onCopy(blockId, days)` — never its own day, a taken, a blocked or a closed one |
| move | drag a block's middle to another cell (any row) | Alt+← / Alt+→ | `onMove(blockId, toRowId, toDay)` — only onto an empty, open cell |
| open | click a block | Enter | `onBlockClick(blockId)` |
| focus | — | ← → ↑ ↓ to the nearest cell with something to focus | — |

- **Touch never drags** (`pointerType: 'touch'`): the page scrolls; a tap is still a click.
- While a create or copy drag runs, each target cell is drawn dashed with the hours as ghost
  text (`createPreview(rowId)` for a create, the block's `label` for a copy); while a move
  runs, the cell under the pointer is highlighted.
- A drag that is released anywhere — inside the grid or outside it — commits. **Escape**, the
  window losing focus, or a move with no button down (released where the page could not see it)
  abandons it: nothing is reported, the ghost and the highlight go, and the click that release
  leaves behind is ignored. Only that click is: the next click on any block opens it.
- A keyboard copy or move, and a refusal (taken, closed, past either end), are read by a polite
  live region; on a block that is not `copyable` / `movable` it reads `labels.notMovable` ("Este
  turno não muda por aqui"). With Ctrl or Meta held the keys are not the grid's. After a keyboard move, focus follows the block to its new cell once the host
  re-renders it there; after a create on a "+" (Enter, Space or a click), focus moves to the
  block the host renders in that cell, so the arrows go on from there (after a click, without
  scrolling). A host that renders nothing there keeps focus where it was.

## Props

| Prop | Type | Description |
|---|---|---|
| `columns` | `ScheduleGridColumn[]` | `label` (wraps to a second line when its column is short, never cut, and never between a word and the number after it: "Seg 19/10" stays whole; also in `title`), `sublabel?`, `today?` (label in the primary colour, cells framed), `past?` (the day has gone: label in `text.secondary`, see [Closed days](#closed-days)). A day is its index here. |
| `groups` | `ScheduleGridGroup[]` | `title?` (upper-case heading, names the row group), `rows`: `id`, `label`, `meta?`, `metaTone?` (`'warning'` for "acima de 40h"), `total?`, `onLabelClick?` (makes the name a button), `labelAccessible?`, `nameAdornment?` (node beside the name — a "Freela" tag; it moves under the name when the column has no room for both), `chips?` (node under the meta — "2 regras ›"; one line, a chip that does not fit shrinks and cuts its label). |
| `cell` | `(rowId, day) => ScheduleGridCell` | `blocks` (`id`, `label`, `note?`, `tone`, `movable?`, `copyable?`, `selected?`, `title?`, `breakSpan?` — `{ start, end }` as fractions 0…1 of the block, a meal break drawn as a hatched gap; its words go in `note`), `blocked?` (hatched, refuses create and drop), `blockedLabel?`, `closed?` (the day can take no new turno — it has gone: no fill, no "+", see [Closed days](#closed-days)), `closedLabel?` (a closed cell's visually hidden words, "Já passou"). Called for every cell on each render: keep it cheap. |
| `totalLabel` | `string?` | The last column's header ("horas"). |
| `readOnly` | `boolean?` | No "+", no grips, no drag; empty cells are not focusable. Block clicks still reach `onBlockClick`. |
| `onCreate` / `onCopy` / `onMove` / `onBlockClick` | see Gestures | Each gesture is offered only when its handler is given. |
| `createPreview` | `(rowId) => string` | The ghost text a create drag shows (the person's last hours). |
| `loading` | `boolean?` | Header + skeleton rows, `aria-busy`, nothing to press. |
| `error` | `ReactNode?` | Replaces the body (an `ErrorState` with its retry). |
| `empty` | `ReactNode?` | Shown when there are no rows at all. |
| `stickyTop` | `number?` (px, default 0) | Offset of the sticky header row under a pinned page bar. |
| `scrollToDay` | `number?` (an index into `columns`) | While the days scroll sideways, the day they open on. Applied **once per value** (and per day count): as soon as the days are drawn, they scroll at once (`behavior: 'instant'`, never smoothly, so reduced motion needs nothing else) until that day is the first column after the pinned names — or to the end of their reach, when the day is that close to the end. While `loading`, `error` or `empty` it waits for the rows; while the grid has no box (`display: none`, a container that gets its width after mount) it waits for the first width. The header row follows; focus and the page's vertical scroll are untouched. A re-render or a refetch with the same value keeps the person's own scroll, and **a later resize does not re-anchor** — pass a new value for that. A value outside the columns, and a grid whose days fit, do nothing. **Assumes LTR**: the names are the left column. Pass today's index (`3` on a Thursday) so a week opened mid-week does not start on the gone days. |
| `aria-label` | `string?` | The grid's name. |
| `labels` | `Partial<ScheduleGridLabels>` | `createCell(row, column)`, `blockedCell(row, column)`, `copied(block, column)`, `moved(block, row, column)`, `refused`, `loading`. Default: the English pack; a pt-BR host passes `SCHEDULE_GRID_LABELS['pt-BR']` from `@12-apps/ui/data-display/ScheduleGrid`. |
| `dataTestId` | `string?` (default `schedule-grid`) | Parts: `-header`, `-row-${rowId}`, `-cell-${rowId}-${day}`, `-block-${blockId}`, `-grip-l-${blockId}`, `-grip-r-${blockId}`, `-break-${blockId}`, `-live`, `-loading`. |

### Tones — never colour alone

| `tone` | drawn | its `note` carries |
|---|---|---|
| `plan` | raised chip, neutral border | "↻ toda semana", "↻ a cada 2 semanas" |
| `late` | solid warning | "Atrasado" |
| `away` | dashed warning outline | "Ausente" |
| `uncovered` | dashed warning outline | "Sem ninguém" |
| `onduty` | soft success ground, success border | "desde 08:26" |

### Breaks and row adornments

A block's `breakSpan` is drawn as a band of diagonal stripes in the page's ground across the
block's height, under its text, so the block reads as cut there in every tone; it is decorative
(`aria-hidden`), and the block's `note` says it in words ("pausa 14:00–15:00"). Values outside
0…1 are clamped to the block; a span that is empty or reversed (`end <= start`) draws nothing. A row's
`nameAdornment` and `chips` are the host's nodes (an `@12-apps/ui` `Chip` fits): the grid only
places them.

## Closed days

A week runs Monday to Sunday, so the one shown often holds days already gone, and the server
refuses a turno on them. The host marks such a cell `closed: true`, and the grid offers nothing
there that could never work:

- no "+": the empty cell is not a focus stop (Tab and the arrows pass over it);
- a create or copy drag across it skips it, and a move or a keyboard copy/move onto it is
  refused (read aloud as for a taken day) — the same rules as a `blocked` day; a move passing
  over it does not highlight it;
- the blocks already there still show, still open (`onBlockClick`), and still copy and move
  OUT of the day — only the day a turno lands on must be open;
- no fill: a transparent ground inside the `divider` border, so a run of gone days (a phone's
  first screen can hold nothing else) reads as quiet, not as broken cells. No hatch and no
  visible text;
- `closedLabel` ("Já passou") is the cell's words for a screen reader, in a visually hidden
  span; without it the cell stays unnamed. It is ignored on a `blocked` cell, which has its own
  name.

The day's header says it too: a column with `past: true` draws its label in `text.secondary`
(`today` wins). **`past` is on the column, not derived from the cells**, because the two say
different things: `past` is a fact of the DAY, the same for every row, while `closed` is a
per-row decision the host makes (a back office may still open a gone day to one person, or a
gone day may hold only blocks). Deriving the header from the cells would make it ask every row
on each render and pick a rule for a day closed to some rows only. A host showing a gone day
normally sets both: `past` on its column and `closed` on its cells.

`blocked` is the other closed cell: an afastamento, hatched and named. A cell may be both; the
hatch wins.

## Layout

- Name column 200px · the day columns share the rest equally (`minmax(0, 1fr)`) · total 56px;
  6px gaps. Cells at least 56px tall; a cell's blocks stack (a split shift is two blocks).
- A block's hours (`label`) stay on one line (an ellipsis at worst, the full text in `title`);
  its `note` wraps to a second line when it is long and the block grows taller, as the
  prototype's "↻ a cada 2 / semanas": a note is never cut, so a break keeps its end.
- The header row is `position: sticky` (opaque, `background.default`) — it stays at the top of
  whatever scrolls the grid.
- A row's name and meta take at most two lines each (the rest cut, the whole text in `title`); a
  closed day's `blockedLabel` stays on one line inside its cell, cut with an ellipsis.
- **Container queries, not media queries; every bound is "from that width up".** The bounds come
  from the grid's own columns (for a week with totals they fall at 1032px and 914px):
  - while 200px names, days of at least 104px, the 56px total and the gaps fit: the computer frame
    — a block's hours whole beside its edge grips; a long note wraps;
  - while 140px names, days of at least 98px (their text 9px off each edge) and a 40px total fit:
    the same, unscrolled, grips kept, the header row sticking to the page — a 1280 laptop beside
    the admin's rail and panel, even with an always-visible scrollbar (923px);
  - below that: days of at least 152px, grips kept, every hours and note line whole; the days
    scroll sideways under the pinned names, and the header row — outside that scroller — still
    sticks to the page and follows the days sideways. The header row is no scroller of its own
    (`overflow-x: hidden`, so it is never a tab stop): the grid sets its scroll from the days',
    and a sideways wheel or trackpad swipe over it scrolls the days;
    a group's title is pinned with the names, whole at any scroll (each group is as wide as its
    rows, so the title's sticky room never runs out before the days do); `scrollToDay` picks the
    day they open on;
  - below 600px: 120px names, days of at least 136px, no grips (Shift+arrows still copy; the
    middle still moves).
  Never a coloured sliver, never cut hours, and the page itself never scrolls sideways — whatever
  the number of days.
- **The grid is the computer and tablet view.** On a phone, render `DayRuler` for one day at a
  time (the approved prototype, d11-phone); the sideways scroll is the grid's fallback in a
  narrow pane, not a phone layout.

## Accessibility

`role="table"` with `rowgroup` / `row` / `columnheader` / `rowheader` / `cell`; the table holds
rows only, so the host's `error` and `empty` nodes sit in one full-width row's cell. Every empty
cell's "+" and every block is a native `<button>` (Tab, Enter, Space); blocks declare their
shortcuts in `aria-keyshortcuts`, and the `selected` block is `aria-current="true"`. A blocked
cell is named by `blockedLabel` (or `labels.blockedCell`); a closed one carries its `closedLabel`, when given, as visually hidden text. The live region is `role="status"`,
polite, and stays mounted: each sentence clears it and is written on the next frame, so the
same sentence twice is read twice.

A cell or block the **keyboard** focuses is brought fully into view (WCAG 2.4.11): out from
under the pinned names, in from past the days' right edge with its 3px focus ring, and down
from under the sticky header row (the page, or the nearest vertical scroller, scrolls). The
browser counts a target under a sticky column or header as already in view, so the grid does
it. A pointer press or a tap is left where it is: scrolling then would move the cell out from
under the pointer and lose the click.

Every tone's text reads at 4.5:1 on its ground in light and dark mode: the `late` block keeps
`warning.contrastText` when it reads on `warning.main` and takes the page's dark ink otherwise;
`away`, `uncovered` and a `warning` meta line deepen the warning step until they read.

## Related

`DayRuler` (the same blocks, one day by the hour), `SequenceResolver` (the problems a late, absent
or uncovered block opens).
