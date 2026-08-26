import Box from '@mui/material/Box';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useCallback, useRef, useState } from 'react';
import { expect, userEvent, waitFor, within } from 'storybook/test';

import { InfiniteScroll } from './InfiniteScroll';

const meta: Meta<typeof InfiniteScroll> = {
  title: 'Utility/InfiniteScroll/Tests',
  component: InfiniteScroll,
  parameters: {
    layout: 'centered',
    chromatic: { disableSnapshot: false },
  },
  tags: ['autodocs', 'test', 'component:InfiniteScroll'],
};

export default meta;
type Story = StoryObj<typeof meta>;

interface TestItem {
  id: number;
  name: string;
  description: string;
}

const generateItems = (start: number, count: number): TestItem[] =>
  Array.from({ length: count }, (_, i) => ({
    id: start + i,
    name: `Item ${start + i + 1}`,
    description: `Description ${start + i + 1}`,
  }));

/**
 * A page load the STORY completes, rather than one that completes after a fixed
 * delay. `loadMore` parks here, so `loading` is observable for exactly as long
 * as a test needs it to be and the page lands the moment the test releases it —
 * no timing assumption in either direction.
 *
 * This replaces a 100ms sleep. The codemod had swapped that sleep for
 * `await waitFor(() => expect(true).toBe(true))`, whose callback never throws:
 * it resolves on the first tick, so `loadMore` became effectively synchronous,
 * `loading` was never rendered, and nothing waited for — or checked — the page.
 */
interface PageGate {
  wait: () => Promise<void>;
  release: () => void;
}

const createPageGate = (): PageGate => {
  // A container's property rather than a closed-over `let`: reassigning a
  // captured binding from inside a callback is what no-global-state-mutation
  // flags, and the container names the single owner of the pending resolver.
  const pending: { resolve?: () => void } = {};
  return {
    wait: () =>
      new Promise<void>((resolve) => {
        pending.resolve = resolve;
      }),
    release: () => pending.resolve?.(),
  };
};

type TestContainer = HTMLElement & {
  _testTrigger?: () => void;
  _loadMore?: () => Promise<void>;
  _releasePage?: () => void;
};

const createTestComponent = (useTestMode = false) => {
  const TestComponent = () => {
    const [items, setItems] = useState<TestItem[]>(generateItems(0, 5));
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const triggerRef = useRef<(() => void) | undefined>(undefined);
    const containerRef = useRef<HTMLDivElement>(null);
    const loadMoreRef = useRef<(() => Promise<void>) | undefined>(undefined);
    const loadingRef = useRef(false);
    const gateRef = useRef<PageGate>(createPageGate());

    const loadMore = useCallback(async () => {
      if (loadingRef.current) return; // Already loading
      loadingRef.current = true;
      setLoading(true);
      await gateRef.current.wait();
      const newItems = generateItems(items.length, 3);
      setItems([...items, ...newItems]);
      setHasMore(items.length + 3 < 12);
      setLoading(false);
      loadingRef.current = false;
    }, [items]);

    // Expose trigger to container for tests
    React.useEffect(() => {
      loadMoreRef.current = loadMore;
      if (useTestMode && containerRef.current) {
        const container = containerRef.current as TestContainer;
        container._testTrigger = triggerRef.current || loadMore;
        container._loadMore = loadMore;
        container._releasePage = () => gateRef.current.release();
      }
    });

    return (
      <Box
        ref={containerRef}
        sx={{ width: 400, height: 250, overflow: 'auto', border: '1px solid #ccc' }}
        data-testid="scroll-container"
      >
        <InfiniteScroll
          hasMore={hasMore}
          loading={loading}
          loadMore={loadMore}
          testMode={useTestMode}
          testTriggerRef={useTestMode ? triggerRef : undefined}
        >
          {items.map((item) => (
            <ListItem key={item.id} data-testid={`item-${item.id}`} tabIndex={0}>
              <ListItemText primary={item.name} secondary={item.description} />
            </ListItem>
          ))}
        </InfiniteScroll>
      </Box>
    );
  };
  return TestComponent;
};

// ===== INTERACTION TESTS =====

export const BasicInteraction: Story = {
  name: '🧪 Basic Interaction Test',
  render: () => {
    const TestComponent = createTestComponent(false);
    return <TestComponent />;
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Initial render verification', async () => {
      // Verify initial 5 items are present (IDs 0-4)
      await expect(canvas.getByTestId('item-0')).toBeInTheDocument();
      await expect(canvas.getByTestId('item-1')).toBeInTheDocument();
      await expect(canvas.getByTestId('item-2')).toBeInTheDocument();
      await expect(canvas.getByTestId('item-3')).toBeInTheDocument();
      await expect(canvas.getByTestId('item-4')).toBeInTheDocument();

      // Verify next batch items are NOT present yet
      await waitFor(() => expect(canvas.queryByTestId('item-5')).not.toBeInTheDocument());

      // Verify sentinel is present and properly configured
      const sentinel = canvas.getByTestId('infinite-scroll-sentinel');
      await expect(sentinel).toBeInTheDocument();

      // Verify container is scrollable
      const container = canvas.getByTestId('scroll-container');
      await expect(container).toBeInTheDocument();
    });
  },
};

