import Box from '@mui/material/Box/index.js';
import { useState } from 'react';

import { CategorySelect } from './CategorySelect';
import type { CategorySelectOption } from './CategorySelect.types';
import type { Meta, StoryObj } from '@storybook/react-vite';

/** The mercadinho catalogue from the prototype: 10 categories, 44 subcategories. */
const MERCADO: CategorySelectOption[] = [
  { id: 'beb', name: 'Bebidas', count: 214 },
  { id: 'beb.agua', name: 'Águas', parentId: 'beb', count: 38 },
  { id: 'beb.refri', name: 'Refrigerantes', parentId: 'beb', count: 52 },
  { id: 'beb.suco', name: 'Sucos', parentId: 'beb', count: 41 },
  { id: 'beb.energ', name: 'Energéticos', parentId: 'beb', count: 26 },
  { id: 'beb.iso', name: 'Isotônicos', parentId: 'beb', count: 19 },
  { id: 'beb.cha', name: 'Chás gelados', parentId: 'beb', count: 38 },
  { id: 'alc', name: 'Bebidas alcoólicas', count: 176 },
  { id: 'alc.cerv', name: 'Cervejas', parentId: 'alc', count: 74 },
  { id: 'alc.vinho', name: 'Vinhos', parentId: 'alc', count: 48 },
  { id: 'alc.dest', name: 'Destilados', parentId: 'alc', count: 33 },
  { id: 'alc.drink', name: 'Drinks prontos', parentId: 'alc', count: 21 },
  { id: 'cafe', name: 'Cafés e cápsulas', count: 63 },
  { id: 'cafe.graos', name: 'Café em grãos', parentId: 'cafe', count: 14 },
  { id: 'cafe.moido', name: 'Café moído', parentId: 'cafe', count: 22 },
  { id: 'cafe.caps', name: 'Cápsulas', parentId: 'cafe', count: 19 },
  { id: 'cafe.sol', name: 'Solúvel', parentId: 'cafe', count: 8 },
  { id: 'snack', name: 'Snacks salgados', count: 128 },
  { id: 'snack.amen', name: 'Amendoins', parentId: 'snack', count: 24 },
  { id: 'snack.batata', name: 'Batata frita', parentId: 'snack', count: 31 },
  { id: 'snack.salg', name: 'Salgadinhos', parentId: 'snack', count: 42 },
  { id: 'snack.cast', name: 'Castanhas', parentId: 'snack', count: 18 },
  { id: 'snack.pipoca', name: 'Pipoca', parentId: 'snack', count: 13 },
  { id: 'doce', name: 'Doces e sobremesas', count: 157 },
  { id: 'doce.choc', name: 'Chocolates', parentId: 'doce', count: 58 },
  { id: 'doce.bala', name: 'Balas', parentId: 'doce', count: 29 },
  { id: 'doce.chic', name: 'Chicletes', parentId: 'doce', count: 17 },
  { id: 'doce.biscd', name: 'Biscoito doce', parentId: 'doce', count: 33 },
  { id: 'doce.sorv', name: 'Sorvetes', parentId: 'doce', count: 20 },
  { id: 'merc', name: 'Mercearia', count: 203 },
  { id: 'merc.biscs', name: 'Biscoito salgado', parentId: 'merc', count: 26 },
  { id: 'merc.massa', name: 'Massas', parentId: 'merc', count: 44 },
  { id: 'merc.molho', name: 'Molhos', parentId: 'merc', count: 37 },
  { id: 'merc.cons', name: 'Conservas', parentId: 'merc', count: 31 },
  { id: 'merc.graos2', name: 'Grãos e farináceos', parentId: 'merc', count: 65 },
  { id: 'saud', name: 'Saudáveis', count: 88 },
  { id: 'saud.barra', name: 'Barras de proteína', parentId: 'saud', count: 27 },
  { id: 'saud.sup', name: 'Suplementos', parentId: 'saud', count: 21 },
  { id: 'saud.integ', name: 'Integrais', parentId: 'saud', count: 24 },
  { id: 'saud.zero', name: 'Zero açúcar', parentId: 'saud', count: 16 },
  { id: 'frios', name: 'Frios e laticínios', count: 142 },
  { id: 'frios.queijo', name: 'Queijos', parentId: 'frios', count: 39 },
  { id: 'frios.iog', name: 'Iogurtes', parentId: 'frios', count: 45 },
  { id: 'frios.leite', name: 'Leites', parentId: 'frios', count: 28 },
  { id: 'frios.emb', name: 'Embutidos', parentId: 'frios', count: 30 },
  { id: 'pad', name: 'Padaria', count: 76 },
  { id: 'pad.pao', name: 'Pães', parentId: 'pad', count: 34 },
  { id: 'pad.bolo', name: 'Bolos', parentId: 'pad', count: 19 },
  { id: 'pad.assado', name: 'Salgados assados', parentId: 'pad', count: 23 },
  { id: 'limp', name: 'Higiene e limpeza', count: 164 },
  { id: 'limp.papel', name: 'Papel', parentId: 'limp', count: 22 },
  { id: 'limp.sabao', name: 'Sabonetes e shampoos', parentId: 'limp', count: 48 },
  { id: 'limp.deterg', name: 'Detergentes', parentId: 'limp', count: 39 },
  { id: 'limp.limpg', name: 'Limpeza geral', parentId: 'limp', count: 55 },
  // No subcategories: this row IS the leaf, so it carries the checkbox and draws
  // no chevron. Real catalogues are full of these — a shop that never split
  // "Congelados" into anything.
  { id: 'cong', name: 'Congelados', count: 47 },
];

