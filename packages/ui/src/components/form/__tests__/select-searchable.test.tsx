/**
 * A `Select` past five options becomes a search box over a bounded list.
 *
 * MUI's menu grows to the viewport to show every option, so a 24-person staff
 * picker covered the screen top to bottom with nothing to narrow it by. From
 * six options on the field is the searchable dropdown (`CreatableSelect`'s
 * engine) — and it keeps the `Select` contract, which is what these pin: the
 * same `onChange(event)` shape with the value's own type, disabled options,
 * the test ids, and an explicit `searchable` overriding the count.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Select } from '../Select';

const few = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ value: `p${index}`, label: `Pessoa ${index}` }));

const STAFF = [
  { value: 'ana', label: 'Ana Souza' },
  { value: 'bruno', label: 'Bruno Carvalho' },
  { value: 'carla', label: 'Carla Dias', disabled: true },
  { value: 'diego', label: 'Diego Lima' },
  { value: 'elis', label: 'Elis Prado' },
  { value: 'fabio', label: 'Fábio Toledo' },
  { value: 'gustavo', label: 'Gustavo Rezende' },
];

/** The searchable field's `<input>` — a menu `Select` has none. */
const searchInput = (root: HTMLElement): HTMLInputElement | null =>
  root.querySelector('input[role="combobox"]');

/**
 * Wait for the search box. It is fetched on demand (`React.lazy`), so the first
 * frame shows the menu select holding its place.
 */
async function ready(testId: string): Promise<HTMLInputElement> {
  await waitFor(() => expect(searchInput(screen.getByTestId(testId))).not.toBeNull());
  return searchInput(screen.getByTestId(testId))!;
}

/**
 * Type into the search box as a user does. MUI's Autocomplete filters only
 * while its input is the focused element, so the focus is a real `.focus()`
 * (the pattern `autocomplete-closes-after-pick.test.tsx` uses), not a
 * synthetic event.
 */
async function typeInto(testId: string, text: string): Promise<void> {
  const input = await ready(testId);
  await act(async () => {
    // eslint-disable-next-line test-flakiness/no-focus-check, test-flakiness/await-async-events -- real focus: Autocomplete filters only while its input is document.activeElement
    input.focus();
  });
  fireEvent.change(input, { target: { value: text } });
}

async function open(testId: string): Promise<HTMLElement> {
  await ready(testId);
  fireEvent.mouseDown(within(screen.getByTestId(testId)).getByRole('combobox'));
  return screen.findByRole('listbox');
}

