/** The draft banner a host mounts at the top of its own editor. */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { DRAFT, surface } from './__stories__/fixtures';

const meta: Meta = { title: 'Draft banner' };
export default meta;

/**
 * An item with unpublished edits kept next to the live record.
 *
 * `title` exists because the generic copy is wrong for a collection with its
 * own noun — a product editor says "Este produto tem…", and a package that
 * guessed the noun would be guessing in Portuguese on the host's behalf.
 */
export const OnALiveItem: StoryObj = {
  name: 'Unpublished edits on a live item',
  render: () => {
    const { DraftBanner } = surface();
    return (
      <DraftBanner
        slug="products"
        draft={DRAFT}
        onLoad={() => undefined}
        onPublished={() => undefined}
        onDiscarded={() => undefined}
        testIdPrefix="product-draft"
        title="Este produto tem alterações não publicadas."
      />
    );
  },
};

/** `entityId: null` — there is no live record yet, so publishing CREATES it. */
export const ForANewItem: StoryObj = {
  name: 'A new item that was never published',
  render: () => {
    const { DraftBanner } = surface();
    return (
      <DraftBanner
        slug="products"
        draft={{ ...DRAFT, id: 'd2', entityId: null }}
        onLoad={() => undefined}
        onPublished={() => undefined}
        onDiscarded={() => undefined}
        testIdPrefix="product-draft"
      />
    );
  },
};