/** The cantina's shorter menu — useful for the single-select "move to" story. */
const CANTINA: CategorySelectOption[] = [
  { id: 'ent', name: 'Entradas', count: 24 },
  { id: 'ent.fria', name: 'Frias', parentId: 'ent', count: 8 },
  { id: 'ent.quente', name: 'Quentes', parentId: 'ent', count: 11 },
  { id: 'ent.salada', name: 'Saladas', parentId: 'ent', count: 5 },
  { id: 'prin', name: 'Pratos principais', count: 46 },
  { id: 'prin.carne', name: 'Carnes', parentId: 'prin', count: 15 },
  { id: 'prin.frango', name: 'Aves', parentId: 'prin', count: 10 },
  { id: 'prin.peixe', name: 'Peixes e frutos do mar', parentId: 'prin', count: 9 },
  { id: 'prin.massa2', name: 'Massas', parentId: 'prin', count: 12 },
  { id: 'sobr', name: 'Sobremesas', count: 15 },
  { id: 'sobr.gelada', name: 'Geladas', parentId: 'sobr', count: 7 },
  { id: 'sobr.sorv2', name: 'Sorvetes', parentId: 'sobr', count: 4 },
  // Childless, so the "move to…" picker offers it directly rather than drawing
  // a heading with nothing under it to choose.
  { id: 'bebida', name: 'Bebidas', count: 18 },
];

/**
 * The four cases the `allowParentSelection` matrix has to cover, in one list:
 * two parents WITH children (`beb`, `merc`) and two WITHOUT (`cong`, `pad`).
 */
const MATRIX: CategorySelectOption[] = [
  { id: 'beb', name: 'Bebidas', count: 97 },
  { id: 'beb.agua', name: 'Águas', parentId: 'beb', count: 38 },
  { id: 'beb.refri', name: 'Refrigerantes', parentId: 'beb', count: 52 },
  { id: 'beb.suco', name: 'Sucos', parentId: 'beb', count: 7 },
  { id: 'merc', name: 'Mercearia', count: 70 },
  { id: 'merc.massa', name: 'Massas', parentId: 'merc', count: 44 },
  { id: 'merc.molho', name: 'Molhos', parentId: 'merc', count: 26 },
  // No children — these are the rows that used to be inert.
  { id: 'cong', name: 'Congelados', count: 47 },
  { id: 'pad', name: 'Padaria', count: 31 },
];

const meta = {
  title: 'Form/CategorySelect',
  component: CategorySelect,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof CategorySelect>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The filter: multi-select with draft + Apply. */
export const MultiSelect: Story = {
  args: { options: MERCADO, value: [], onChange: () => {} },
  render: function Render(args) {
    const [value, setValue] = useState<string[]>([]);
    return (
      <Box sx={{ minHeight: 420 }}>
        <CategorySelect {...args} mode="multi" value={value} onChange={setValue} />
      </Box>
    );
  },
};

/** Opens with a partial selection, so the tri-state parent checkbox is visible. */
export const PartialSelection: Story = {
  args: { options: MERCADO, value: [], onChange: () => {} },
  render: function Render(args) {
    const [value, setValue] = useState<string[]>(['beb.agua', 'beb.suco', 'snack.batata']);
    return (
      <Box sx={{ minHeight: 420 }}>
        <CategorySelect
          {...args}
          mode="multi"
          value={value}
          onChange={setValue}
          allowParentSelection
          showCounts
        />
      </Box>
    );
  },
};

/** The "move product to…" picker: categories are headings, leaves are choices. */
export const SingleSelect: Story = {
  args: { options: CANTINA, value: [], onChange: () => {} },
  render: function Render(args) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <Box sx={{ minHeight: 420 }}>
        <CategorySelect
          {...args}
          mode="single"
          label="Categoria"
          value={value}
          onChange={setValue}
        />
      </Box>
    );
  },
};

