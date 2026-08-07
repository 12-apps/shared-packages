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

## Behaviour by class

Read this as "what the Pedidos table does", not "what the code hard-codes".

### Filters

| | small mobile | large mobile | tablet | small desktop | large desktop |
| --- | --- | --- | --- | --- | --- |
| controls on the bar | 0 | 0 | 0 | 1–2 | 3+ |
| "Mais" present | yes | yes | yes | yes | only if something overflowed |

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
| "N de N" counter | hidden | hidden | shown | shown | shown |

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

Two things it cannot check, because jsdom has no layout engine: actual pixel
overflow, and how anything looks. Those are verified in a real browser against
the running Storybook, at 1600 / 1280 / 1024 / 900 / 768 / 600 / 500 / 430 / 390
/ 360 / 320, measured on the toolbar row, the filter cluster's own scroll box,
and the document.
