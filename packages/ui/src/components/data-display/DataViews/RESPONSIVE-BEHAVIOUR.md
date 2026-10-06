# The DataViews toolbar, at every width

The toolbar degrades through a **measured ladder**, not breakpoints. Nothing in
`data-views-overflow.ts` reads a media query: a `ResizeObserver` reports the
toolbar row's width, every control is priced, and the ladder sheds one rung at a
time until the row fits.

That is deliberate and worth restating, because it is what makes this document
approximate. Pages declare different numbers of filters with different label
lengths, and the same page collapses at a different width in another language. A
shared breakpoint is wrong for at least one table by construction.

**So the widths below are the ones the tests pin, not thresholds in the code.**
They are named for the device class they stand in for, and the behaviour column
is what the six-control Pedidos table does there. A two-filter table degrades
later; an eight-filter one degrades sooner. Both are correct.

| class | width | stands for |
| --- | --- | --- |
| small mobile | 320 | iPhone SE, the floor we support |
| large mobile | 430 | iPhone Pro Max |
| tablet | 768 | iPad portrait |
| small desktop | 1280 | laptop |
| large desktop | 1600 | external monitor |

The tests also pin a **crowded** row at 1024, because a small desktop no longer
overflows at all: the rules about what happens when controls do NOT fit need a
width where some of them do not.

**These are toolbar ROW widths, not viewport widths.** The `ResizeObserver`
watches the row, and the row is narrower than the window by whatever the page
puts around it — around 48px in the Pedidos shell. So a 430px row is roughly a
478px phone, and the same page at a 430px *viewport* sits one rung further down
than this table shows. The tests drive the row directly, which is the only
number the ladder ever sees.

---

## The one rule that outranks the rest

**The toolbar is one line and never scrolls sideways.** Not the row, not the
filter cluster, not the "Mais" panel, not the document. At any width, with any
combination of filters applied, with the search open or closed.

Everything below exists to keep that true. When a change breaks it, the fix is
another rung on the ladder — never a scrollbar, and never letting controls paint
outside the toolbar.

**"One line" is a rule about BROWSING.** Everything in this document describes
the row an operator reads a list from, and the ladder measures that row. The
selection row is a different row with different contents and no ladder at all —
see below.

---

## The selection row

Tick a checkbox and `exclusiveSelection` hands the whole toolbar to the
selection cluster: the search, the filters, Exibir and Exportar all stand down,
and what is left is "Limpar filtros", the count, whatever the host puts in
`selectionExtra`, and the actions menu.

### A grid with no selection: `selectable={false}`

That trade is only worth making when the selection has somewhere to go. A grid
whose last bulk action is removed still drew a checkbox on every row, and
ticking one took the search, the pills and Exportar away and offered nothing
back. A control whose only effect is to take the toolbar away is a defect, so
`DataViewsTableBase` / `DataViewsGrid` take `selectable` (default `true`, which
is the grid described above, unchanged). With `selectable={false}`:

- the table has no checkbox column: no header select-all, no row box, and no
  `padding="checkbox"` cell holding its width;
- cards, board cards and list rows are handed `DataViewCardSelection` without
  an `onToggleSelect`, so `BaseCard` and `BaseListCard` draw no checkbox (a
  renderer that passes the field on as-is needs no change), and a `listGroup`
  holds no empty select gutter open;
- the headerless layouts get no "Selecionar todos nesta página" strip, and the
  toolbar never shows a count;
- `exclusiveSelection` therefore never engages: nothing can be selected, so the
  browsing row — and everything on the ladder below — is the only row there is.

Row click (`onRowClick`) and the row menu (`renderRowMenu`, the `rowActions`
kebab) are untouched. `data-views-table.stories.tsx` → **NotSelectable** is
that grid; `__tests__/data-views-selectable.test.tsx` pins it.

### The selection row is not on the ladder

The selection cluster is not on the ladder, and it must not be. The ladder sheds controls
because each one it sheds has somewhere else to be — a filter into "Mais", a
label into an icon, "Limpar" into a panel footer. Nothing here does. Dropping
the count loses the only statement of what is about to be written to; dropping
"Ações" loses the reason the operator ticked anything.

