import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import UploadIcon from '@mui/icons-material/UploadFileOutlined';
import Box from '@mui/material/Box/index.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps, JSX } from 'react';
import { fn } from 'storybook/test';

import { HeaderActions } from './HeaderActions';

const meta: Meta<typeof HeaderActions> = {
  title: 'Form/HeaderActions',
  component: HeaderActions,
  parameters: {
    layout: 'padded',
    docs: {
      description: {
        component:
          'The page header actions, sized to how many there are: none renders nothing, one renders a button, and n renders the first as a button with the other n−1 folded into a dropdown. Pass the actions in priority order — index 0 is the one that keeps its button.',
      },
    },
  },
  args: { moreLabel: 'More actions', collapseBelow: 'md' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

const CREATE = { id: 'create', text: 'New product', icon: <AddIcon fontSize="small" />, onClick: fn() };
const EXPORT = { id: 'export', text: 'Export sheet', icon: <DownloadIcon fontSize="small" />, onClick: fn() };
const IMPORT = { id: 'import', text: 'Import sheet', icon: <UploadIcon fontSize="small" />, onClick: fn() };
const ORDER = { id: 'order', text: 'Order highlights', icon: <FormatListNumberedIcon fontSize="small" />, onClick: fn() };

const Row = (props: ComponentProps<typeof HeaderActions>): JSX.Element => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
    <HeaderActions {...props} />
  </Box>
);

/** Nothing declared, nothing drawn — not an empty box, and not an empty menu. */
export const None: Story = { args: { actions: [] }, render: (args) => <Row {...args} /> };

/** One action needs no menu, so it does not get one. */
export const Single: Story = { args: { actions: [CREATE] }, render: (args) => <Row {...args} /> };

/** Two: the primary keeps its button, the second is already behind the trigger. */
export const Two: Story = { args: { actions: [CREATE, ORDER] }, render: (args) => <Row {...args} /> };

/** The catalog header that motivated this — four buttons became one plus a menu. */
export const Many: Story = {
  args: { actions: [CREATE, ORDER, EXPORT, IMPORT] },
  render: (args) => <Row {...args} />,
};

/** A gated action is declared and dropped, so the array still reads as the page's full intent. */
export const WithGatedAction: Story = {
  args: { actions: [CREATE, { ...ORDER, visible: false }, EXPORT] },
  render: (args) => <Row {...args} />,
};
