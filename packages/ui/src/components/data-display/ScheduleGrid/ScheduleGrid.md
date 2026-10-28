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
| create several | drag across cells of ONE row | — | `onCreate(rowId, days)` — the crossed days that are empty and not blocked |
| copy | drag a block's left or right edge grip along its row | Shift+← / Shift+→ | `onCopy(blockId, days)` — never its own day, a taken or a blocked one |
| move | drag a block's middle to another cell (any row) | Alt+← / Alt+→ | `onMove(blockId, toRowId, toDay)` — only onto an empty, open cell |
| open | click a block | Enter | `onBlockClick(blockId)` |
| focus | — | ← → ↑ ↓ to the nearest cell with something to focus | — |

- **Touch never drags** (`pointerType: 'touch'`): the page scrolls; a tap is still a click.
- While a create or copy drag runs, each target cell is drawn dashed with the hours as ghost
  text (`createPreview(rowId)` for a create, the block's `label` for a copy); while a move
  runs, the cell under the pointer is highlighted.
- A keyboard copy or move, and a refusal (taken, closed, past either end), are read by a polite
  live region. After a keyboard move, focus follows the block to its new cell once the host
  re-renders it there.

## Props

| Prop | Type | Description |
|---|---|---|
| `columns` | `ScheduleGridColumn[]` | `label`, `shortLabel?` (shown in a narrow grid), `sublabel?`, `today?` (label in the primary colour, cells framed). A day is its index here. |
| `groups` | `ScheduleGridGroup[]` | `title?` (upper-case heading, names the row group), `rows`: `id`, `label`, `meta?`, `metaTone?` (`'warning'` for "acima de 40h"), `total?`, `onLabelClick?` (makes the name a button), `labelAccessible?`. |
| `cell` | `(rowId, day) => ScheduleGridCell` | `blocks` (`id`, `label`, `note?`, `tone`, `movable?`, `copyable?`, `selected?`, `title?`), `blocked?` (hatched, refuses create and drop), `blockedLabel?`. Called for every cell on each render: keep it cheap. |
| `totalLabel` | `string?` | The last column's header ("horas"). |
| `readOnly` | `boolean?` | No "+", no grips, no drag; empty cells are not focusable. Block clicks still reach `onBlockClick`. |
| `onCreate` / `onCopy` / `onMove` / `onBlockClick` | see Gestures | Each gesture is offered only when its handler is given. |
| `createPreview` | `(rowId) => string` | The ghost text a create drag shows (the person's last hours). |
| `loading` | `boolean?` | Header + skeleton rows, `aria-busy`, nothing to press. |
| `error` | `ReactNode?` | Replaces the body (an `ErrorState` with its retry). |
| `empty` | `ReactNode?` | Shown when there are no rows at all. |
| `stickyTop` | `number?` (px, default 0) | Offset of the sticky header row under a pinned page bar. |
| `aria-label` | `string?` | The grid's name. |
| `labels` | `Partial<ScheduleGridLabels>` | `createCell(row, column)`, `blockedCell(row, column)`, `copied(block, column)`, `moved(block, row, column)`, `refused`, `loading`. Default: the English pack; a pt-BR host passes `UI_LABELS['pt-BR'].scheduleGrid`. |
| `dataTestId` | `string?` (default `schedule-grid`) | Parts: `-header`, `-row-${rowId}`, `-cell-${rowId}-${day}`, `-block-${blockId}`, `-grip-l-${blockId}`, `-grip-r-${blockId}`, `-live`, `-loading`. |

### Tones — never colour alone

| `tone` | drawn | its `note` carries |
|---|---|---|
| `plan` | raised chip, neutral border | "↻ toda semana", "↻ a cada 2 semanas" |
| `late` | solid warning | "Atrasado" |
| `away` | dashed warning outline | "Ausente" |
| `uncovered` | dashed warning outline | "Sem ninguém" |
| `onduty` | soft success ground, success border | "desde 08:26" |

## Layout

- Name column 200px · the day columns share the rest equally (`minmax(0, 1fr)`) · total 56px;
  6px gaps. Cells at least 56px tall; a cell's blocks stack (a split shift is two blocks).
- A block's label and note never wrap: one line each, an ellipsis, the full text in `title`.
- The header row is `position: sticky` (opaque, `background.default`) — it stays at the top of
  whatever scrolls the grid.
- **Container queries, not media queries:** below a 900px container the name column narrows to
  140px; below 600px to 96px, the grips go (drag-copy is a computer gesture; Shift+arrows still
  copy), the columns show `shortLabel` and drop `sublabel`. The grid always fits its container —
  but on a phone, render `DayRuler` for one day instead.

## Accessibility

`role="table"` with `rowgroup` / `row` / `columnheader` / `rowheader` / `cell`. Every empty cell's
"+" and every block is a native `<button>` (Tab, Enter, Space); blocks declare their shortcuts in
`aria-keyshortcuts`. A blocked cell is named by `blockedLabel` (or `labels.blockedCell`). The live
region is `role="status"`, polite.

## Related

`DayRuler` (the same blocks, one day by the hour), `SequenceResolver` (the problems a late, absent
or uncovered block opens).
