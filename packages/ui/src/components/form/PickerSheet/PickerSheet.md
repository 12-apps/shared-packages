# PickerSheet Component

A searchable pick-or-create sheet. A title (with an optional kicker above it), a
search box, a list of rows that may be a tree, an optional create row, and an
optional note underneath. On a pointer it is a centred dialog; on a phone it is
a bottom sheet. It is only the sheet — the trigger that opens it is the
caller's.

Every word it shows comes from the caller: the package ships no copy for it.

## Purpose and Use Cases

- One picker pattern for every "choose one of these, or add it" field in an
  editor: a product's category, its kitchen station, the product behind a paid
  add-on, a recipe component.
- Use it when the field opens a focused choice of its own. For an inline
  searchable field use `CreatableSelect`; for a category FILTER (multi-select,
  parents as headings) use `CategorySelect`; for a command menu use `Command`.

## Props Documentation

- **open** (`boolean`): whether the sheet is shown. The query resets each time it opens.
- **onClose** (`() => void`): Esc, a tap outside, and the close button. Picking does NOT call it.
- **kicker** (`string`): small muted line above the title.
- **title** (`string`, required): the dialog's name — the dialog is `aria-labelledby` it.
- **searchPlaceholder** (`string`, required): the search box's placeholder.
- **searchLabel** (`string`, required): the search box's accessible name.
- **closeLabel** (`string`, required): the close button's accessible name.
- **items** (`PickerSheetItem[]`, required): the rows, in order.
  - **id** (`string`): what `onPick` receives.
  - **label** (`string`): the row's first line.
  - **meta** (`string`): a muted second line — a category's path, a price.
  - **indent** (`number`): tree depth, drawn as 28px of left padding per level. Applied only while the query is empty; a search flattens the list, so put the path in `meta`.
  - **selected** (`boolean`): the current value — tinted row, check mark at the right, `aria-selected="true"`.
  - **searchText** (`string`): more text the query matches beside the label, which always matches — a path, synonyms. Defaults to `meta`.
  - **hideWhileSearching** (`boolean`): a row that is not a thing to find (a "None" row) — shown with an empty query only.
- **onPick** (`(id: string) => void`, required): called with the chosen item's id, and nothing else happens — close the sheet yourself.
- **createLabel** (`(query: string) => string`): the create row's text.
- **createMeta** (`(query: string) => string`): a muted second line under the create row — what creating does.
- **onCreate** (`(query: string) => void`): called with the TRIMMED query. The create row is offered last when both `createLabel` and `onCreate` are given and the trimmed query matches no item label exactly (case and accents aside).
- **emptyText** (`(query: string) => string`): shown instead of the list when nothing matches and there is no create row.
- **foot** (`string`): the note under the list.
- **animated** (`boolean`, default `true`): `false` opens and closes the sheet at once, with no fade or slide — for a host whose design draws its overlays without motion.
- **dataTestId** (`string`, default `picker-sheet`): on the sheet's paper. Sub-elements: `${id}-search`, `${id}-item-${item.id}`, `${id}-create`, `${id}-close`, plus `${id}-check-${item.id}`, `${id}-create-meta`, `${id}-empty`, `${id}-foot`, `${id}-list`.

## Behaviour

- Nothing takes focus inside the sheet on open — the dialog itself does — so a phone does not raise its keyboard over the list. The list opens at its top. Tab reaches the search box.
- Filtering is a substring match on each item's label and `searchText`, case and ACCENTS aside ("acai" finds "Açaí", as in `CategorySelect`).
- ↑/↓ move the keyboard cursor (wrapping at both ends, as `Command` does) and Enter picks the row under it. Typing puts the cursor on the first match, so "type, then Enter" picks it — or creates, when the create row is the only row. The cursor is drawn only once an arrow key has moved it: typing alone shows no ring on a phone.
- Esc and a tap outside close (through `onClose`).
- The search box is a `combobox` over a `listbox`; rows are `option`s and the cursor is announced through `aria-activedescendant`.
- Layering: both surfaces sit at `stackedOverlayZIndex` (`tokens/layers`), so a sheet opened from inside a `StackedModal` paints ABOVE it, however deep the stack.
- Surface: under `CategorySelect`'s sheet breakpoint (480px) it is a full-width bottom sheet (radius 16 16 0 0, max-height 88%, no grab handle); above it, a centred 520px dialog (max-height 780px, radius 14).

## Usage Examples

### A category field

```tsx
const [open, setOpen] = useState(false);

<PickerSheet
  open={open}
  onClose={() => setOpen(false)}
  kicker={copy.product}
  title={copy.category}
  searchPlaceholder={copy.searchCategory}
  searchLabel={copy.searchCategory}
  closeLabel={copy.close}
  items={categories.map((category) => ({
    id: category.id,
    label: category.name,
    meta: category.path,              // "Drinks › Juices"
    indent: category.depth,
    selected: category.id === value,
  }))}
  onPick={(id) => {
    setValue(id);
    setOpen(false);
  }}
  createLabel={(query) => copy.createCategory(query)}
  onCreate={async (name) => {
    const created = await createCategory(name);
    setValue(created.id);
    setOpen(false);
  }}
  foot={copy.categoryFoot}
/>
```

### Pick only

Leave out `onCreate` and give `emptyText`, so a query that matches nothing says so.

```tsx
<PickerSheet
  open={open}
  onClose={close}
  title={copy.station}
  searchPlaceholder={copy.searchStation}
  searchLabel={copy.searchStation}
  closeLabel={copy.close}
  items={stations}
  onPick={pickStation}
  emptyText={(query) => copy.noStation(query)}
/>
```

## Accessibility Notes

- The dialog is named by `title`; on a phone the bottom sheet's paper carries `role="dialog"`, `aria-modal` and the same `aria-labelledby`.
- Focus is contained by the modal and returns to the trigger on close.
- Selection is `aria-selected` on the option, not colour alone — the check mark is drawn too.

## Styling Notes

- Sizes are the prototype's own px drawn through `rem()` (`tokens/relative`), so a density mode scales the sheet with everything else.
- The search field takes the library's field height, border and corner (`tokens/field-height`, `tokens/field-radius`).
- Colours are palette roles: `background.paper` for the surface, `divider` for the rules, `action.hover` on hover, `primary.main` at 0.10 for the selected row and for the check and the create row.
