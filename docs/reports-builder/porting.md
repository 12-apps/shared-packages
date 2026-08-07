# Porting the prototype into the app

The prototype is a **specification written in code**, not source to copy. It's vanilla DOM + its own CSS tokens; the app is React + MUI with an existing design system. There is no "reproduce as is" — there is a port, and a port needs an explicit mapping.

This file is that mapping, plus the prompts.

---

## 1. State the fidelity contract up front

Every failed port starts with an unstated one. Pick per layer and put it in the prompt:

| Layer | Contract |
|---|---|
| **Interaction** | **Exact.** Snapping, drop-target weighting, cancel behaviour, dirty-state rules, keyboard equivalents. These are the parts prose omits, and they're the reason the prototype exists. |
| **Information architecture** | **Exact.** Which control lives in which panel, what's in the header vs the drawer, section order and labels. |
| **Copy** | **Exact.** It's already in pt-BR and already reviewed. Copy it verbatim. |
| **Visual** | **Approximate.** Use the app's existing components and tokens. Do *not* recreate the prototype's CSS. |
| **Code structure** | **Ignore entirely.** See §2. |

Without that table, the agent guesses — and it usually guesses "visual: exact", which is why you get a mess that neither matches the prototype nor fits the app.

---

## 2. Do not port the JavaScript

Say this explicitly in the prompt. The prototype's JS is imperative full-rerender DOM code — `renderEdit()` blows away `innerHTML` on every keystroke. Ported literally into React it produces exactly the wrong thing.

Two parts are worth extracting, and only these:

**The state shape** (already in `plan.md` as `ReportSpec` / `Block`) — this ports directly.

**The interaction constants**, which are genuinely load-bearing and nowhere else written down:

```
Drop target selection:  nearest block centre, y distance weighted 1.4×
Insertion indicator:    3px; vertical if pointer is within the target's
                        top/bottom, horizontal otherwise
Resize snapping:        [4, 6, 8, 12] columns only
Column width:           (gridWidth - gap * 11) / 12,
                        gap read from getComputedStyle — differs per breakpoint
Resize re-render:       CSS span live during drag; chart re-render once, on drop
Edge auto-scroll:       within 110px of viewport top/bottom
Cancel:                 Escape restores original position/width
Dirty:                  only if the value actually changed
Post-drop click:        suppressed, or it re-triggers selection
Keyboard:               Alt+↑/↓ reorders, Shift+←/→ resizes, both announced
```

For React, the drag/resize implementation should be **`@dnd-kit`**, not a port of the prototype's pointer handlers. `@dnd-kit/sortable` with `rectSortingStrategy` gives you the grid-aware sorting, the keyboard sensor and the live-region announcements. The constants above are what you feed it; the pointer plumbing is not.

---

## 3. Component inventory — fill this in before any code

This is the artifact whose absence is causing the failures. One row per prototype element, mapped to what you already have. Do it once, commit it, reference it in every port prompt.

| Prototype | Existing component? | Decision |
|---|---|---|
| `.btn` / `.btn.primary` / `.btn.sm` | | |
| `.chip` (Publicado / Rascunho / Arquivado) | | |
| `.seg` (period segmented control) | | |
| `.switch` (compare toggle) | | |
| `.card` (report list card) | | |
| `.pill` (scope filter) | | |
| `.block` (block shell + header + tools) | | new |
| `.panel` (config side panel / bottom sheet) | | |
| `select` / `input` in the panel | | |
| `.viz-grid` (viz type picker) | | new |
| `.width-picker` | | new |
| `.tpl` (template card in picker) | | new |
| `.modal` (block picker) | | |
| `.drawer` (settings) | | |
| `.toast` + undo | | |
| Charts | | existing lib |

Three outcomes per row: **use existing as-is**, **extend existing**, **build new**. The agent should propose this table and you approve it — that conversation is where "we already have a SegmentedControl" surfaces, and it saves an entire component.

> **Filled in against this repo:** see [`orientation.md` §3](./orientation.md#3-component-inventory-porting-md-3).

---

## 4. Design tokens

If you want the visual direction rather than your current MUI defaults, these are the prototype's values. Map them onto your theme once; don't let each component re-derive them.

```
ink        #141726   primary text
ink-2      #464c63   labels, secondary controls
muted      #6f7691   axis labels, hints  (≥4.5:1 on white — deliberate)
faint      #98a0b8   metadata only
line       #e7e9f2   borders
line-2     #f1f2f8   fills, hover, gridlines
canvas     #f7f8fc   page background
surface    #ffffff   cards
accent     #5750e0   primary
accent-wk  #eeecff   selected background
accent-ink #3b34bd   accent text/hover
series     #5750e0 / #0f9b8e / #c98a04 / #d84f7d   (luminance-separated)
ok         #0c7d70   danger #c8323e
radius     10px cards · 8–9px controls
type       Inter 13/13.5/14 UI · JetBrains Mono for numbers, axes, spec line
```

The mono face on axis values and the spec sentence is a real choice, not decoration — it aligns digits and visually separates machine-generated text from prose. Worth keeping.

---

## 5. Prompts

### Inventory (run first, once)

```
Read docs/reports-builder/porting.md and open
docs/reports-builder/prototype.html in a browser.

Fill in the component inventory table in §3 against this codebase.
For each row: does an equivalent exist, where, and would you use it
as-is, extend it, or build new? Note anything in our design system
the prototype ignores that we should use instead.

Output the completed table. Change no files.
```

### Port one screen

```
Port the reports LIST screen from docs/reports-builder/prototype.html.

Fidelity: interaction exact, IA exact, copy verbatim (pt-BR),
visuals using our design system per the inventory in porting.md §3.
Do NOT port the prototype's JS or CSS — it's a spec, not source.

Scope: the list screen only. Cards, search, scope pills, empty state,
and the three "new report" entry points. Not the editor, not the
block picker.

Show me your component plan before writing code.
```

### Port one interaction

```
Implement block reordering in the editor.

Use @dnd-kit/sortable with rectSortingStrategy. Do not port the
prototype's pointer handlers.

The interaction contract is in porting.md §2 — every constant there is
deliberate. Match all of them, including: Escape cancels, a drop that
lands in place does not mark the report dirty, and Alt+↑/↓ does the
same thing with a live-region announcement.

Verify by opening prototype.html side by side with our implementation.
```

---

## 6. Close the visual loop

Agents can't see their output unless you let them. If you have Playwright or Puppeteer available, put this at the end of every port prompt:

```
When it renders, screenshot our screen and prototype.html at 1440px
and 390px. Compare them and list every difference, then tell me which
are intentional (design-system substitutions) and which are bugs.
```

This single addition changes port quality more than anything else in this file. Without it the agent is writing CSS blind and reporting success based on the code compiling.

---

## 7. If it's still failing

Check, in order:

1. **Is the prototype a file in the repo, or was it pasted into chat?** Pasted, it competes with everything else for context and gets truncated. As a file, the agent reads the 40 lines it needs.
2. **Is the task one screen, or all four?** All four never works.
3. **Did the inventory step run?** Without it the agent invents components that duplicate yours, and the result looks foreign no matter how faithful the behaviour is.
4. **Is the fidelity contract in the prompt?** If not, the agent is optimising for a target you haven't named.
5. **Can the agent see its own output?** If not, add §6.