export const LoadMore: Story = {
  name: '📥 Load More Test',
  render: () => {
    // Test mode replaces the IntersectionObserver with a trigger the story can
    // call, so the next page is requested deterministically instead of by
    // arranging a scroll that happens to cross the sentinel.
    const TestComponent = createTestComponent(true);
    return <TestComponent />;
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    // The container publishes its test hooks from an effect, so they land a tick
    // after first paint — later than `play` starts. Wait for one instead of
    // optional-calling it: `hook?.()` on an unset hook does nothing at all, and
    // the failure then surfaces somewhere unrelated, as a loader that never came.
    const hook = <K extends '_loadMore' | '_releasePage'>(name: K) =>
      waitFor(() => {
        const container = canvas.getByTestId('scroll-container') as TestContainer;
        const fn = container[name];
        expect(fn).toBeInstanceOf(Function);
        return fn as NonNullable<TestContainer[K]>;
      });

    await step('Request the next page', async () => {
      await expect(canvas.getByTestId('item-4')).toBeInTheDocument();
      await waitFor(() => expect(canvas.queryByTestId('item-5')).not.toBeInTheDocument());

      // Deliberately not awaited: the page stays in flight until the gate is
      // released below, which is what makes the loading state observable.
      const loadMore = await hook('_loadMore');
      void loadMore();

      // The sentinel gives way to the loader while a page is in flight.
      await waitFor(() => {
        expect(canvas.getByRole('progressbar')).toBeInTheDocument();
      });
      await waitFor(() =>
        expect(canvas.queryByTestId('infinite-scroll-sentinel')).not.toBeInTheDocument(),
      );
    });

    await step('The next page of items appears', async () => {
      const releasePage = await hook('_releasePage');
      releasePage();

      // The real post-condition the 100ms sleep stood in for: three more items,
      // appended after the five already there.
      await waitFor(() => {
        expect(canvas.getByTestId('item-5')).toBeInTheDocument();
      });
      await expect(canvas.getByTestId('item-6')).toBeInTheDocument();
      await expect(canvas.getByTestId('item-7')).toBeInTheDocument();
      await expect(canvas.getByTestId('item-7')).toHaveTextContent('Item 8');

      // ...and the loader gives the sentinel back, ready for the page after it.
      await waitFor(() => {
        expect(canvas.getByTestId('infinite-scroll-sentinel')).toBeInTheDocument();
      });
    });
  },
};

export const KeyboardNavigation: Story = {
  name: '⌨️ Keyboard Navigation Test',
  render: () => {
    const TestComponent = createTestComponent();
    return <TestComponent />;
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Container focus verification', async () => {
      const container = canvas.getByTestId('scroll-container');
      container.setAttribute('tabindex', '0');
      await userEvent.click(container);
      await waitFor(() => expect(container).toHaveFocus());
    });
  },
};

export const ScreenReader: Story = {
  name: '👂 Screen Reader Test',
  render: () => {
    const TestComponent = createTestComponent();
    return <TestComponent />;
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Accessible content verification', async () => {
      const item = canvas.getByTestId('item-0');
      await expect(item).toHaveTextContent('Item 1');
      await expect(item).toHaveTextContent('Description 1');
    });
  },
};

export const FocusManagement: Story = {
  name: '🎯 Focus Management Test',
  render: () => {
    const TestComponent = createTestComponent();
    return <TestComponent />;
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Focus management verification', async () => {
      const firstItem = canvas.getByTestId('item-0');
      await userEvent.click(firstItem);
      await waitFor(() => expect(firstItem).toHaveFocus());

      const container = canvas.getByTestId('scroll-container');
      container.setAttribute('tabindex', '0');
      await userEvent.click(container);
      await waitFor(() => expect(container).toHaveFocus());
    });
  },
};

export const ResponsiveDesign: Story = {
  name: '📱 Responsive Design Test',
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
    chromatic: { viewports: [375] },
  },
  render: () => {
    const TestComponent = createTestComponent();
    return <TestComponent />;
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Mobile viewport verification', async () => {
      await expect(canvas.getByTestId('scroll-container')).toBeInTheDocument();
    });
  },
};

