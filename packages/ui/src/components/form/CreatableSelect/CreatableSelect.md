# CreatableSelect Component

A single-select, searchable combobox that can create a brand-new option inline.
Type to filter the options; when the typed text matches nothing, an optional
"create" row lets the user add it on Enter. Built on MUI `Autocomplete` +
`TextField`, so it matches the height and theming of the other form fields.

## Purpose and Use Cases

- Pick-or-create pickers: category, tag, brand, supplier — anywhere the list of
  valid values grows as users type new ones.
- A searchable replacement for `Select` when the option list is long.
- Any field where "not in the list yet? just type it and press Enter" is the
  desired UX.

## Props Documentation

- **options** (`CreatableSelectOption[]`): available options, each `{ value, label, depth? }`. `depth` (0 = top level) indents the option ROW for a hierarchical list; `label` stays the bare name, so the closed field and anything else reading the selected option never shows the tree drawing.
- **value** (`string | null`): the selected option's `value` (`null`/`""` = none).
- **onChange** (`(value: string | null) => void`): fired with the chosen `value`, or `null` when cleared.
- **onCreate** (`(label: string) => void | Promise<void>`): enables create-on-Enter. When the typed text matches no option, a create row appears; choosing it calls `onCreate` with the raw text. The parent persists it and feeds the new option back through `options`/`value`. Omit to make the field a plain searchable select.
- **label** (`string`): field label.
- **placeholder** (`string`): placeholder shown when empty.
- **createOptionLabel** (`(input: string) => string`, REQUIRED): builds the create-row label. No default — a pt-BR one used to ship, which is how a host in any other language inherited it silently (FUT-760).
- **noOptionsText** (`string`): text shown when nothing matches and creation is disabled.
- **disabled** (`boolean`): disable the field.
- **loading** (`boolean`): show a spinner in the adornment (e.g. while a create request is in flight).
- **fullWidth** (`boolean`): stretch to the container width (default: `true`).
- **dataTestId** (`string`): base test id; the input is `<dataTestId>-input` (default: `creatable-select`).

## Usage Examples

### Searchable select (no create)

```tsx
<CreatableSelect
  label="Categoria"
  options={categories}
  value={categoryId}
  onChange={setCategoryId}
/>
```

### Pick-or-create

```tsx
<CreatableSelect
  label="Categoria"
  options={categories}
  value={categoryId}
  loading={creating}
  onChange={setCategoryId}
  onCreate={async (name) => {
    const created = await createCategory(name); // persist server-side
    setCategories((prev) => [...prev, created]); // feed the new option back
    setCategoryId(created.value);                // select it
  }}
/>
```

## Accessibility Notes

- Inherits MUI `Autocomplete` roles (`combobox`, `listbox`, `option`) and keyboard
  support: arrow keys to move, Enter to select (including the create row), Escape
  to close, Home/End to jump.
- The label is associated with the input via MUI `TextField`.
- `loading` surfaces a spinner without blocking keyboard interaction.

## Best Practices

1. Keep `options` in sync after `onCreate` resolves — append the created option and
   set `value` to it so the new selection sticks.
2. Use `loading` while the create request is in flight to signal progress.
3. `createOptionLabel` is required, so the create-row label is always the host’s own.
4. Omit `onCreate` entirely when free creation is not allowed — the field then
   behaves as a plain searchable select and shows `noOptionsText`.

## Testing

### Test IDs

- `<dataTestId>` (default `creatable-select`) — the Autocomplete root.
- `<dataTestId>-input` — the text input, for typing queries.

### Example

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { CreatableSelect } from './CreatableSelect';

test('creates a new option on Enter', () => {
  const onCreate = vi.fn();
  render(
    <CreatableSelect
      options={[{ value: '1', label: 'Bebidas' }]}
      value={null}
      onChange={vi.fn()}
      onCreate={onCreate}
      dataTestId="cat"
    />,
  );
  const input = screen.getByTestId('cat-input');
  fireEvent.change(input, { target: { value: 'Sobremesas' } });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onCreate).toHaveBeenCalledWith('Sobremesas');
});
```

## Related Components

- **Select**: fixed-option single/multiple select (no inline create).
- **Autocomplete**: free-text suggestion input with ghost-text completion.
- **AddressAutocomplete**: address-specific autocomplete backed by Google Places.
