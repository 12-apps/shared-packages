import { Box } from "@12-apps/ui/mui/Box";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { createDiscountsApiClient } from "./api";
import { CardActionsProvider } from "@12-apps/ui/data-display/CardKit";
import { DiscountCard } from "./discount-card";
import { DiscountListCard } from "./discount-list-card";
import { createFormatters } from "./format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "./pt-BR";
import { toListItem } from "./row";
import {
  storyTransport,
  StoryCurrencyField,
  storyOnError,
  STORY_DISCOUNTS,
  STORY_GROUPS,
} from "./__stories__/fixtures";

/**
 * The two card layouts.
 *
 * They exist for different questions. The tile is for scanning a board — what
 * it takes off, how long it runs, where it fires. The full-width row is for the
 * one thing a table cell cannot hold honestly: the TARGET LIST, which truncated
 * says nothing and printed in full destroys the column.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;
const formatters = createFormatters("pt-BR", "BRL");
const api = createDiscountsApiClient("/api/admin/minha-loja", storyTransport(), formatters);
// One instant for every story, so the badges do not drift as the day passes.
const NOW = new Date("2026-08-21T12:00:00.000Z");

const menu = {
  api,
  copy,
  formatters,
  currencyField: StoryCurrencyField,
  groups: STORY_GROUPS,
  onError: storyOnError,
};

const selection = { selected: false, onToggleSelect: () => {}, scale: 1 };

function rowAt(index: number) {
  return toListItem(STORY_DISCOUNTS[index]!, formatters, copy, NOW);
}

const meta: Meta = {
  title: "Discounts/Cards",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A rule as a tile and as a full-width row. Both mount the SAME self-contained menu the grid row uses, which is the whole reason it is one component: two menus is how a “Duplicar” appears on the card and not in the table.",
      },
    },
  },
  decorators: [
    (Story) => (
      <CardActionsProvider
        tenantSlug="minha-loja"
        onRefresh={() => {}}
        errorTitle={copy.actions.actionFailed}
      >
        <Story />
      </CardActionsProvider>
    ),
  ],
};

export default meta;
type Story = StoryObj;

export const Tiles: Story = {
  name: "The card layout",
  parameters: {
    docs: {
      description: {
        story:
          "The subtitle carries the two numbers an operator scans a board for. The chips carry where and how it fires — and a coupon shows its CODE rather than the word “Código”, because the code is what identifies it. “Pausado” appears only when true: a card shouting “Ativo” on every tile would make the one paused promotion harder to spot, not easier.",
      },
    },
  },
  render: () => (
    <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
      {STORY_DISCOUNTS.map((_, index) => (
        <DiscountCard key={index} row={rowAt(index)} selection={selection} {...menu} />
      ))}
    </Box>
  ),
};

export const Rows: Story = {
  name: "The list layout",
  parameters: {
    docs: {
      description: {
        story:
          "Open a row. The left column is the rule — validity, usage against its cap, the minimum basket; the right is what it actually covers, as a wrapping run of names. An id whose row was deleted still renders AS the id: dropping it would show a scope of “Categoria” over an empty list, which reads as “applies to nothing” when it still applies to whatever that id is.",
      },
    },
  },
  render: () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {STORY_DISCOUNTS.map((_, index) => (
        <DiscountListCard key={index} row={rowAt(index)} selection={selection} {...menu} />
      ))}
    </Box>
  ),
};

export const NoCatalog: Story = {
  name: "A row whose catalog never loaded",
  parameters: {
    docs: {
      description: {
        story:
          "With no registered collections in hand, the target names fall back to ids and the menu offers only Excluir — an edit form opened without them would show empty pickers, and saving would silently clear a target list it never displayed.",
      },
    },
  },
  render: () => (
    <DiscountListCard
      row={rowAt(4)}
      selection={selection}
      {...menu}
      groups={undefined}
    />
  ),
};
