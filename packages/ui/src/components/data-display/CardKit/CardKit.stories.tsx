import DeleteIcon from '@mui/icons-material/DeleteOutline';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState, type JSX } from 'react';

import { Button } from '../../form/Button';
import { BaseCard } from '../DataViews';
import { exportRows, type ExportColumn } from '../../../utils';

import { CardActionsProvider, useCardActions } from './card-actions-context';
import { CardKebab } from './CardKebab';
import { BodyHeading, DetailColumns, Fact, Ledger, TagList } from './list-card-parts';
import { rowActionsToMenuItems } from './row-actions-to-menu';
import { useRemoveConfirm } from './use-remove-confirm';
import { useRowConfirm } from './use-row-confirm';

/**
 * The card kit, end to end.
 *
 * Every piece a consumer would otherwise re-invent per entity has a story here,
 * including the two hooks — a hook with no story is a hook nobody can look at,
 * and both of these exist precisely to make a DESTRUCTIVE flow behave the same
 * way everywhere.
 *
 * The copy in these stories is pt-BR because that is what the first adopter
 * ships; none of it is a default in the components themselves, which is the
 * whole point. Every sentence below is passed in.
 */
const meta: Meta = {
  title: 'Cards/CardKit',
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The furniture an admin list’s cards and row menus sit in: the shared kebab, the ambient tenant/refresh/error context, the expanded-body parts, and the two confirm-before-writing hooks. `BaseCard` stays the envelope; nothing here knows a domain.',
      },
    },
  },
};

export default meta;
type Story = StoryObj;

/** One row, of the shape an admin list actually carries. */
interface DemoRow extends Record<string, unknown> {
  id: string;
  name: string;
  active: boolean;
}

const ROW: DemoRow = { id: 'd-1', name: 'Combo pipoca', active: true };

export const Kebab: Story = {
  name: 'CardKebab',
  parameters: {
    docs: {
      description: {
        story:
          '`menuLabel` is required and has no default: it is the trigger’s accessible name, announced verbatim by a screen reader, so it is the consumer’s word.',
      },
    },
  },
  render: () => (
    <CardKebab
      menuLabel="Ações"
      dataTestId="story-kebab"
      items={[
        { id: 'edit', label: 'Editar', onClick: () => {} },
        { id: 'duplicate', label: 'Duplicar', onClick: () => {} },
        { id: 'delete', label: 'Excluir', color: 'danger', onClick: () => {} },
      ]}
    />
  ),
};

export const KebabFromRowActions: Story = {
  name: 'CardKebab · from RowAction[]',
  parameters: {
    docs: {
      description: {
        story:
          'One declaration drives both surfaces. The grid’s multi-select menu and this kebab read the SAME `RowAction[]`, so a “Duplicar” cannot appear in one and not the other. `isVisible` is applied per row — the inactive-only action is absent here.',
      },
    },
  },
  render: () => (
    <CardKebab
      menuLabel="Ações"
      items={rowActionsToMenuItems<DemoRow>(
        [
          { id: 'edit', label: 'Editar', onSelect: () => {} },
          {
            id: 'activate',
            label: 'Ativar',
            isVisible: (row) => !row.active,
            onSelect: () => {},
          },
          { id: 'delete', label: 'Excluir', color: 'danger', onSelect: () => {} },
        ],
        ROW,
      )}
    />
  ),
};

export const ExpandedBody: Story = {
  name: 'List-card body parts',
  parameters: {
    docs: {
      description: {
        story:
          'The four shapes an expanded `BaseListCard` body repeats. Figures arrive pre-formatted — a layout that formatted money would be picking a locale for the consumer.',
      },
    },
  },
  render: () => (
    <BaseCard>
      <Box sx={{ p: 2 }}>
        <DetailColumns
          left={
            <>
              <BodyHeading>Detalhes</BodyHeading>
              <Fact label="Tipo" value="Preço de combo" />
              <Fact label="Abrangência" value="Combo" />
              <Fact label="Vigência" value="01/08/2026 – 31/08/2026" />
              <Box sx={{ mt: 2 }}>
                <BodyHeading>Produtos</BodyHeading>
                <TagList items={['pipoca-g', 'refri-lata']} empty="Nenhum produto" />
              </Box>
              <Box sx={{ mt: 2 }}>
                <BodyHeading>Categorias</BodyHeading>
                <TagList items={[]} empty="Nenhuma categoria" />
              </Box>
            </>
          }
          right={
            <>
              <BodyHeading>Valores</BodyHeading>
              <Ledger
                lines={[
                  { label: 'Itens do combo', value: 'R$ 30,00' },
                  { label: 'Desconto', value: '− R$ 5,00', tone: 'info' },
                ]}
                total={{ label: 'Cliente paga', value: 'R$ 25,00' }}
              />
            </>
          }
        />
      </Box>
    </BaseCard>
  ),
};