**So below `md` it WRAPS instead**, which is the one thing the browsing row may
never do:

| | small mobile | large mobile | tablet | desktop |
| --- | --- | --- | --- | --- |
| checkbox + "Limpar filtros" + count | line 1 | line 1 | line 1 | line 1 |
| `selectionExtra` + "Ações" | line 2 | line 2 | line 2 | line 1 |

The break before `selectionExtra` is deliberate rather than wherever the row ran
out of room. What follows it is one thought — what the selection IS ("Seleção:
48 produtos — todas as páginas" and its "Limpar seleção") plus the control that
acts on it — and a natural wrap split that thought mid-phrase.

Before this, the cluster was pinned at content width with every child
`flex-shrink: 0`. On Produtos with the scope armed that is ~766px of controls,
so at 320 the row painted 446px past the toolbar's own edge and "Ações" sat
off-screen behind a sideways scroll of the document. The button the whole
selection exists to reach was the one you could not see.

`ContentToolbar.stories.tsx` → **NarrowSelectionOverflow** is that exact row.
Open it at 320 and 390; jsdom cannot see this failure, so no unit test can
guard it.

---

## The ladder

Cheapest loss first. Each rung is taken only if the one before it did not free
enough room.

| # | rung | flag | what goes |
| --- | --- | --- | --- |
| 1 | filter controls move into "Mais" | `inline` / `overflow` | one control at a time, idle ones first |
| 2 | Exibir / Exportar drop their labels | `compactControls` | the text, and the dropdown chevron with it |
| 3 | the search box shrinks | — | none; it is `flex: 1` and CSS does it |
| 4 | the search collapses to a magnifier | `searchCollapsed` | the box |
| 5 | the "N de N" counter is dropped | `counterHidden` | the count |
| 6 | "Limpar" leaves the bar | `clearAllHidden` | the button — it survives in the panel footer |

Rung order is not arbitrary. **A control leaves the bar early if it has somewhere
else to be, and late if it does not.** "Limpar" goes before the magnifier because
the "Mais" panel footer still carries "Limpar todos os filtros"; the magnifier
and "Mais" go last because nothing else on screen can stand in for them.

The counter goes before the search because it is the only thing left that
*reports* rather than *does* — an operator can act without knowing the total,
but not without a way to search.

---

### A host without the counter (`showCounter={false}`)

A list whose rows are not all records — section headings handed in as rows —
cannot use the counter: it counts every row it is given, so six items under
three headings read "9 de 9". `showCounter={false}` takes it off the bar AND
out of the ladder's budget (it is priced at 0 at every rung), so nothing is shed
and no gap is left for a control that is not there. Hiding it from the outside
with CSS does neither: the ladder still pays for it. Pinned in
`__tests__/data-views-show-counter.test.tsx`.

## Behaviour by class

Read this as "what the Pedidos table does", not "what the code hard-codes".

### Filters

| | small mobile | large mobile | tablet | small desktop | large desktop |
| --- | --- | --- | --- | --- | --- |
| controls on the bar | 0 | 1 | 1 | all 6 | all 6 |
| "Mais" present | yes | yes | yes | no | no |

**The bar re-spends what its own collapse frees.** Rungs 2/4/5 turn 200 + 96 +
216 of furniture into 44 + 0 + 140, and the split used to be decided once,
against the UNCOLLAPSED row — so a phone shed all six controls to make room for
a search box and a counter that were about to shrink, and nobody handed the
~330px back. It showed as a 428px bar carrying a magnifier, "Mais 6", and a
225px band of nothing. `computeSplit` now iterates to a fixed point: cheaper
furniture buys more filters, more filters push the ladder further down, a
further rung makes the furniture cheaper again, and the budget decreases
monotonically until it stops moving.

The furniture is also priced for what is ACTUALLY on the bar. "Exportar" exists
only when the host passes an `exportConfig` — several screens put their export
in the page header instead — and charging for the pair regardless billed the
filters ~108px for a button that was never rendered.

Which control survives on a phone is whichever fits the room left over, so a
large mobile keeps a cheaper pill where a tablet affords a wider one.

**An applied filter is ranked first, not exempt.** Applied controls take the
visible slots ahead of idle ones and go into "Mais" like anything else when even
those run out. The earlier rule exempted them outright, and on a phone four
applied pills then claimed more width than the row had: the bar painted past its
own edge and the pills were reachable only by scrolling it sideways.

Hiding one is safe *because the badge says so* — see below. A control scrolled
off-screen carries no signal at all, which is the failure the exemption was
written to prevent and did not.

### The "Mais" badge

| state | badge shows | tone |
| --- | --- | --- |
| overflowed fields, none applied | count of hidden **fields** | neutral |
| any overflowed field applied | count of **applied** ones | filled, primary |

A neutral "3" would make *three filters you have not used* and *three filters
narrowing this list* look identical. On a phone, where every filter is in there,
that badge is the only thing on screen saying the list is filtered at all.

### Search

| | small mobile | large mobile | tablet | small desktop | large desktop |
| --- | --- | --- | --- | --- | --- |
| resting state | magnifier | magnifier | box | box | box |
| on expanding the magnifier | **takes over** the cluster | shares the row | — | — | — |

The share/takeover boundary sits inside the "large mobile" band and moves with
the table: it is a comparison against what the box would actually be left with,
so a page with four short filter labels shares where Pedidos, with six longer
ones, takes over. Measured on the real Pedidos screen, takeover begins at a
500px viewport and sharing resumes at 600px.

Two distinct behaviours, and conflating them was a bug:

- **Shrink** (`fill`) — an expanded box drops its usual 200px floor and takes
  whatever the cluster has. That floor is right for a box that lives on the row
  permanently; it is wrong for one expanded into a cluster the ladder sized for
  an icon, where insisting on it made the row scroll (154px of overhang at
  320px, 84px at 390px, 42px at 500px).
- **Takeover** (`searchTakeover`) — the filters stand down and the box owns the
  cluster, with a ✕ to leave. Only where shrinking has run out of road and what
  is left would be too narrow to read back. On a large phone there is room to
  share, and evicting the filters there cost the operator their filters for
  nothing.

### The right-hand controls

| | small mobile | large mobile | tablet | small desktop | large desktop |
| --- | --- | --- | --- | --- | --- |
| Exibir / Exportar | icon | icon | label | label | label |
| dropdown chevron | no | no | yes | yes | yes |
| "N de N" counter | hidden | shown | shown | shown | shown |

The counter is priced at 56, not the old 96. It was measured against
"1.234 de 5.678"; a phone reads "3 de 3" and renders at 35px, so the extra
~60px was coming straight out of the filter budget at exactly the widths where
that budget is scarcest.

A tablet keeps the labels, which is worth stating because it is easy to assume
otherwise. With every filter already behind "Mais" the row has room to spare
there, and rung 2 is taken only when the search would otherwise fall below its
floor. The ladder spends the width it has rather than degrading on a schedule —
that is the whole point of measuring.

The chevron goes with the label. A bare icon already reads as a button, and the
~24px each buys is the difference between a row that fits and one that scrolls.
It is dropped from Exibir, Exportar **and** "Mais" together — one chevron left
among three identical buttons reads as a defect.

### Clear all

| | small mobile | large mobile | tablet | small desktop | large desktop |
| --- | --- | --- | --- | --- | --- |
| on the bar | no | no | icon | icon | icon + "Limpar" |
| in the panel footer | yes | yes | yes | yes | yes |

Present only while something is applied — a dead button is worse than none — and
last in the cluster, because it is destructive and must never appear where a
filter control was a moment ago.

It is styled flat: no border, no fill, muted until hovered. Every other control
on the row is an outlined pill because it *opens* something; this one is an
escape hatch, and giving it the same weight made it read as a sixth filter.

### Scope tabs

Below the toolbar, above the rows they narrow. Hidden entirely when the board
layout groups by the same field the scopes partition by — a column per situação
and a tab per situação are the same partition offered twice, and picking one tab
leaves the board with a single populated column, which reads as data loss.

---

## Where this is tested

`__tests__/data-views-responsive.test.tsx` drives a fake `ResizeObserver` at each
of the five widths and asserts the tables above. It is the executable copy of
this document; if the two disagree, the test is right and this needs updating.

`what fits follows the controls, not the width alone` guards the property the
rest of this document depends on: the counts above are OUTCOMES of pricing one
fixture against one row, never rules. At a single width it asserts that a table
declaring cheaper controls keeps more of them, that one long control keeps
none, and that the same table promotes another as its row grows — three answers
a breakpoint could not give.

Two things it cannot check, because jsdom has no layout engine: actual pixel
overflow, and how anything looks. Those are verified in a real browser against
the running Storybook, at 1600 / 1280 / 1024 / 900 / 768 / 600 / 500 / 430 / 390
/ 360 / 320, measured on the toolbar row, the filter cluster's own scroll box,
and the document.

---

## Quick chips and `inMore` fields

`quickFilters` puts one-click toggle chips at the head of the bar, each applying
ONE value of a declared pill field (`pills[fieldId] = [value]`). The field they
write to is not drawn as a pill: the chips stand in for it. Everything else —
the counter, "Limpar", saved views, the URL — treats a pressed chip as the
filter it is.

Chips are on the ladder like any control. They rank ahead of idle pills for the
bar's slots, and on a row with no room they move into "Mais" as a toggle row
with the same label and count — never a sideways-scrolling strip, which the one
rule above forbids. A pressed chip in "Mais" counts towards the trigger's
applied badge.

`inMore: true` on a pill or range field keeps it off the bar at every width: it
is behind "Mais" from the start, so "Mais" is always drawn. Use it beside quick
chips, so the daily question is not crowded by the facets that are not.

Chips keep their slots: they rank ahead of everything in their DECLARED order
whatever is pressed — ahead of APPLIED pills too, which reverses the "applied
first" rule for them: a chip is the page's fixed question, and an applied pill
in "Mais" still shows in the trigger's applied badge — stay a prefix of that order (never the second without the
first). Pressing one adds "Limpar", which can cost room: what leaves the bar is
an idle pill first, or the chips together — never one chip swapped for another
under the hand that pressed it. A chip reads as pressed
only when its value is the field's WHOLE selection.

