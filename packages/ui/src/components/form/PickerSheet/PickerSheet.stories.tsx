import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../Button';
import { PickerSheet } from './PickerSheet';
import type { PickerSheetItem } from './PickerSheet.types';

const meta: Meta<typeof PickerSheet> = {
  title: 'Form/PickerSheet',
  component: PickerSheet,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A searchable pick-or-create sheet: a centred dialog on a pointer, a bottom sheet on a phone. All copy comes from the caller.',
      },
    },
  },
  tags: ['autodocs', 'component:PickerSheet'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const CATEGORIES: { id: string; label: string; parent?: string }[] = [
  { id: 'drinks', label: 'Bebidas' },
  { id: 'juices', label: 'Sucos', parent: 'drinks' },
  { id: 'sodas', label: 'Refrigerantes', parent: 'drinks' },
  { id: 'food', label: 'Comidas' },
  { id: 'burgers', label: 'Hambúrgueres', parent: 'food' },
  { id: 'desserts', label: 'Sobremesas' },
];

function toItems(rows: typeof CATEGORIES, selectedId: string | null): PickerSheetItem[] {
  const labelOf = (id: string): string => rows.find((row) => row.id === id)?.label ?? id;
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    meta: row.parent ? `${labelOf(row.parent)} › ${row.label}` : undefined,
    indent: row.parent ? 1 : 0,
    selected: row.id === selectedId,
  }));
}

/** A category field's picker: tree when idle, flat with the path while searching, create when nothing matches. */
export const CategoryPicker: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const [rows, setRows] = useState(CATEGORIES);
    const [value, setValue] = useState<string | null>('juices');
    return (
      <Box>
        <Button onClick={() => setOpen(true)}>{rows.find((row) => row.id === value)?.label ?? 'Escolher'}</Button>
        <PickerSheet
          open={open}
          onClose={() => setOpen(false)}
          kicker="Produto"
          title="Categoria"
          searchPlaceholder="Buscar categoria"
          searchLabel="Buscar categoria"
          closeLabel="Fechar"
          items={toItems(rows, value)}
          onPick={(id) => {
            setValue(id);
            setOpen(false);
          }}
          createLabel={(query) => `Criar categoria "${query}"`}
          onCreate={(query) => {
            const id = query.toLowerCase();
            setRows((prev) => [...prev, { id, label: query }]);
            setValue(id);
            setOpen(false);
          }}
          foot="Subcategorias aparecem recuadas sob a categoria pai."
          dataTestId="category-picker"
        />
      </Box>
    );
  },
};

/** No `onCreate`: a query that matches nothing shows the caller's empty text. */
export const PickOnly: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    const [value, setValue] = useState<string | null>(null);
    return (
      <Box>
        <Button onClick={() => setOpen(true)}>Escolher praça</Button>
        <PickerSheet
          open={open}
          onClose={() => setOpen(false)}
          title="Praça de preparo"
          searchPlaceholder="Buscar praça"
          searchLabel="Buscar praça"
          closeLabel="Fechar"
          items={[
            { id: 'grill', label: 'Chapa', selected: value === 'grill' },
            { id: 'fryer', label: 'Fritadeira', selected: value === 'fryer' },
            { id: 'bar', label: 'Bar', selected: value === 'bar' },
          ]}
          onPick={(id) => {
            setValue(id);
            setOpen(false);
          }}
          emptyText={(query) => `Nenhuma praça para "${query}"`}
        />
      </Box>
    );
  },
};
