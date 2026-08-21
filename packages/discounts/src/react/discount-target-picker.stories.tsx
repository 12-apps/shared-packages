import { useState, type JSX } from "react";

import { FormContainer } from "@12-apps/ui/form/total-form";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { DiscountTargetPicker } from "./discount-target-picker";
import { PT_BR_DISCOUNTS_WEB_COPY } from "./pt-BR";
import { STORY_GROUPS } from "./__stories__/fixtures";

/**
 * The picker, on its own, at each scope.
 *
 * The thing worth looking at is that NOTHING in this component names a
 * collection. It renders whatever the host registered — a nesting one gets a
 * tree, a flat one gets chips and type-to-filter — so a third discountable
 * dimension is a host-side object and not a change here.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;

/** The picker reads the live scope from its form, so a story needs one. */
function Harness({ scope, groups }: { scope: string; groups: typeof STORY_GROUPS }): JSX.Element {
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [menuItemIds, setMenuItemIds] = useState<string[]>([]);
  return (
    <FormContainer initialValues={{ scope }} onSubmit={() => Promise.resolve()}>
      <DiscountTargetPicker
        groups={groups}
        copy={copy}
        selection={{
          categoryIds,
          menuItemIds,
          comboRequirements: [],
          onComboRequirementsChange: () => {},
          onCategoryIdsChange: setCategoryIds,
          onMenuItemIdsChange: setMenuItemIds,
        }}
      />
    </FormContainer>
  );
}

const meta: Meta = {
  title: "Discounts/Target picker",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "What a scoped rule points at, picked from the host's own collections. The label and the placeholder are built from the REGISTRATION's own label, so a host that calls its categories something else gets its own word here with no copy key for it.",
      },
    },
  },
};

export default meta;
type Story = StoryObj;

export const NestingCollection: Story = {
  name: "A collection that nests",
  parameters: {
    docs: {
      description: {
        story:
          "Categories nest, so this is a tree with parent selection allowed — a discount on a top-level category covers what is filed underneath it, and the flat combobox below would put a subcategory beside its parent with nothing to tell them apart.",
      },
    },
  },
  render: () => <Harness scope="CATEGORY" groups={STORY_GROUPS} />,
};

export const FlatCollection: Story = {
  name: "A flat collection",
  parameters: {
    docs: {
      description: {
        story:
          "Chips plus type-to-filter. There is no shared multi-select in `@12-apps/ui`, so this composes `Autocomplete` in multiple mode — the same control the address field is built on.",
      },
    },
  },
  render: () => <Harness scope="ITEM" groups={STORY_GROUPS} />,
};

export const OrderScope: Story = {
  name: "Nothing at all, at ORDER scope",
  parameters: {
    docs: {
      description: {
        story:
          "The block renders `null`. An order-wide rule covers everything, so a target list there is not “empty” — it is meaningless, and leaving a stale one on screen would suggest otherwise.",
      },
    },
  },
  render: () => <Harness scope="ORDER" groups={STORY_GROUPS} />,
};