A chip declared `default: true` is the page's unfiltered view ("Precisa repor"):
it reads pressed while its field is EMPTY, and pressing it empties the field
rather than writing its value. So the default view is no filter: no "Limpar" on
arrival, no applied badge on "Mais", and "Limpar" from any other chip lands back
on it. The host owns what the empty field means (the grid filters nothing for
it); seeding the value instead made "Limpar" show on arrival and do nothing.
`data-views-quick-default.test.tsx` pins it.

Both are inline-bar features: in the classic slide-in panel (`inlineFilters`
off) there is no bar, and the chips' field is drawn as its ordinary pill.

`data-views-quick-filters.test.tsx` and `data-views-quick-filters-measured.test.tsx` pin both; **QuickFiltersSticky** in
`data-views-table.stories.tsx` shows them.

## The sticky toolbar

`stickyToolbar` pins the toolbar band to the visible top of the page's scroll
area, and the table's header row right under it, while what is above the grid
scrolls away. Two details make it work on a real page:

- **The bar's `top` is the negative of the scroll container's top padding**,
  read from the live layout (`useStickyBarTop`). `top: 0` sticks to the content
  edge, inside the padding, which left a padded pane showing rows above the bar.
- **The header is translated, not `position: sticky`** (`useStickyTableHead`).
  The table keeps its own sideways scroll, which makes its wrapper a scroll
  container that never scrolls vertically, so a sticky cell would stick to a box
  that never moves. The cells follow the page by `translateY`, clamped inside
  their own table.
