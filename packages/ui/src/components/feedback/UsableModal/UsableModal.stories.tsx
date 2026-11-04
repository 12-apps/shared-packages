import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../../form/Button';
import { UsableModal } from './UsableModal';
import type { UsableModalLayout } from './UsableModal.types';

const meta: Meta<typeof UsableModal> = {
  title: 'Feedback/UsableModal',
  component: UsableModal,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'A StackedModal on a computer and a bottom Sheet on a phone, behind one API. Each surface is loaded on demand.',
      },
    },
  },
  tags: ['autodocs', 'component:UsableModal'],
};

export default meta;
type Story = StoryObj<typeof meta>;

function Demo({ layout }: { layout: UsableModalLayout }): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Abrir</Button>
      <UsableModal
        open={open}
        onClose={() => setOpen(false)}
        title="Novo pedido"
        closeLabel="Fechar"
        backLabel="Voltar"
        layout={layout}
        dataTestId="usable-modal"
        footer={
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button variant="outlined" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button>Escolher itens</Button>
          </Box>
        }
      >
        <Box sx={{ display: 'grid', gap: 2 }}>
          {Array.from({ length: 12 }, (_, index) => (
            <Box key={index} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
              Campo {index + 1}
            </Box>
          ))}
        </Box>
      </UsableModal>
    </>
  );
}

/** Follows the viewport: resize the canvas below 600px to see the sheet. */
export const Auto: Story = { render: () => <Demo layout="auto" /> };

/** The computer's surface, whatever the canvas width. */
export const StackedOnComputer: Story = { render: () => <Demo layout="modal" /> };

/** The phone's surface, whatever the canvas width. */
export const SheetOnPhone: Story = { render: () => <Demo layout="sheet" /> };
