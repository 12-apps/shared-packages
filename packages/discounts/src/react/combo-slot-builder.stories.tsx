import { useState } from "react";

import type { Meta, StoryObj } from "@storybook/react-vite";

import type { ComboRequirement } from "../engine/types";

import { ComboSlotBuilder } from "./combo-slot-builder";
import { PT_BR_DISCOUNTS_WEB_COPY } from "./pt-BR";
import { STORY_GROUPS } from "./__stories__/fixtures";

/**
 * The combo builder on its own (FUT-268) — how "2 refrigerantes, 2
 * hambúrgueres e 2 batatas" gets written down.
 *
 * Split out from the form stories because the interesting behaviour is the
 * builder's own: adding a group, renumbering when one is removed, and the
 * read-back line that says what the combo now takes. In the form it is one
 * block among fourteen inputs; here it is the whole screen.
 */

const copy = PT_BR_DISCOUNTS_WEB_COPY;

/** The builder owns no state — the form does — so a story has to hold it. */
function Harness({ initial }: { initial: ComboRequirement[] }) {
  const [slots, setSlots] = useState<ComboRequirement[]>(initial);
  return <ComboSlotBuilder slots={slots} groups={STORY_GROUPS} copy={copy} onChange={setSlots} />;
}

const meta: Meta<typeof Harness> = {
  title: "Discounts/Combo builder",
  component: Harness,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "A combo is a list of groups: each one a quantity and the rows that can fill it. Every group gets every registered collection's picker rather than a scope toggle, because a real menu mixes them — \"any drink, or specifically the large fries\" is one group, and forcing a choice between categories and products would make the common offer unexpressible.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof Harness>;

export const Empty: Story = {
  name: "Nothing built yet",
  parameters: {
    docs: {
      description: {
        story:
          "What an operator sees the moment they pick Combo. There is no read-back line, because there is nothing yet to read back — the sentence appears with the first group.",
      },
    },
  },
  args: { initial: [] },
};

export const ThreeGroups: Story = {
  name: "2 refrigerantes, 2 hambúrgueres e 2 batatas",
  parameters: {
    docs: {
      description: {
        story:
          "The offer the ticket asks for. Note the first group uses the NESTING picker (Refrigerantes sits under Bebidas) and the other two the flat one — the same control the scope picker uses, which is why it lives in its own module rather than being copied here. Remove the middle group and the third renumbers to 2: position is the array index, and the list the operator builds is the list a card reads back.",
      },
    },
  },
  args: {
    initial: [
      { categoryIds: ["c-sodas"], menuItemIds: [], quantity: 2 },
      { categoryIds: [], menuItemIds: ["m-burger"], quantity: 2 },
      { categoryIds: [], menuItemIds: ["m-fries"], quantity: 2 },
    ],
  },
};

export const LeveTresPagueDois: Story = {
  name: "One group of three",
  parameters: {
    docs: {
      description: {
        story:
          "\"Leve 3, pague 2\" is one group of three; the \"pague 2\" half is the reward field in the form above, not part of the group. The read-back says 3 items in 1 group, which is the number the free count is checked against.",
      },
    },
  },
  args: { initial: [{ categoryIds: [], menuItemIds: ["m-burger"], quantity: 3 }] },
};

export const AGroupThatCannotBeFilled: Story = {
  name: "A group naming nothing",
  parameters: {
    docs: {
      description: {
        story:
          "A group with neither a category nor a product can never be filled, so the combo would save, look live in the list, and fire on nothing. The refusal hangs on the GROUP rather than on either picker — a group naming two categories and no products is complete.",
      },
    },
  },
  args: { initial: [{ categoryIds: [], menuItemIds: [], quantity: 2 }] },
};