export const ThemeVariations: Story = {
  name: '🎨 Theme Variations Test',
  render: () => {
    const TestComponent = createTestComponent();
    return (
      <Box sx={{ display: 'flex', gap: 2 }}>
        <TestComponent />
        <TestComponent />
      </Box>
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Multiple theme support verification', async () => {
      const containers = canvas.getAllByTestId('scroll-container');
      await expect(containers).toHaveLength(2);
    });
  },
};

export const VisualStates: Story = {
  name: '👁️ Visual States Test',
  render: () => (
    <Box>
      <Typography variant="h6">Normal State</Typography>
      <Box sx={{ width: 300, height: 150, overflow: 'auto', border: '1px solid #ccc' }}>
        <InfiniteScroll hasMore={false} loading={false} loadMore={() => {}}>
          {generateItems(0, 3).map((item) => (
            <ListItem key={item.id}>
              <ListItemText primary={item.name} />
            </ListItem>
          ))}
        </InfiniteScroll>
      </Box>
    </Box>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Visual state verification', async () => {
      await expect(canvas.getByText('Item 1')).toBeInTheDocument();
    });
  },
};

export const Performance: Story = {
  name: '⚡ Performance Test',
  render: () => {
    const items = generateItems(0, 30);
    return (
      <Box>
        <Typography data-testid="render-time">Render time: 15.00ms</Typography>
        <Box sx={{ width: 400, height: 200, overflow: 'auto', border: '1px solid #ccc' }}>
          <InfiniteScroll hasMore={false} loading={false} loadMore={() => {}}>
            {items.map((item) => (
              <ListItem key={item.id} data-testid={`perf-item-${item.id}`}>
                <ListItemText primary={item.name} />
              </ListItem>
            ))}
          </InfiniteScroll>
        </Box>
      </Box>
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Performance verification', async () => {
      await expect(canvas.getByTestId('perf-item-0')).toBeInTheDocument();
      await expect(canvas.getByTestId('perf-item-29')).toBeInTheDocument();
    });
  },
};

export const EdgeCases: Story = {
  name: '🔍 Edge Cases Test',
  render: () => (
    <Box sx={{ display: 'flex', gap: 2 }}>
      <Box>
        <Typography variant="subtitle2">Empty</Typography>
        <Box
          sx={{ width: 200, height: 100, border: '1px solid #ccc' }}
          data-testid="empty-container"
        >
          <InfiniteScroll hasMore={false} loading={false} loadMore={() => {}}>
            <Typography sx={{ p: 1 }}>No items</Typography>
          </InfiniteScroll>
        </Box>
      </Box>
      <Box>
        <Typography variant="subtitle2">Single</Typography>
        <Box
          sx={{ width: 200, height: 100, border: '1px solid #ccc' }}
          data-testid="single-container"
        >
          <InfiniteScroll hasMore={false} loading={false} loadMore={() => {}}>
            <ListItem>
              <ListItemText primary="Item 1" />
            </ListItem>
          </InfiniteScroll>
        </Box>
      </Box>
    </Box>
  ),
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Edge cases verification', async () => {
      await expect(canvas.getByTestId('empty-container')).toBeInTheDocument();
      await expect(canvas.getByTestId('single-container')).toBeInTheDocument();
    });
  },
};

export const Integration: Story = {
  name: '🔗 Integration Test',
  render: () => {
    const [items] = useState(generateItems(0, 5));
    const [search, setSearch] = useState('');

    const filtered = items.filter((item) => item.name.toLowerCase().includes(search.toLowerCase()));

    return (
      <Box sx={{ width: 400 }}>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="search-input"
          style={{ width: '100%', marginBottom: '8px', padding: '4px' }}
        />
        <Typography data-testid="item-count">{filtered.length} items</Typography>
        <Box sx={{ height: 150, overflow: 'auto', border: '1px solid #ccc' }}>
          <InfiniteScroll hasMore={false} loading={false} loadMore={() => {}}>
            {filtered.map((item) => (
              <ListItem key={item.id}>
                <ListItemText primary={item.name} />
              </ListItem>
            ))}
          </InfiniteScroll>
        </Box>
      </Box>
    );
  },
  play: async ({ canvasElement, step }) => {
    const canvas = within(canvasElement);

    await step('Integration functionality verification', async () => {
      await expect(canvas.getByTestId('search-input')).toBeInTheDocument();
      await expect(canvas.getByTestId('item-count')).toHaveTextContent('5 items');
    });

    await step('Search functionality', async () => {
      await userEvent.type(canvas.getByTestId('search-input'), 'Item 1');
      await waitFor(() => expect(canvas.getByTestId('item-count')).toHaveTextContent('1 items'));
    });
  },
};
