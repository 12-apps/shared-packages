import type { Meta, StoryObj } from "@storybook/react-vite";

import { createDiscountsApiClient, type DiscountWireRecord } from "./api";
import { DiscountForm } from "./discount-form";
import { createFormatters } from "./format";
import { PT_BR_DISCOUNTS_WEB_COPY } from "./pt-BR";
import {
  storyTransport,
  StoryCurrencyField,
  storyOnError,
  STORY_DISCOUNTS,
  STORY_GROUPS,
  type StoryWorldOptions,
} from "./__stories__/fixtures";

/**
 * The create/edit form on its own — fourteen inputs, four of which appear only
 * when another one says so.
 *
 * What these stories are for is the CONDITIONAL half. Reading the file tells
 * you the coupon input exists; only seeing it appear when Ativação flips tells
 * you it appears in the right place, and that the target picker underneath it
 * swaps rather than stacking.
 */

const formatters = createFormatters("pt-BR", "BRL");

function propsFor(editing: DiscountWireRecord | null, options: StoryWorldOptions = {}) {
  return {
    api: createDiscountsApiClient("/api/admin/minha-loja", storyTransport(options), formatters),
    copy: PT_BR_DISCOUNTS_WEB_COPY,
    formatters,
    currencyField: StoryCurrencyField,
    groups: STORY_GROUPS,
    editing,
    onSaved: () => {},
    onError: storyOnError,
  };
}

const meta: Meta<typeof DiscountForm> = {
  title: "Discounts/Form",
  component: DiscountForm,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Shared by the header's create dialog and the row menu's edit dialog, so the fields and the submit live in one place. Two kinds of value are deliberately not form values — the switches and the id lists — because `total-form` holds strings and neither is one; they sit beside it and merge in at submit.",
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof DiscountForm>;

export const Create: Story = {
  name: "A new promotion",
  parameters: {
    docs: {
      description: {
        story:
          "The defaults are the promotion an operator creates most: a percentage, automatic, over the whole order. At ORDER scope the target block renders NOTHING — an order-wide rule covers everything, so a target list there is not empty, it is meaningless.",
      },
    },
  },
  args: propsFor(null),
};

export const EditingACoupon: Story = {
  name: "Editing a coupon",
  parameters: {
    docs: {
      description: {
        story:
          "Seeded from the record: basis points come back as the percentage the operator typed, cents as the amount, the ISO instant as a date input. Ativação is Código, so the coupon field is present — it is not there in the story above.",
      },
    },
  },
  args: propsFor(STORY_DISCOUNTS[0] as DiscountWireRecord),
};

export const EditingACategoryRule: Story = {
  name: "Editing a category rule",
  parameters: {
    docs: {
      description: {
        story:
          "Abrangência is Categoria, so the nesting picker appears — `CategorySelect`, not the flat combobox, because a flat list would put a subcategory beside its parent with nothing to tell them apart. Flip Abrangência to Item and the picker swaps live: it reads the scope from the form context rather than from a mirrored prop.",
      },
    },
  },
  args: propsFor(STORY_DISCOUNTS[1] as DiscountWireRecord),
};

/*
 * The three combo shapes a merchant actually asks for (FUT-268).
 *
 * They are three stories rather than one because they are three different
 * FORMS: the scope is COMBO in all three, so the group builder is on screen,
 * but the reward field above it is a different input in each — and getting the
 * wrong one mounted is a 500 on a form the operator filled in correctly, since
 * the four value columns are mutually exclusive at the database.
 */

export const ComboBundlePrice: Story = {
  name: "Combo — a fixed price for the group",
  parameters: {
    docs: {
      description: {
        story:
          '"2 refrigerantes, 2 hambúrgueres e 2 batatas por R$ 25,00". Abrangência is Combo, so the builder replaces the single picker: each group carries its own quantity and can name categories AND products at once, because a real menu mixes them. Tipo is Preço de combo, so the reward input is a currency field — what the matched group COSTS, not what it takes off. The line under the groups reads the offer back in the operator\'s own numbers, which is what catches a mistyped quantity before a save.',
      },
    },
  },
  args: propsFor(STORY_DISCOUNTS[2] as DiscountWireRecord),
};

export const ComboFreeUnits: Story = {
  name: "Combo — leve 3, pague 2",
  parameters: {
    docs: {
      description: {
        story:
          'ONE group of three, one of them free. Tipo is Itens grátis, so the reward is a COUNT — and it is the one number in a promotion bounded by another: raise it to 3 and the form refuses, naming the ceiling, because "leve 3, pague 0" is a giveaway rather than a promotion. The bound is the group total, which is why the builder computes it once and both the read-back line and this rule use the same number.',
      },
    },
  },
  args: propsFor(STORY_DISCOUNTS[3] as DiscountWireRecord),
};

export const ComboPercentage: Story = {
  name: "Combo — the same group at a rate",
  parameters: {
    docs: {
      description: {
        story:
          '"2 refrigerantes, 2 hambúrgueres e 2 batatas com 20% de desconto". The same three groups as the first combo story, rewarded with a RATE — proof that a combo\'s reward is its TYPE and not its scope. Combos por pedido is here too, and only here: it is the one scope where "how many times may one cart claim this" means anything, and blank means as often as it fits.',
      },
    },
  },
  args: propsFor(STORY_DISCOUNTS[4] as DiscountWireRecord),
};

export const Refused: Story = {
  name: "The server refuses it",
  parameters: {
    docs: {
      description: {
        story:
          "Press Criar desconto. The banner carries the server's sentence and the named input turns red — the form re-states what the server could attribute instead of only shouting at the top. Every rule it checks locally is checked again there; this half exists for the operator's sake, never as the authority.",
      },
    },
  },
  args: propsFor(null, {
    refuseWith: {
      error: "Já existe um desconto com esse nome.",
      fieldErrors: { name: "Já existe um desconto com esse nome." },
    },
  }),
};
