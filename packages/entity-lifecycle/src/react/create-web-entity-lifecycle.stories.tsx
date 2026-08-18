/** The whole web surface: what a host gets from mounting ONE component. */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { binEntry, changeRequest, API_BASE, surface } from './__stories__/fixtures';

const meta: Meta = { title: 'Whole surface' };
export default meta;

/**
 * Lixeira and Aprovações behind the package's own tabs — the zero-routing
 * option, for a host that would rather mount one page than wire two screens
 * into its own navigation.
 */
export const TabbedPage: StoryObj = {
  name: 'Lixeira + Aprovações behind tabs',
  render: () => {
    const { page: Page } = surface({
      [`${API_BASE}/recycle-bin`]: { entries: [binEntry()] },
      [`${API_BASE}/approvals`]: { requests: [changeRequest()] },
    });
    return <Page />;
  },
};
