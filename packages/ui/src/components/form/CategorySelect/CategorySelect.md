# CategorySelect

A hierarchical category picker: **categories are the frame, subcategories are what
you pick.**

```tsx
import { CategorySelect } from '@12-apps/ui/form/CategorySelect';
```

## Why it exists

A flat select over a two-level catalogue forces an ambiguity on the user: ticking
"Bebidas" might mean the category itself or everything under it, and there is no
way to tell which from looking. This component removes the question by making the
category a heading and the subcategory the selectable thing — and, where a caller
genuinely needs "the whole category" as a value, by making that an explicit opt-in
(`allowParentSelection`) with a tri-state checkbox that says so.

## Options

Pass the catalogue **flat, carrying `parentId`** — the shape the API already
returns. The component nests it internally, memoised.

```tsx
const options = [
  { id: 'beb', name: 'Bebidas', count: 214 },
  { id: 'beb.agua', name: 'Águas', parentId: 'beb', count: 38 },
  { id: 'beb.refri', name: 'Refrigerantes', parentId: 'beb', count: 52 },
];
```

Never pre-indent `name` (`"— Águas"`). The row draws the nesting; a baked-in dash
travels everywhere the label goes, including the closed trigger.

A category with no children is selectable in its own right. An option whose
`parentId` matches nothing is promoted to top level rather than dropped, so a
partial payload never makes a category invisible.

## The two modes

### `multi` — the filter

Ticks accumulate in a **draft**; `onChange` fires only when Apply is pressed. This
is the point of the mode: the list behind the panel does not refetch on every
click, and dismissing the panel discards.

```tsx
const [categories, setCategories] = useState<string[]>([]);

<CategorySelect options={options} value={categories} onChange={setCategories} />;
```

### `single` — the "move to…" picker

Choosing a row commits immediately; there is nothing to batch. The trigger then
reads `Pai › Filha`, so the chosen leaf keeps its context.

```tsx
<CategorySelect
  mode="single"
  label="Categoria"
  options={options}
  value={categoryId}
  onChange={setCategoryId}
/>
```

## Behaviour worth knowing

- **Opens fully expanded.** Nothing a search could match hides behind a
  disclosure.
- **Selected categories pin above the list.** They survive scrolling and
  searching — a tick made at the bottom of a ten-category tree does not vanish
  the moment you look for the next one.
- **Search is accent-insensitive, both directions.** `agua` finds `Águas`;
  `graos` finds `Grãos e farináceos`. The hit is marked, and it always renders
  under its parent, which is what tells `Massas` (mercearia) from `Massas`
  (pratos principais).
- **A fully selected category collapses to one chip** bearing the category name,
  rather than one chip per child.
- **Below 480px the panel becomes a bottom sheet.**

## Keyboard

| Key | Does |
| --- | --- |
| `↑` `↓` | Move the cursor |
| `→` | Expand the category |
| `←` | Collapse it, or jump from a subcategory to its parent |
| `Space` | Mark the row (single-select: pick it) |
| `Enter` | Apply (single-select: pick) |
| `Esc` | Cancel, returning focus to the trigger |

`Space`, `←` and `→` belong to the search field **only while it holds text**. The
panel opens focused on an empty field, so yielding them unconditionally would
leave the tree undrivable from the keyboard; type one character and they revert to
the field.

## Styling

Geometry is the design's absolute pixels — 38px trigger, 340px panel, 36px rows,
1.5px checkbox borders. Those are deliberately not derived from `theme.spacing`,
which is an 8px grid and would round the design away.

**Colours come from the theme.** A tenant can white-label the palette, and the
library ships a dark mode; a hard-coded indigo would survive the rebrand while the
rest of the screen changed. On the default light theme the tokens resolve to the
design's own values.

## Props

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `options` | `CategorySelectOption[]` | — | Flat, with `parentId` |
| `mode` | `'multi' \| 'single'` | `'multi'` | |
| `value` | `string[]` / `string \| null` | — | Shape follows `mode` |
| `onChange` | `(next) => void` | — | Fires on Apply / on pick |
| `label` | `string` | — | Rendered above the trigger |
| `placeholder` | `string` | `'Categoria'` / `'Mover para…'` | |
| `error` | `string` | — | Message + errored styling |
| `disabled` | `boolean` | `false` | |
| `loading` | `boolean` | `false` | Skeleton rows |
| `fullWidth` | `boolean` | `false` | |
| `showCounts` | `boolean` | `false` | Trailing `count` per row |
| `allowParentSelection` | `boolean` | `false` | Makes categories selectable |
| `onCreateCategory` | `() => void` | — | CTA on the empty catalogue |
| `dataTestId` | `string` | `'category-select'` | |

## Test ids

Derived from `dataTestId`: `-trigger`, `-count`, `-clear-trigger`, `-panel`,
`-search`, `-search-clear`, `-select-all`, `-expand-all`, `-pinned`,
`-unpin-<id>`, `-list`, `-category-<id>`, `-expand-<id>`, `-option-<id>`,
`-footer`, `-clear`, `-apply`, `-cancel`, `-no-results`, `-empty-catalogue`.
