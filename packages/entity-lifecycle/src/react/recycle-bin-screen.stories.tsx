/** Lixeira — the soft-delete bin, explorable with no host. */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { binEntry, API_BASE, surface } from './__stories__/fixtures';

const meta: Meta = { title: 'Recycle bin' };
export default meta;

/**
 * Deleting an aggregate records a TREE, and the card says what came with it —
 * "Inclui: …" is how an admin knows what a Restaurar will bring back.
 *
 * The third entry is an `ingredient`, a type the host supplied NO label for.
 * It renders its RAW KEY, which is the labels contract working: this package
 * ships no catalog of another host's nouns, so an unlisted type is shown
 * honestly rather than under a word somebody else chose.
 */
export const WithDeletedItems: StoryObj = {
  name: 'Deleted items, and what they take with them',
  render: () => {
    const { RecycleBinScreen } = surface({
      [`${API_BASE}/recycle-bin`]: {
        entries: [
          binEntry({
            children: [
              { id: 'bin-1a', entityType: 'product', label: 'Variação 350ml' },
              { id: 'bin-1b', entityType: 'product', label: 'Variação 600ml' },
            ],
          }),
          binEntry({
            id: 'bin-2',
            entityType: 'category',
            entityId: 'c9',
            label: 'Bebidas geladas',
            deletedByName: 'Bruno Lima',
          }),
          binEntry({
            id: 'bin-3',
            entityType: 'ingredient',
            entityId: 'i4',
            label: 'Xarope de guaraná',
            deletedBy: null,
            deletedByName: null,
          }),
        ],
      },
    });
    return <RecycleBinScreen />;
  },
};

export const Empty: StoryObj = {
  name: 'Nothing deleted',
  render: () => {
    const { RecycleBinScreen } = surface({ [`${API_BASE}/recycle-bin`]: { entries: [] } });
    return <RecycleBinScreen />;
  },
};