/** A menu that owns its own delete popup, as a real kind menu does. */
function DemoMenu({ fails }: { fails: boolean }): JSX.Element {
  const { tenantSlug } = useCardActions();
  const remove = useRemoveConfirm({
    write: async () =>
      fails ? { ok: false, error: 'Este desconto está em uso em um pedido aberto.' } : { ok: true },
    title: 'Excluir o desconto?',
    entityName: ROW.name,
    description: 'Ele sai da lista, e os pedidos que já o usaram mantêm o valor aplicado.',
    confirmText: 'Excluir',
    fallbackError: 'Não foi possível excluir o desconto.',
    dataTestId: 'story-remove-confirm',
  });

  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Box sx={{ fontSize: 13, color: 'text.secondary' }}>loja: {tenantSlug}</Box>
      <CardKebab
        menuLabel="Ações"
        items={[{ id: 'delete', label: 'Excluir', color: 'danger', onClick: remove.request }]}
      />
      {remove.dialog}
    </Stack>
  );
}

export const RemoveFromAMenu: Story = {
  name: 'useRemoveConfirm · the write succeeds',
  parameters: {
    docs: {
      description: {
        story:
          'The write leaves ONLY on confirm. The hook reads the tenant, the refresh and the error channel from `CardActionsProvider`, so a self-contained menu needs no prop drilling through the grid.',
      },
    },
  },
  render: () => (
    <CardActionsProvider
      tenantSlug="minha-loja"
      onRefresh={() => {}}
      errorTitle="Não foi possível concluir a ação"
    >
      <DemoMenu fails={false} />
    </CardActionsProvider>
  ),
};

export const RemoveRefused: Story = {
  name: 'useRemoveConfirm · the server refuses',
  parameters: {
    docs: {
      description: {
        story:
          'A refusal is surfaced TWICE and the popup stays open. Inside the dialog, where the operator is still deciding; and in the provider’s shared snackbar behind it, which is what remains once they dismiss. A popup that closed over a delete that never happened is the failure this shape exists to prevent.',
      },
    },
  },
  render: () => (
    <CardActionsProvider
      tenantSlug="minha-loja"
      onRefresh={() => {}}
      errorTitle="Não foi possível concluir a ação"
    >
      <DemoMenu fails />
    </CardActionsProvider>
  ),
};

/** A grid-shaped selection, driven by `useRowConfirm`. */
function DemoSelection(): JSX.Element {
  const [removed, setRemoved] = useState<string[]>([]);
  const confirm = useRowConfirm<DemoRow>({
    write: async (rows) => setRemoved(rows.map((row) => row.name)),
    describe: (rows) =>
      rows.length === 1
        ? {
            title: 'Excluir o desconto?',
            entityName: rows[0]?.name,
            description: 'Ele sai da lista imediatamente.',
            confirmText: 'Excluir',
          }
        : {
            title: `Excluir ${rows.length} descontos?`,
            description: 'Todos saem da lista imediatamente.',
            confirmText: 'Excluir',
          },
    dataTestId: 'story-row-confirm',
  });

  return (
    <Stack spacing={2} alignItems="flex-start">
      <Stack direction="row" spacing={1}>
        <Button
          variant="outline"
          onClick={() => confirm.request([ROW])}
          dataTestId="confirm-one"
        >
          Excluir 1 selecionado
        </Button>
        <Button
          variant="outline"
          onClick={() => confirm.request([ROW, { ...ROW, id: 'd-2', name: 'Leve 3 pague 2' }])}
          dataTestId="confirm-many"
        >
          Excluir 2 selecionados
        </Button>
        <Button variant="text" onClick={() => confirm.request([])} dataTestId="confirm-none">
          Excluir 0 selecionados
        </Button>
      </Stack>
      <Box sx={{ fontSize: 13, color: 'text.secondary' }}>
        removidos: {removed.length === 0 ? '—' : removed.join(', ')}
      </Box>
      {confirm.dialog}
    </Stack>
  );
}

export const ConfirmASelection: Story = {
  name: 'useRowConfirm · one row and many',
  parameters: {
    docs: {
      description: {
        story:
          'The same guard covers the per-row kebab and the multi-select menu, because they run the same handler — so the popup is described from the SELECTION, not from a row. An empty selection opens nothing: a popup about nothing, confirmed, writes nothing.',
      },
    },
  },
  render: () => <DemoSelection />,
};

const EXPORT_COLUMNS: ExportColumn<DemoRow>[] = [
  { header: 'Nome', value: (row) => row.name },
  { header: 'Ativo', value: (row) => (row.active ? 'sim' : 'não') },
];

export const ExportRows: Story = {
  name: 'exportRows',
  parameters: {
    docs: {
      description: {
        story:
          'The producing half of the grid’s Export control. Dependency-free: “Excel” is CSV, which Excel opens natively. A cell containing a comma is quoted — without that, one name shifts every column after it and the file reads as corrupt rather than as a bug.',
      },
    },
  },
  render: () => (
    <Stack direction="row" spacing={1}>
      <Button
        variant="outline"
        onClick={() =>
          exportRows('csv', [ROW, { ...ROW, id: 'd-2', name: 'Leve 3, pague 2' }], EXPORT_COLUMNS, 'descontos')
        }
      >
        Baixar CSV
      </Button>
      <Button
        variant="outline"
        onClick={() => exportRows('json', [ROW], EXPORT_COLUMNS, 'descontos')}
      >
        Baixar JSON
      </Button>
      <Box sx={{ display: 'flex', alignItems: 'center', color: 'text.secondary' }}>
        <DeleteIcon fontSize="small" sx={{ opacity: 0 }} />
      </Box>
    </Stack>
  ),
};