describe('Select — searchable past five options', () => {
  it('keeps the menu for five options', () => {
    render(<Select options={few(5)} label="Pessoa" value="" onChange={vi.fn()} data-testid="s" />);
    expect(searchInput(screen.getByTestId('s'))).toBeNull();
  });

  it('holds the field with the menu select while the search box loads', async () => {
    render(<Select options={few(6)} label="Pessoa" value="pessoa" onChange={vi.fn()} data-testid="s" />);
    // First frame: the field and its label are already there, before the fetch.
    expect(screen.getByTestId('s')).toHaveTextContent('Pessoa');
    await ready('s');
  });

  it('becomes a search box from six options on', async () => {
    render(<Select options={few(6)} label="Pessoa" value="" onChange={vi.fn()} data-testid="s" />);
    await ready('s');
    expect(screen.getByTestId('s-select')).toBe(searchInput(screen.getByTestId('s')));
  });

  it('filters the list by what is typed', async () => {
    render(<Select options={STAFF} label="Pessoa" value="" onChange={vi.fn()} data-testid="s" />);
    await typeInto('s', 'dieg');
    const listbox = await screen.findByRole('listbox');
    await waitFor(() => expect(within(listbox).getAllByRole('option')).toHaveLength(1));
    expect(within(listbox).getByTestId('s-option-diego')).toHaveTextContent('Diego Lima');
  });

  it('emits the Select change shape, with the value of the option picked', async () => {
    const onChange = vi.fn();
    render(
      <Select
        options={[...STAFF, { value: 7, label: 'Sete' }]}
        label="Pessoa"
        name="person"
        value=""
        onChange={onChange}
        data-testid="s"
      />,
    );
    const listbox = await open('s');
    fireEvent.click(within(listbox).getByTestId('s-option-7'));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [event] = onChange.mock.calls[0]!;
    expect(event.target).toEqual({ value: 7, name: 'person' });
  });

  it('shows the chosen option in the field and keeps a disabled one unpickable', async () => {
    const onChange = vi.fn();
    render(<Select options={STAFF} label="Pessoa" value="bruno" onChange={onChange} data-testid="s" />);
    expect((await ready('s')).value).toBe('Bruno Carvalho');
    const listbox = await open('s');
    const carla = within(listbox).getByTestId('s-option-carla');
    expect(carla).toHaveAttribute('aria-disabled', 'true');
  });

  it('bounds the list height instead of growing to the viewport', async () => {
    render(<Select options={few(40)} label="Pessoa" value="" onChange={vi.fn()} data-testid="s" />);
    const listbox = await open('s');
    expect(getComputedStyle(listbox).maxHeight).not.toBe('');
    expect(getComputedStyle(listbox).maxHeight).not.toBe('none');
    expect(getComputedStyle(listbox).maxHeight).not.toContain('vh');
  });

  it('says the host sentence when nothing matches', async () => {
    render(
      <Select
        options={STAFF}
        label="Pessoa"
        value=""
        onChange={vi.fn()}
        noOptionsText="Ninguém com esse nome"
        data-testid="s"
      />,
    );
    await typeInto('s', 'zzz');
    expect(await screen.findByText('Ninguém com esse nome')).toBeInTheDocument();
  });

  it('lets `searchable` override the count either way', async () => {
    const { unmount } = render(
      <Select options={few(3)} searchable label="A" value="" onChange={vi.fn()} data-testid="a" />,
    );
    await ready('a');
    unmount();
    render(<Select options={few(9)} searchable={false} label="B" value="" onChange={vi.fn()} data-testid="b" />);
    expect(searchInput(screen.getByTestId('b'))).toBeNull();
  });

  it('keeps the menu for `multiple`, which a search box cannot hold', () => {
    render(<Select options={few(9)} multiple label="C" value={[]} onChange={vi.fn()} data-testid="c" />);
    expect(searchInput(screen.getByTestId('c'))).toBeNull();
  });

  it('sizes a field that does not fill its row to its longest option, and keeps sx and className', async () => {
    render(
      <Select
        options={STAFF}
        fullWidth={false}
        sx={{ marginTop: 3 }}
        className="agenda"
        label="Dia"
        value="ana"
        onChange={vi.fn()}
        data-testid="s"
      />,
    );
    await ready('s');
    const root = screen.getByTestId('s');
    // "Gustavo Rezende" is 15 characters: MUI's input alone is `width: 0`.
    expect(root.style.minWidth).toBe('calc(15ch + 4.5rem)');
    expect(root).toHaveClass('agenda');
  });

  it('keeps what is typed when the parent re-renders with a fresh options array', async () => {
    const fresh = () => structuredClone(STAFF);
    const { rerender } = render(
      <Select options={fresh()} label="Pessoa" value="ana" onChange={vi.fn()} data-testid="s" />,
    );
    await typeInto('s', 'Gus');
    rerender(<Select options={fresh()} label="Pessoa" value="ana" onChange={vi.fn()} data-testid="s" />);
    expect(searchInput(screen.getByTestId('s'))!.value).toBe('Gus');
  });

  it('keys options by value, so two people with one name do not collide', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const twins = [...STAFF, { value: 'ana-2', label: 'Ana Souza' }];
    render(<Select options={twins} label="Pessoa" value="" onChange={vi.fn()} data-testid="s" />);
    const listbox = await open('s');
    expect(within(listbox).getByTestId('s-option-ana-2')).toBeInTheDocument();
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key');
    errors.mockRestore();
  });

  it('works uncontrolled from defaultValue, and names its input for a native form', async () => {
    render(<Select options={STAFF} label="Pessoa" name="person" defaultValue="ana" data-testid="s" />);
    const input = await ready('s');
    expect(input.value).toBe('Ana Souza');
    expect(input.name).toBe('person');
    const listbox = await open('s');
    fireEvent.click(within(listbox).getByTestId('s-option-diego'));
    expect(searchInput(screen.getByTestId('s'))!.value).toBe('Diego Lima');
  });

  it('marks a disabled field aria-disabled, as the menu did', async () => {
    render(<Select options={STAFF} disabled label="Pessoa" value="" onChange={vi.fn()} data-testid="s" />);
    await ready('s');
    expect(screen.getByTestId('s-select')).toHaveAttribute('aria-disabled', 'true');
  });
});
