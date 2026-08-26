import type { Meta, StoryObj } from '@storybook/react-vite';
import Stack from '@mui/material/Stack';

import { Button } from '../../form/Button';

import { ConfirmAction } from './ConfirmAction';
import { ConfirmButton } from './ConfirmButton';
import { withConfirmation } from './with-confirmation';

const meta: Meta<typeof ConfirmAction> = {
  title: 'Overlays/ConfirmAction',
  component: ConfirmAction,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Wraps a destructive action in a confirmation popup. The guarded handler runs only after the operator confirms; cancelling sends nothing, an in-flight write cannot be fired twice, and a failure keeps the popup open carrying the error.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    tone: { control: 'inline-radio', options: ['destructive', 'default'] },
    initialFocus: { control: 'inline-radio', options: ['confirm', 'cancel'] },
    typeToConfirm: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** Resolves after a beat, so the popup's pending state is visible in the story. */
const slowWrite = () => new Promise<void>((resolve) => setTimeout(resolve, 1200));

export const Default: Story = {
  args: {
    title: 'Excluir a categoria?',
    entityName: 'Bebidas',
    description: 'Ela vai para a lixeira e pode ser restaurada de lá.',
    confirmText: 'Excluir',
    onConfirm: slowWrite,
    children: (request) => (
      <Button color="danger" onClick={request}>
        Excluir
      </Button>
    ),
  },
};

/** No body of its own: the popup falls back to naming the row it affects. */
export const DescriptionFromEntityName: Story = {
  args: {
    ...Default.args,
    description: undefined,
  },
};

/** The non-destructive tone — same machinery, and focus opens on the confirm. */
export const NeutralTone: Story = {
  args: {
    ...Default.args,
    title: 'Publicar o cardápio?',
    description: 'As alterações ficam visíveis na vitrine imediatamente.',
    confirmText: 'Publicar',
    tone: 'default',
  },
};

/** For actions with no recovery path: the confirm stays dead until the name is typed. */
export const TypeToConfirm: Story = {
  args: {
    ...Default.args,
    title: 'Excluir definitivamente',
    description: 'Este item e tudo o que depende dele somem para sempre.',
    confirmText: 'Excluir definitivamente',
    typeToConfirm: 'Bebidas',
  },
};

/** The write rejects: the popup stays open and says so, instead of closing silently. */
export const FailedWrite: Story = {
  args: {
    ...Default.args,
    onConfirm: () => Promise.reject(new Error('409')),
    errorText: 'Esta categoria ainda tem produtos vinculados.',
  },
};

/** The long label case — a title and body that wrap. */
export const LongContent: Story = {
  args: {
    ...Default.args,
    title: 'Remover este integrante da equipe e revogar todos os seus acessos?',
    entityName: 'maria.fernanda.dossantos@exemplo.com.br',
    description:
      'A pessoa perde o acesso ao painel imediatamente e precisa de um novo convite para voltar. Os pedidos que ela registrou continuam no histórico da loja, atribuídos ao nome dela.',
  },
};

/** The HOC path: an ordinary button, guarded by adding one prop. */
export const WithConfirmationHoc: StoryObj = {
  render: () => (
    <Stack direction="row" spacing={2}>
      <ConfirmButton
        color="danger"
        onClick={slowWrite}
        confirm={{
          title: 'Excluir o desconto?',
          entityName: 'Combo almoço',
          description: 'O cupom para de valer na vitrine assim que for excluído.',
          confirmText: 'Excluir',
        }}
      >
        Excluir
      </ConfirmButton>
      <ConfirmButton color="neutral" onClick={slowWrite} confirm={false}>
        Sem confirmação
      </ConfirmButton>
    </Stack>
  ),
};

/** Wording baked into the wrapper once; each instance only says what differs. */
const DeleteButton = withConfirmation(Button, {
  title: 'Excluir o item?',
  confirmText: 'Excluir',
  description: 'Ele vai para a lixeira e pode ser restaurado de lá.',
});

export const HocWithBakedInDefaults: StoryObj = {
  render: () => (
    <Stack direction="row" spacing={2}>
      <DeleteButton color="danger" onClick={slowWrite} confirm={{ entityName: 'Bebidas' }}>
        Excluir categoria
      </DeleteButton>
      <DeleteButton
        color="danger"
        onClick={slowWrite}
        confirm={{ entityName: 'Mesa 12', title: 'Excluir a mesa?' }}
      >
        Excluir mesa
      </DeleteButton>
    </Stack>
  ),
};