/** Skeleton rows while the catalogue is still in flight. */
export const Loading: Story = {
  args: { options: [], value: [], onChange: () => {}, loading: true },
  render: function Render(args) {
    return (
      <Box sx={{ minHeight: 420 }}>
        <CategorySelect {...args} mode="multi" value={[]} onChange={() => {}} />
      </Box>
    );
  },
};

/** No categories exist yet — the onboarding call to action. */
export const EmptyCatalogue: Story = {
  args: { options: [], value: [], onChange: () => {} },
  render: function Render(args) {
    return (
      <Box sx={{ minHeight: 420 }}>
        <CategorySelect
          {...args}
          mode="multi"
          value={[]}
          onChange={() => {}}
          onCreateCategory={() => {}}
        />
      </Box>
    );
  },
};

/** Errored field, with the message under the trigger. */
export const WithError: Story = {
  args: { options: CANTINA, value: [], onChange: () => {} },
  render: function Render(args) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <Box sx={{ minHeight: 420 }}>
        <CategorySelect
          {...args}
          mode="single"
          label="Categoria"
          error="Escolha uma categoria para continuar"
          value={value}
          onChange={setValue}
        />
      </Box>
    );
  },
};

/**
 * **Flag ON, parent WITH children.** Ticking `Bebidas` selects every
 * subcategory under it; the tri-state box reads `partial` while only some are
 * picked, and the chip tray collapses a complete category back to ONE chip
 * bearing its name rather than one chip per child.
 */
export const ParentSelection: Story = {
  args: { options: MATRIX, value: [], onChange: () => {} },
  render: function Render(args) {
    const [value, setValue] = useState<string[]>([]);
    return (
      <Box sx={{ minHeight: 460 }}>
        <CategorySelect
          {...args}
          mode="multi"
          value={value}
          onChange={setValue}
          allowParentSelection
          showCounts
        />
      </Box>
    );
  },
};

/**
 * **Flag OFF, parent WITH children.** The leaf-only default: `Bebidas` and
 * `Mercearia` are headings with no box, and the subcategories are what you
 * tick — which is what keeps "did I pick the parent or the group?" from being
 * a question at all.
 *
 * `Congelados` and `Padaria` still tick, because a childless category IS the
 * leaf; the flag has nothing to gate there.
 */
export const LeafOnlyWithChildlessRows: Story = {
  args: { options: MATRIX, value: [], onChange: () => {} },
  render: function Render(args) {
    const [value, setValue] = useState<string[]>([]);
    return (
      <Box sx={{ minHeight: 460 }}>
        <CategorySelect {...args} mode="multi" value={value} onChange={setValue} showCounts />
      </Box>
    );
  },
};

/**
 * **A catalogue that never nested.** Plenty of shops file everything at one
 * level, so every row here is childless — and every row is selectable, with no
 * disclosure chevron on any of them, because there is nothing to disclose.
 *
 * This is the shape that made the bug visible on Estoque: a whole filter of
 * rows that drew a chevron, opened onto nothing, and could not be picked.
 */
export const FlatCatalogue: Story = {
  args: { options: [], value: [], onChange: () => {} },
  render: function Render(args) {
    const [value, setValue] = useState<string[]>([]);
    return (
      <Box sx={{ minHeight: 460 }}>
        <CategorySelect
          {...args}
          mode="multi"
          options={MATRIX.filter((option) => !option.parentId)}
          value={value}
          onChange={setValue}
          showCounts
        />
      </Box>
    );
  },
};

/**
 * **Single-select, flag ON.** The "move to…" picker where a parent is a legal
 * destination. The head row draws a RADIO rather than a checkbox: choosing
 * commits immediately, so there is no accumulation for a checkbox to promise.
 */
export const SingleSelectParentAllowed: Story = {
  args: { options: MATRIX, value: [], onChange: () => {} },
  render: function Render(args) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <Box sx={{ minHeight: 460 }}>
        <CategorySelect
          {...args}
          mode="single"
          label="Mover para…"
          value={value}
          onChange={setValue}
          allowParentSelection
        />
      </Box>
    );
  },
};
